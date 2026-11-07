import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), set: vi.fn(), commit: vi.fn(), provider: vi.fn(), readAudio: vi.fn(), notify: vi.fn(), createAlert: vi.fn(), routeNotification: vi.fn(), records: {} as Record<string, Record<string, unknown> | undefined> }));
vi.mock('../src/alerts', () => ({ createAlert: mocks.createAlert, routeNotification: mocks.routeNotification }));
vi.mock('../src/platform/firebase', () => ({ db: {
  collection: () => ({ get: async () => ({ docs: [{ id: 'owner' }, { id: 'nurse' }, { id: 'helper' }, { id: 'inactive' }, { id: 'unassigned' }] }) }),
  doc: (path: string) => ({ path, get: async () => ({ data: () => path === 'families/f'
    ? { timezone: 'Asia/Kolkata', roster: [{ memberId: 'helper', days: [6], from: '00:00', to: '23:59' }] } : mocks.records[path] }) }),
  batch: () => ({ set: mocks.set, commit: mocks.commit }),
} }));
vi.mock('../src/platform/auth', () => ({ requireAuth: () => 'owner', resolveMemberAccess: mocks.access,
  sharingAllowed: (context: { sharing: { messages: boolean } }) => context.sharing.messages,
  documentId: (value: string) => { if (value.includes('/')) throw new Error('Invalid ID'); },
}));
vi.mock('../src/messages/providers', async importOriginal => ({ ...await importOriginal<object>(), geminiMessageProvider: mocks.provider }));
import { HttpsError } from 'firebase-functions/v2/https';
import { sendCallMessageService, sendMessageService, isUrgentMessage } from '../src/messages';
import { createHash } from 'node:crypto';
const input = { familyId: 'f', memberId: 'amma', fromId: 'amma', to: 'nurse', text: 'Please call me' };
const deps = { provider: mocks.provider, notify: mocks.notify, readAudio: mocks.readAudio, now: new Date('2026-11-07T04:00:00Z') };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.records = {};
  mocks.access.mockImplementation(async (uid: string) => {
    if (['inactive', 'unassigned', 'outsider'].includes(uid)) throw new HttpsError('permission-denied', 'No access');
    return { uid, familyId: 'f', memberId: 'amma', isOwner: uid === 'owner', sharing: { messages: false, version: 1 },
      member: { ownerUid: 'owner', consent: { messageAudio: true } }, memberRef: { collection: () => ({ doc: () => ({ id: 'msg1' }) }) } };
  });
  mocks.provider.mockRejectedValue(new Error('offline'));
  mocks.notify.mockResolvedValue({ delivered: true });
  mocks.createAlert.mockResolvedValue({ alertId: 'alert1' });
  mocks.routeNotification.mockResolvedValue(['nurse', 'helper']);
  mocks.readAudio.mockResolvedValue({ bytes: Buffer.from('audio'), mimeType: 'audio/aac' });
});
describe('trusted call message bridge', () => {
  const phone = '+919000000001';
  const bindingPath = `phoneBindings/${createHash('sha256').update(phone).digest('hex')}`;
  beforeEach(() => {
    mocks.records = {
      'calls/call1': { status: 'active', consented: true, expiresAt: '2026-11-07T05:00:00Z', familyId: 'f', memberId: 'amma', deviceId: 'keypad', phone },
      'families/f/members/amma': { ownerUid: 'owner', phone, consent: { calls: true }, deviceIds: ['keypad'] },
      'devices/keypad': { familyId: 'f', memberIds: ['amma'] },
      [bindingPath]: { verified: true, calls: true, familyId: 'f', memberId: 'amma', deviceId: 'keypad' },
    };
  });
  it('derives owner only after live session/device/binding checks and records call provenance', async () => {
    expect(await sendCallMessageService('call1', 'Please call me', deps)).toMatchObject({ messageId: 'msg1' });
    expect(mocks.set.mock.calls[0][1]).toMatchObject({ from: 'owner', to: ['helper'], source: 'call', callId: 'call1' });
    expect(mocks.set.mock.calls[0][1]).not.toHaveProperty('audioUrl');
  });
  it.each([
    ['calls/call1', undefined],
    ['calls/call1', { status: 'complete' }],
    ['calls/call1', { consented: false }],
    ['calls/call1', { expiresAt: '2026-11-07T03:00:00Z' }],
    ['calls/call1', { phone: '+919000000002' }],
    ['families/f/members/amma', { consent: { calls: false } }],
    ['families/f/members/amma', { deviceIds: [] }],
    ['devices/keypad', undefined],
    ['devices/keypad', { active: false }],
    ['devices/keypad', { familyId: 'another' }],
    ['devices/keypad', { memberIds: ['achan'] }],
    [bindingPath, undefined],
    [bindingPath, { verified: false }],
    [bindingPath, { calls: false }],
    [bindingPath, { memberId: 'another' }],
    [bindingPath, { deviceId: 'another' }],
  ])('fails closed for revoked or stale %s (%j)', async (path, patch) => {
    mocks.records[path] = patch === undefined ? undefined : { ...mocks.records[path], ...patch };
    await expect(sendCallMessageService('call1', 'Please call me', deps)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
  });
  it('rejects revoked owner access', async () => {
    mocks.access.mockRejectedValue(new HttpsError('permission-denied', 'Owner removed'));
    await expect(sendCallMessageService('call1', 'Please call me', deps)).rejects.toThrow('Owner removed');
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
describe('message authorization and fallback', () => {
  it('derives identity from authenticated UID; rejects spoofed sender', async () => {
    await expect(sendMessageService('', input, deps)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(sendMessageService('owner', { ...input, fromId: 'nurse' }, deps)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('authorizes sender and all recipients before any model or storage work', async () => {
    await expect(sendMessageService('outsider', input, deps)).rejects.toThrow('No access');
    await expect(sendMessageService('owner', { ...input, to: 'inactive' }, deps)).rejects.toThrow('No authorized');
    await expect(sendMessageService('owner', { ...input, to: 'unassigned' }, deps)).rejects.toThrow('No authorized');
    expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.readAudio).not.toHaveBeenCalled();
  });
  it('allows self-authorized direct delivery without broadcasting to all viewers', async () => {
    expect(await sendMessageService('owner', input, deps)).toMatchObject({ urgency: 'normal', fallbackUsed: true });
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(mocks.set.mock.calls[0][1]).toMatchObject({ from: 'owner', to: ['nurse'], text: input.text, translated: {} });
    expect(mocks.set.mock.calls[1][0].path).toContain('/views/nurse/');
  });
  it('does not let a helper self-authorize hidden messages', async () => {
    await expect(sendMessageService('helper', { ...input, fromId: 'helper' }, deps)).rejects.toThrow('not shared');
  });
  it('retains no audio without explicit consent and own-message authorization', async () => {
    await sendMessageService('owner', { ...input, audioUrl: 'gs://private/families/f/members/amma/uploads/a.aac' }, deps);
    expect(mocks.set.mock.calls[0][1]).not.toHaveProperty('audioUrl');
    const original = mocks.access.getMockImplementation()!;
    mocks.access.mockImplementation(async uid => ({ ...await original(uid), member: { ownerUid: 'owner', consent: {} } }));
    await expect(sendMessageService('owner', { ...input, audioUrl: 'gs://private/a', retainAudio: true }, deps)).rejects.toThrow('consent');
  });
  it('uses authorized media reader and fails safely for offline audio-only transcription', async () => {
    await expect(sendMessageService('owner', { ...input, text: undefined, audioUrl: 'gs://private/a' }, deps)).rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.readAudio).toHaveBeenCalledWith(expect.objectContaining({ uid: 'owner' }), 'gs://private/a', 'audio');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('rejects rewritten originals and ungrounded translations', async () => {
    mocks.provider.mockResolvedValueOnce({ transcript: 'Take 4 pills', translations: [] });
    await sendMessageService('owner', input, deps);
    expect(mocks.set.mock.calls[0][1].text).toBe(input.text);
    mocks.set.mockClear();
    mocks.provider.mockResolvedValue({ transcript: input.text, translations: [{ language: 'en', text: 'Take 4 pills', source: input.text, backTranslation: input.text }] });
    await sendMessageService('owner', input, deps);
    expect(mocks.set.mock.calls[0][1].translated).toEqual({});
  });
  it('accepts only reviewed faithful phrase translations, even when a model claims a new fact is faithful', async () => {
    mocks.provider.mockResolvedValue({ transcript: input.text, translations: [
      { language: 'ml', text: 'എന്നെ വിളിക്കൂ', source: input.text, backTranslation: input.text },
      { language: 'en', text: 'You have a heart attack', source: input.text, backTranslation: input.text },
    ] });
    await sendMessageService('owner', input, deps);
    expect(mocks.set.mock.calls[0][1].translated).toEqual({ ml: 'എന്നെ വിളിക്കൂ' });
  });
  it('does not claim push delivery on adapter failure', async () => {
    mocks.notify.mockRejectedValue(new Error('network'));
    expect(await sendMessageService('owner', input, deps)).toMatchObject({ notificationStatus: 'failed' });
  });
  it('uses production routing adapter with private rule codes; no channel success is a failure', async () => {
    const production = { provider: mocks.provider, now: deps.now };
    expect(await sendMessageService('owner', { ...input, text: 'chest pain' }, production)).toMatchObject({ notificationStatus: 'sent', templateId: 'urgent108' });
    expect(mocks.createAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ rule: expect.stringMatching(/^urgent_message_[a-f0-9]{16}$/), type: 'urgent' }));
    expect(mocks.routeNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'message', recipientIds: ['nurse', 'helper'] }));
    mocks.routeNotification.mockResolvedValue([]);
    expect(await sendMessageService('owner', input, production)).toMatchObject({ notificationStatus: 'failed' });
  });
});
describe('deterministic urgency without model credentials', () => {
  it.each(['chest pain', 'fall', 'fell', 'breathless', 'dizzy', 'nenju vedana', 'veenu', 'swasam muttal', 'thala karakkam', 'നെഞ്ചുവേദന', 'വീണു', 'ശ്വാസം മുട്ടുന്നു', 'തലകറക്കം'])('recognizes %s', phrase => expect(isUrgentMessage(phrase)).toBe(true));
  it('routes urgent messages to authorized duty recipients and says 108, not a diagnosis', async () => {
    const result = await sendMessageService('owner', { ...input, text: 'nenju vedana' }, deps);
    expect(result).toMatchObject({ urgency: 'urgent' });
    expect(result.textEn).toContain('108'); expect(result.textEn).toContain('not an emergency service');
    expect(mocks.set.mock.calls[0][1].to).toEqual(['nurse', 'helper']);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ urgent108: true }));
  });
});
