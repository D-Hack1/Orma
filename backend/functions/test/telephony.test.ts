import { beforeEach, describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { configuration, validSignature, boundedBody } from '../src/telephony/provider';
import { localClock, nextStatus, quietNow } from '../src/telephony/core';

const mocks = vi.hoisted(() => ({ records: new Map<string, any>(), reads: 0, enqueue: vi.fn(), call: vi.fn(), log: vi.fn(), recording: vi.fn(), deleteRecording: vi.fn(), understand: vi.fn(), message: vi.fn() }));
vi.mock('../src/platform/firebase', () => {
  const ref = (path: string): any => ({ path, get: async () => { mocks.reads++; const data = mocks.records.get(path); return { exists: !!data, data: () => data }; }, update: async (data: any) => { mocks.records.set(path, { ...mocks.records.get(path), ...data }); }, collection: (key: string) => ({ doc: (id: string) => ref(`${path}/${key}/${id}`) }) });
  return { app: {}, db: { doc: ref, getAll: (...refs: any[]) => Promise.all(refs.map(r => r.get())), runTransaction: async (fn: any) => fn({ get: (r: any) => r.get(), create: (r: any, data: any) => { if (mocks.records.has(r.path)) throw new Error('exists'); mocks.records.set(r.path, data); }, update: (r: any, data: any) => r.update(data) }) } };
});
vi.mock('firebase-admin/functions', () => ({ getFunctions: () => ({ taskQueue: (name: string) => ({ enqueue: (payload: any, options: any) => mocks.enqueue(name, payload, options) }) }) }));
vi.mock('../src/doses', () => ({ logDose: (...args: any[]) => mocks.log(...args) }));
vi.mock('../src/messages', () => ({ sendCallMessageService: (...args: any[]) => mocks.message(...args) }));
vi.mock('../src/telephony/services', () => ({ promptAudio: async () => { throw new Error('TTS unavailable'); }, transcribeRecording: async () => 'Please help me', understandRecording: (...args: any[]) => mocks.understand(...args) }));
vi.mock('../src/telephony/provider', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/telephony/provider')>();
  return { ...actual, TwilioProvider: class { call = mocks.call; recording = mocks.recording; deleteRecording = mocks.deleteRecording; } };
});
import { createWebhookHandler, placeReminderCall } from '../src/telephony';

const phone = '+919876543210';
const sid = `CA${'1'.repeat(32)}`;
const re = `RE${'2'.repeat(32)}`;
const key = { familyId: 'f', memberId: 'm', date: '2026-11-07', slot: 'morning' as const, attempt: 1 };
const memberPath = 'families/f/members/m';
function seed() {
  mocks.records.set(memberPath, { phone, deviceIds: ['d'], consent: { calls: true }, quietHours: { start: '22:00', end: '06:00' }, timezone: 'Asia/Kolkata', language: 'en' });
  mocks.records.set(`phoneBindings/${createHash('sha256').update(phone).digest('hex')}`, { verified: true, calls: true, sms: true, familyId: 'f', memberId: 'm', deviceId: 'd' });
  mocks.records.set('devices/d', { familyId: 'f', memberIds: ['m'] });
  mocks.records.set(`${memberPath}/schedule/morning`, { time: '08:00', medicines: [{ id: 'med', name: 'Entered name', purpose: 'Entered purpose', count: 2 }] });
  mocks.records.set('calls/c', { ...key, providerSid: sid, phone, deviceId: 'd', kind: 'reminder', state: 'menu', status: 'active', providerStatus: 'in-progress', consented: true, expiresAt: Timestamp.fromMillis(Date.now() + 600_000), step: 0, unclearTurns: 0, language: 'en' });
}
async function webhook(path: string, form: Record<string, string> = {}, query: Record<string, string> = { callId: 'c', step: '0' }, valid = true, channel: 'voice' | 'sms' = 'voice') {
  const suffix = new URLSearchParams(query).toString();
  const originalUrl = `${path}${suffix ? `?${suffix}` : ''}`;
  const body = { CallSid: sid, ...(form.RecordingSid ? { RecordingUrl: `https://api.twilio.com/2010-04-01/Accounts/AC${'a'.repeat(32)}/Recordings/${form.RecordingSid}` } : {}), ...form };
  const signature = twilio.getExpectedTwilioSignature('token', `https://example.test/${channel}${originalUrl}`, body);
  const req: any = { method: 'POST', path, originalUrl, query, body, is: () => true, get: () => valid ? signature : 'bad' };
  const res: any = { code: 200, body: '', headersSent: false, status(n: number) { this.code = n; return this; }, type() { return this; }, send(text: string) { this.body = text; this.headersSent = true; return this; } };
  await createWebhookHandler(channel)(req, res); return res;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-07T03:00:00Z'));
  vi.stubEnv('TWILIO_ACCOUNT_SID', `AC${'a'.repeat(32)}`); vi.stubEnv('TWILIO_AUTH_TOKEN', 'token'); vi.stubEnv('TWILIO_FROM_NUMBER', '+15005550006');
  vi.stubEnv('VOICE_PUBLIC_URL', 'https://example.test/voice'); vi.stubEnv('SMS_PUBLIC_URL', 'https://example.test/sms'); vi.stubEnv('TWILIO_ALLOWED_NUMBERS', phone);
  mocks.records.clear(); mocks.reads = 0; vi.clearAllMocks(); seed();
  mocks.call.mockResolvedValue(sid); mocks.enqueue.mockResolvedValue(undefined); mocks.deleteRecording.mockResolvedValue(undefined); mocks.recording.mockResolvedValue(Buffer.from('audio'));
  mocks.log.mockResolvedValue({ reply: { textEn: 'Reported.' } }); mocks.message.mockResolvedValue({ textEn: 'Message saved; receipt is not guaranteed.' });
  mocks.understand.mockResolvedValue({ intent: 'unclear', urgency: 'normal' });
});
describe('signed boundary', () => {
  it('rejects missing config', () => { vi.stubEnv('TWILIO_ALLOWED_NUMBERS', ''); expect(configuration()).toBeUndefined(); });
  it('checks the exact URL and all form values', () => {
    const f = { CallSid: sid, Digits: '1' }; const u = 'https://example.test/voice/gather?callId=c&step=0'; const s = twilio.getExpectedTwilioSignature('token', u, f);
    expect(validSignature('token', s, u, f)).toBe(true);
    expect(validSignature('token', s, `${u}&familyId=attacker`, f)).toBe(false);
    expect(validSignature('token', s, u, { ...f, Digits: '2' })).toBe(false);
  });
  it('rejects an invalid signature before any database read', async () => { const r = await webhook('/gather', { Digits: '1' }, undefined, false); expect(r.code).toBe(403); expect(mocks.reads).toBe(0); });
  it('does not authorize a valid signature for another CallSid', async () => { await webhook('/gather', { CallSid: `CA${'9'.repeat(32)}`, Digits: '1' }); expect(mocks.log).not.toHaveBeenCalled(); expect(mocks.records.get('calls/c').step).toBe(0); });
  it('rechecks revoked consent and device bindings', async () => { mocks.records.get(memberPath).consent.calls = false; await webhook('/gather', { Digits: '1' }); expect(mocks.records.get('calls/c').step).toBe(0); mocks.records.get(memberPath).consent.calls = true; mocks.records.get('devices/d').familyId = 'attacker'; await webhook('/gather', { Digits: '1' }); expect(mocks.records.get('calls/c').step).toBe(0); });
  it('rejects expired sessions', async () => { mocks.records.get('calls/c').expiresAt = Timestamp.fromMillis(1); await webhook('/gather', { Digits: '1' }); expect(mocks.records.get('calls/c').step).toBe(0); });
  it('rejects explicitly disabled or removed enrolled devices', async () => {
    mocks.records.get('devices/d').active = false;
    await webhook('/gather', { Digits: '1' });
    expect(mocks.records.get('calls/c').step).toBe(0);
    mocks.records.delete('devices/d');
    expect((await placeReminderCall(key)).action).toBe('skipped');
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
describe('keypad and lifecycle', () => {
  it('consent gathers are distinct from dose confirmation', async () => { const call = mocks.records.get('calls/c'); call.kind = 'consent'; call.state = 'consent'; call.consented = false; mocks.records.get(memberPath).consent.calls = false; const start = await webhook('/start'); expect(start.body).toContain('agree'); await webhook('/gather', { Digits: '1' }); expect(mocks.records.get(memberPath)['consent.calls']).toBe(true); expect(mocks.records.get('calls/c').consented).toBe(true); expect(mocks.log).not.toHaveBeenCalled(); });
  it('asks for count, then uses the enrolled device actor exactly once', async () => {
    const first = await webhook('/gather', { Digits: '1', familyId: 'attacker' }); expect(first.body).toContain('How many'); expect(mocks.log).not.toHaveBeenCalled();
    await webhook('/gather', { Digits: '2' }, { callId: 'c', step: '1' }); await webhook('/gather', { Digits: '2' }, { callId: 'c', step: '1' });
    expect(mocks.log).toHaveBeenCalledTimes(1); expect(mocks.log.mock.calls[0][1]).toMatchObject({ familyId: 'f', memberId: 'm', countTaken: 2, source: 'call' }); expect(mocks.log.mock.calls[0][2]).toMatchObject({ role: 'device', deviceId: 'd' });
  });
  it('clarifies ambiguous partial identity without claiming success', async () => { mocks.records.get('calls/c').state = 'count'; mocks.log.mockRejectedValue(new Error('Clarify medicine')); const r = await webhook('/gather', { Digits: '1' }); expect(r.body).toContain('Nothing was recorded'); expect(mocks.records.get('calls/c').state).toBe('menu'); });
  it('distinguishes callback key2 from reminder key2', async () => { mocks.records.get('calls/c').kind = 'callback'; const r = await webhook('/gather', { Digits: '2' }); expect(r.body).toContain('no confirmed report'); expect(mocks.enqueue).not.toHaveBeenCalled(); });
  it('escalates through retryCall immediately after the third not-yet response', async () => { mocks.records.get('calls/c').attempt = 3; await webhook('/gather', { Digits: '2' }); expect(mocks.enqueue).toHaveBeenCalledWith('locations/asia-south1/functions/retryCall', { ...key, attempt: 4 }, expect.objectContaining({ scheduleDelaySeconds: 0 })); });
  it('never makes a completed status mean taken or regress on late failure', async () => { mocks.records.get('calls/c').state = 'done'; await webhook('/status', { CallStatus: 'completed' }); await webhook('/status', { CallStatus: 'no-answer' }); expect(mocks.records.get('calls/c').providerStatus).toBe('completed'); expect(mocks.log).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled(); });
  it('dedupes failed status retry using a deterministic task id', async () => { await webhook('/status', { CallStatus: 'no-answer' }); await webhook('/status', { CallStatus: 'no-answer' }); expect(mocks.enqueue.mock.calls[0][2].id).toBe(mocks.enqueue.mock.calls[1][2].id); });
  it('lets Twilio retry a failed queue enqueue without losing terminal state', async () => { mocks.enqueue.mockRejectedValueOnce(new Error('Queue unavailable')); expect((await webhook('/status', { CallStatus: 'no-answer' })).code).toBe(503); expect((await webhook('/status', { CallStatus: 'no-answer' })).code).toBe(204); expect(mocks.enqueue).toHaveBeenCalledTimes(2); });
  it('records a message rather than claiming a placeholder succeeded', async () => { const r = await webhook('/gather', { Digits: '3' }); expect(r.body).toContain('<Record'); expect(r.body).toContain('108'); expect(mocks.records.get('calls/c').state).toBe('message'); await webhook('/turn', { RecordingSid: re, RecordingDuration: '4' }, { callId: 'c', step: '1' }); expect(mocks.message).toHaveBeenCalledWith('c', 'Please help me', expect.objectContaining({ provider: expect.any(Function) })); });
  it('accepts real URL-only Record action fields and deletes processed provider audio', async () => { mocks.records.get('calls/c').state = 'turn'; await webhook('/turn', { RecordingDuration: '4', RecordingUrl: `https://api.twilio.com/2010-04-01/Accounts/AC${'a'.repeat(32)}/Recordings/${re}`, Digits: 'hangup' }); expect(mocks.recording).toHaveBeenCalledWith(sid, re, expect.any(AbortSignal)); expect(mocks.deleteRecording).toHaveBeenCalledWith(re); });
  it('rejects malicious recording URLs before media access', async () => { mocks.records.get('calls/c').state = 'turn'; await webhook('/turn', { RecordingSid: re, RecordingDuration: '4', RecordingUrl: 'http://169.254.169.254/' }); expect(mocks.recording).not.toHaveBeenCalled(); });
  it('falls back safely when recording is not ready', async () => { mocks.records.get('calls/c').state = 'turn'; mocks.recording.mockRejectedValue(new Error('Recording unavailable')); const r = await webhook('/turn', { RecordingSid: re, RecordingDuration: '4' }); expect(r.body).toContain('Speech is unavailable'); expect(mocks.log).not.toHaveBeenCalled(); expect(mocks.deleteRecording).not.toHaveBeenCalled(); expect(mocks.records.get(`calls/c/recordings/${re}`).cleanupPending).toBe(true); });
  it('falls back to keypad after two unclear turns', async () => { mocks.records.get('calls/c').state = 'turn'; await webhook('/turn', { RecordingSid: re, RecordingDuration: '4' }); const r = await webhook('/turn', { RecordingSid: `RE${'3'.repeat(32)}`, RecordingDuration: '4' }, { callId: 'c', step: '1' }); expect(r.body).toContain('Please use the keypad'); expect(mocks.records.get('calls/c').state).toBe('menu'); });
  it('does not fetch a recording in a keypad state', async () => { await webhook('/turn', { RecordingSid: re, RecordingDuration: '4' }); expect(mocks.recording).not.toHaveBeenCalled(); });
});
describe('outbound reservation and SMS', () => {
  it('does not place calls before consent or after phone verification is revoked', async () => { mocks.records.get(memberPath).consent.calls = false; expect((await placeReminderCall(key)).action).toBe('skipped'); mocks.records.get(memberPath).consent.calls = true; mocks.records.get(`phoneBindings/${createHash('sha256').update(phone).digest('hex')}`).verified = false; expect((await placeReminderCall(key)).action).toBe('skipped'); expect(mocks.call).not.toHaveBeenCalled(); });
  it('permanently dedupes an incoming SID even after the phone throttle window', async () => { const form = { CallSid: `CA${'8'.repeat(32)}`, From: phone, To: '+15005550006' }; const first = await webhook('/incoming', form, {}); expect(first.body).toContain('<Reject'); expect(mocks.call).toHaveBeenCalledTimes(1); vi.setSystemTime(new Date(Date.now() + 6 * 60_000)); await webhook('/incoming', form, {}); expect(mocks.call).toHaveBeenCalledTimes(1); });
  it('calls back for a status question even when the current dose was already recorded', async () => {
    mocks.records.set(`${memberPath}/doses/2026-11-07_morning`, { status: 'confirmed' });
    await webhook('/incoming', { CallSid: `CA${'8'.repeat(32)}`, From: phone, To: '+15005550006' }, {});
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it('throttles new incoming SIDs without permitting their later replay', async () => { const f = { From: phone, To: '+15005550006' }; await webhook('/incoming', { ...f, CallSid: `CA${'8'.repeat(32)}` }, {}); await webhook('/incoming', { ...f, CallSid: `CA${'9'.repeat(32)}` }, {}); expect(mocks.call).toHaveBeenCalledTimes(1); vi.setSystemTime(new Date(Date.now() + 6 * 60_000)); await webhook('/incoming', { ...f, CallSid: `CA${'9'.repeat(32)}` }, {}); expect(mocks.call).toHaveBeenCalledTimes(1); });
  it('reserves idempotently and records finite media authorization', async () => { expect(await placeReminderCall(key)).toEqual({ action: 'call_queued' }); expect(await placeReminderCall(key)).toEqual({ action: 'skipped' }); expect(mocks.call).toHaveBeenCalledTimes(1); const call = [...mocks.records.entries()].find(([path]) => path.startsWith('calls/') && path !== 'calls/c')![1]; expect(call).toMatchObject({ status: 'active', consented: true, providerStatus: 'queued' }); expect(call.expiresAt.toMillis()).toBe(Date.now() + 600_000); });
  it('skips logged doses and defers missing quiet-hour config', async () => { mocks.records.set(`${memberPath}/doses/2026-11-07_morning`, { status: 'partial' }); expect((await placeReminderCall(key)).action).toBe('skipped'); mocks.records.delete(`${memberPath}/doses/2026-11-07_morning`); delete mocks.records.get(memberPath).quietHours; await expect(placeReminderCall(key)).rejects.toThrow('defer call'); expect(mocks.call).not.toHaveBeenCalled(); });
  it('defers missing provider config without consuming an opportunity', async () => { vi.stubEnv('TWILIO_AUTH_TOKEN', ''); await expect(placeReminderCall(key)).rejects.toThrow('configuration unavailable'); expect(mocks.call).not.toHaveBeenCalled(); });
  it('rejects stale snooze generations and preserves a new generation in retries', async () => { const generation = Date.now() - 1; mocks.records.set(`${memberPath}/snoozes/2026-11-07_morning`, { remindAt: Timestamp.fromMillis(generation) }); expect((await placeReminderCall(key)).action).toBe('skipped'); expect((await placeReminderCall({ ...key, generation })).action).toBe('call_queued'); mocks.records.get('calls/c').generation = generation; await webhook('/gather', { Digits: '2' }); expect(mocks.enqueue.mock.calls[0][1].generation).toBe(generation); });
  it('does not let a recording replay through a later step', async () => { mocks.records.get('calls/c').state = 'turn'; await webhook('/turn', { RecordingSid: re, RecordingDuration: '4' }); await webhook('/turn', { RecordingSid: re, RecordingDuration: '4' }, { callId: 'c', step: '1' }); expect(mocks.recording).toHaveBeenCalledTimes(1); });
  it('retains reservation after ambiguous provider timeout', async () => { mocks.call.mockRejectedValue(new Error('timeout')); await expect(placeReminderCall(key)).rejects.toThrow('reservation retained'); expect((await placeReminderCall(key)).action).toBe('skipped'); expect(mocks.call).toHaveBeenCalledTimes(1); });
  it('SMS logs the full schedule once with a generic acknowledgement', async () => { const form = { MessageSid: `SM${'4'.repeat(32)}`, From: phone, To: '+15005550006', Body: '1' }; const r = await webhook('/incoming', form, {}, true, 'sms'); await webhook('/incoming', form, {}, true, 'sms'); expect(mocks.log).toHaveBeenCalledTimes(1); expect(r.body).not.toContain('Entered name'); expect(r.body).not.toContain('2 tablets'); });
  it('SMS with multiple due slots asks for clarification without logging', async () => { mocks.records.set(`${memberPath}/schedule/noon`, { time: '08:00', medicines: [{ id: 'x', count: 1 }] }); const r = await webhook('/incoming', { MessageSid: `SM${'5'.repeat(32)}`, From: phone, To: '+15005550006', Body: '1' }, {}, true, 'sms'); expect(r.body).toContain('clarify'); expect(mocks.log).not.toHaveBeenCalled(); });
});
describe('pure guardrails', () => {
  it('does not regress provider state', () => { expect(nextStatus('in-progress', 'ringing')).toBe('in-progress'); expect(nextStatus('failed', 'completed')).toBe('failed'); });
  it('supports midnight quiet hours and fails closed on malformed config', () => { expect(quietNow(23 * 60, { start: '22:00', end: '06:00' })).toBe(true); expect(quietNow(8 * 60, { start: '22:00', end: '06:00' })).toBe(false); expect(quietNow(8 * 60, undefined)).toBe(true); expect(localClock(new Date('2026-11-07T03:00:00Z'), 'Asia/Kolkata').date).toBe('2026-11-07'); });
  it('bounds streamed provider responses', async () => { await expect(boundedBody(new Response('too large'), 2)).rejects.toThrow('too large'); expect((await boundedBody(new Response('ok'), 2)).toString()).toBe('ok'); });
});
