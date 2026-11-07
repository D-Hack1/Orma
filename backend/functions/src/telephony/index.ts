import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { onRequest, type Request } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import twilio from 'twilio';
import { db, app } from '../platform/firebase';
import { doseKeySchema, type Schedule } from '../doses/core';
import { logDose } from '../doses';
import { configuration, TwilioProvider, validSignature, recordingSidFromAction, type TelephonyProvider, type TelephonyConfig } from './provider';
import { localClock, nextStatus, quietNow, terminal, type Session, type ReminderInput, type Slot } from './core';
import { promptAudio, understandRecording, transcribeRecording } from './services';

export type { TelephonyProvider } from './provider';
export type { ReminderInput } from './core';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const base = (s: ReminderInput) => `families/${s.familyId}/members/${s.memberId}`;
const queue = (name: string) => getFunctions(app).taskQueue(`locations/asia-south1/functions/${name}`);
const url = (c: TelephonyConfig, path: string, id: string, step?: number) => `${c.voiceUrl}/${path}?callId=${id}${step === undefined ? '' : `&step=${step}`}`;
const done = (text: string) => { const r = new twilio.twiml.VoiceResponse(); r.say({ language: 'en-IN' }, text); r.hangup(); return r.toString(); };
const generic = done('This service is unavailable. If urgent, call 108. Orma is not an emergency service.');

async function enrolled(phone: string, config: TelephonyConfig, channel: 'calls' | 'sms') {
  if (!config.allowed.includes(phone)) throw new Error('Not enrolled');
  const binding = (await db.doc(`phoneBindings/${hash(phone)}`).get()).data();
  if (!binding || binding.verified !== true || binding[channel] !== true) throw new Error('Not enrolled');
  doseKeySchema.pick({ familyId: true, memberId: true }).parse(binding);
  if (typeof binding.deviceId !== 'string' || !/^[\w-]+$/.test(binding.deviceId)) throw new Error('No enrolled device');
  const [member, device] = await db.getAll(db.doc(base(binding as ReminderInput)), db.doc(`devices/${binding.deviceId}`));
  const m = member.data(), d = device.data();
  if (!m || !d || d.active === false || d.revoked === true || d.revokedAt != null || m.phone !== phone || !Array.isArray(m.deviceIds) || !m.deviceIds.includes(binding.deviceId) || d.familyId !== binding.familyId || !Array.isArray(d.memberIds) || !d.memberIds.includes(binding.memberId)) throw new Error('Binding revoked');
  return { binding, member: m };
}
async function current(s: Session, config: TelephonyConfig) {
  const result = await enrolled(s.phone, config, 'calls');
  if (result.binding.familyId !== s.familyId || result.binding.memberId !== s.memberId || result.binding.deviceId !== s.deviceId) throw new Error('Binding changed');
  if (s.kind !== 'consent' && result.member.consent?.calls !== true) throw new Error('Consent revoked');
  if (!s.expiresAt?.toMillis || s.expiresAt.toMillis() <= Date.now()) throw new Error('Session expired');
  return result.member;
}
async function retry(s: ReminderInput) {
  if (s.attempt < 1 || s.attempt > 3) throw new Error('Invalid attempt');
  const payload = { ...doseKeySchema.parse(s), attempt: s.attempt + 1, ...(s.generation === undefined ? {} : { generation: s.generation }) };
  try { await queue('retryCall').enqueue(payload, { scheduleDelaySeconds: s.attempt === 3 ? 0 : 900, id: hash(JSON.stringify(payload)) }); }
  catch (error) { if ((error as { code?: string }).code !== 'functions/task-already-exists') throw error; }
}

/** Internal only: scheduler verifies recipient UID/consent/binding before calling. */
export async function sendSms(input: { to: string; body: string }): Promise<boolean> {
  const c = configuration();
  if (!c || !c.allowed.includes(input.to) || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 1600) return false;
  try { await twilio(c.accountSid, c.token, { autoRetry: false, timeout: 2500 }).messages.create({ from: c.from, to: input.to, body: input.body }); return true; } catch { return false; }
}

export async function placeReminderCall(input: ReminderInput): Promise<{ action: 'call_queued' | 'skipped' | 'escalated' }> {
  return placeCall(input, 'reminder');
}
/** Only invoke after a trusted operator has explicitly requested phone consent enrollment. */
export async function placeConsentCall(input: ReminderInput) { return placeCall(input, 'consent'); }
async function placeCall(input: ReminderInput, kind: Session['kind'], suppliedConfig?: TelephonyConfig, suppliedProvider?: TelephonyProvider, incomingSid?: string): Promise<{ action: 'call_queued' | 'skipped' | 'escalated' }> {
  doseKeySchema.parse(input);
  if (!Number.isInteger(input.attempt) || input.attempt < 1 || input.attempt > 3) throw new Error('Invalid attempt');
  if (input.generation !== undefined && (!Number.isSafeInteger(input.generation) || input.generation < 0)) throw new Error('Invalid generation');
  const config = suppliedConfig ?? configuration(); if (!config) throw new Error('Telephony configuration unavailable; retry after setup');
  const member = (await db.doc(base(input)).get()).data();
  if (!member || typeof member.phone !== 'string') return { action: 'skipped' };
  let enrollment;
  try { enrollment = await enrolled(member.phone, config, 'calls'); } catch { return { action: 'skipped' }; }
  if (enrollment.binding.familyId !== input.familyId || enrollment.binding.memberId !== input.memberId) return { action: 'skipped' };
  const family = (await db.doc(`families/${input.familyId}`).get()).data();
  const clock = localClock(new Date(), member.timezone ?? family?.timezone ?? 'Asia/Kolkata');
  if (kind !== 'consent' && member.consent?.calls !== true || clock.date !== input.date) return { action: 'skipped' };
  if (quietNow(clock.minutes, member.quietHours)) throw new Error('Quiet hours or missing quiet-hour configuration; defer call');
  if (kind === 'callback' && !/^CA[0-9a-f]{32}$/i.test(incomingSid ?? '')) throw new Error('No incoming call binding');
  const id = hash(`${input.familyId}:${input.memberId}:${input.date}:${input.slot}:${input.attempt}:${input.generation ?? 0}:${kind}:${incomingSid ?? ''}`);
  const ref = db.doc(`calls/${id}`);
  const reserved = await db.runTransaction(async tx => {
    const [existing, latest, dose, schedule, snooze] = await Promise.all([tx.get(ref), tx.get(db.doc(base(input))), tx.get(db.doc(`${base(input)}/doses/${input.date}_${input.slot}`)), tx.get(db.doc(`${base(input)}/schedule/${input.slot}`)), tx.get(db.doc(`${base(input)}/snoozes/${input.date}_${input.slot}`))]);
    const snoozeGeneration = snooze.data()?.remindAt?.toMillis?.() ?? 0;
    if (kind === 'reminder' && ((input.generation ?? 0) !== snoozeGeneration || snoozeGeneration > Date.now())) return false;
    const latestMember = latest.data();
    const latestClock = localClock(new Date(), latestMember?.timezone ?? family?.timezone ?? 'Asia/Kolkata');
    const scheduledTime = schedule.data()?.time;
    if (kind !== 'consent' && (typeof scheduledTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime) || latestClock.minutes < Number(scheduledTime.slice(0, 2)) * 60 + Number(scheduledTime.slice(3)))) return false;
    if (quietNow(latestClock.minutes, latestMember?.quietHours)) throw new Error('Quiet hours changed; defer call');
    if (existing.exists || !schedule.exists || !latestMember || latestMember.phone !== member.phone || (kind === 'reminder' && ['confirmed', 'reported', 'partial'].includes(dose.data()?.status)) || (kind !== 'consent' && latestMember.consent?.calls !== true)) return false;
    tx.create(ref, { ...input, ...(incomingSid ? { incomingSid } : {}), kind, state: kind === 'consent' ? 'consent' : 'menu', phone: member.phone, deviceId: enrollment.binding.deviceId, language: member.language ?? 'en', providerSid: '', providerStatus: 'reserved', status: 'active', consented: kind !== 'consent' && latest.data()?.consent?.calls === true, expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000), step: 0, unclearTurns: 0, createdAt: new Date().toISOString() }); return true;
  });
  if (!reserved) return { action: 'skipped' };
  try {
    const sid = await (suppliedProvider ?? new TwilioProvider(config)).call(member.phone, url(config, 'start', id), url(config, 'status', id));
    await db.runTransaction(async tx => { const snap = await tx.get(ref); if (snap.data()?.providerSid && snap.data()?.providerSid !== sid) throw new Error('Call binding conflict'); tx.update(ref, { providerSid: sid, providerStatus: nextStatus(snap.data()?.providerStatus, 'queued') }); });
    return { action: 'call_queued' };
  } catch {
    // An ambiguous provider timeout must not release the reservation and place a second call.
    await ref.update({ placementUncertain: true }); throw new Error('Call placement unavailable; reservation retained');
  }
}

async function say(r: Pick<twilio.twiml.VoiceResponse, 'play' | 'say'>, text: string, s: Session, id: string, textMl?: string) {
  const malayalam = s.language === 'ml' && !!textMl;
  if (s.language === 'ml' && !textMl) r.say({ language: 'en-IN' }, 'This prompt is currently available only in English.');
  try { const audio = await Promise.race([promptAudio(malayalam ? textMl! : text, malayalam ? 'ml' : 'en', { ...s, callId: id }), new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('Audio deadline')), 700); t.unref(); })]); r.play(audio); }
  catch { r.say({ language: 'en-IN' }, 'Malayalam audio is unavailable. English keypad instructions follow.'); r.say({ language: 'en-IN' }, text); }
}
async function menu(s: Session, id: string, c: TelephonyConfig, prefix = '') {
  const r = new twilio.twiml.VoiceResponse();
  const text = s.state === 'consent' ? 'Press 1 to agree to reminder calls. Press any other key to decline.' : s.state === 'count' ? 'How many tablets did you take? Enter the count then press hash.' : s.kind === 'callback' ? 'Press 1 to log now. Press 2 for status. Press 3 for a message. Press 4 for entered medicine purpose. Press 9 to repeat. Press 0 to speak.' : 'Press 1 if taken. Press 2 for a reminder later. Press 3 for a message. Press 4 for entered medicine purpose. Press 9 to repeat. Press 0 to speak.';
  const ml = s.state === 'consent' ? 'മരുന്ന് ഓർമ്മിപ്പിക്കുന്ന വിളികൾ സ്വീകരിക്കാൻ സമ്മതമെങ്കിൽ 1 അമർത്തുക.' : s.state === 'count' ? 'എത്ര ഗുളിക കഴിച്ചു?' : s.kind !== 'callback' ? 'കഴിച്ചെങ്കിൽ 1. ഇതുവരെ ഇല്ലെങ്കിൽ 2. സഹായിക്കുന്നയാളോട് സംസാരിക്കാൻ 3. മരുന്നിന്റെ വിവരം അറിയാൻ 4. വീണ്ടും കേൾക്കാൻ 9.' : undefined;
  if (prefix) await say(r, prefix, s, id);
  const gather = r.gather({ action: url(c, 'gather', id, s.step), method: 'POST', timeout: 10, ...(s.state === 'count' ? { finishOnKey: '#', numDigits: 2 } : { numDigits: 1 }) });
  await say(gather, text, s, id, ml); await say(gather, text, s, id, ml);
  r.redirect({ method: 'POST' }, url(c, 'gather', id, s.step)); return r.toString();
}
async function log(s: Session, count: number, evidence: { digits?: string; snippet?: string; spans?: { field: string; span: string }[] }, medicines: string[] = []) {
  return logDose(db, { ...doseKeySchema.parse(s), countTaken: count, medicinesTaken: medicines, source: 'call', evidence }, { uid: `device:${s.deviceId}`, role: 'device', deviceId: s.deviceId, memberId: s.memberId });
}
async function due(phone: string, c: TelephonyConfig, channel: 'calls' | 'sms', includeRecorded = false) {
  const e = await enrolled(phone, c, channel);
  if (e.member.consent?.calls !== true) throw new Error('No consent');
  const family = (await db.doc(`families/${e.binding.familyId}`).get()).data();
  const clock = localClock(new Date(), e.member.timezone ?? family?.timezone ?? 'Asia/Kolkata');
  const slots: Slot[] = [];
  const generations: Partial<Record<Slot, number>> = {};
  for (const slot of ['morning', 'noon', 'night'] as Slot[]) {
    const schedule = (await db.doc(`${base(e.binding as ReminderInput)}/schedule/${slot}`).get()).data();
    if (!schedule || !/^\d{2}:\d{2}$/.test(schedule.time)) continue;
    const minute = Number(schedule.time.slice(0, 2)) * 60 + Number(schedule.time.slice(3));
    const dose = (await db.doc(`${base(e.binding as ReminderInput)}/doses/${clock.date}_${slot}`).get()).data();
    const snooze = (await db.doc(`${base(e.binding as ReminderInput)}/snoozes/${clock.date}_${slot}`).get()).data()?.remindAt?.toMillis?.() ?? 0;
    if (clock.minutes >= minute && clock.minutes - minute <= 120 && snooze <= Date.now() && (includeRecorded || !['confirmed', 'reported', 'partial'].includes(dose?.status))) { slots.push(slot); if (snooze) generations[slot] = snooze; }
  }
  return { ...e, slots, generations, date: clock.date };
}

export function createWebhookHandler(channel: 'voice' | 'sms') {
  return async (req: Request, res: import('express').Response) => {
    const c = configuration();
    const path = req.path.replace(/^\/(voice|sms)(?=\/)/, '');
    const suffix = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const form = req.body as Record<string, string>;
    const signature = req.get('x-twilio-signature') ?? '';
    if (!c || req.method !== 'POST' || !req.is('application/x-www-form-urlencoded') || !form || Object.values(form).some(v => typeof v !== 'string') || !validSignature(c.token, signature, `${channel === 'voice' ? c.voiceUrl : c.smsUrl}${path}${suffix}`, form)) { res.status(403).send('Forbidden'); return; }
    // Nothing above this line reads Firestore or accepts forwarded host/protocol headers.
    try {
      if (path === '/incoming') {
        if (form.To !== c.from) throw new Error('Wrong recipient');
        if (channel === 'voice') {
          const r = new twilio.twiml.VoiceResponse(); r.reject({ reason: 'rejected' });
          try {
            if (!/^CA[0-9a-f]{32}$/i.test(form.CallSid)) throw new Error('Invalid incoming call');
            const event = db.doc(`telephonyIncoming/${form.CallSid}`), throttle = db.doc(`telephonyThrottle/${hash(form.From)}`);
            const reserved = await db.runTransaction(async tx => {
              const [prior, recent] = await Promise.all([tx.get(event), tx.get(throttle)]);
              if (prior.exists) return false;
              tx.create(event, { at: Timestamp.now(), phoneHash: hash(form.From) });
              if (recent.exists && Date.now() - recent.data()!.atMs < 300_000) return false;
              if (recent.exists) tx.update(throttle, { atMs: Date.now() }); else tx.create(throttle, { atMs: Date.now() });
              return true;
            });
            if (reserved) {
              const e = await due(form.From, c, 'calls', true);
              if (e.slots.length === 1) await placeCall({ familyId: e.binding.familyId, memberId: e.binding.memberId, date: e.date, slot: e.slots[0], attempt: 1, ...(e.generations[e.slots[0]] ? { generation: e.generations[e.slots[0]] } : {}) }, 'callback', c, undefined, form.CallSid);
            }
          } catch { /* Unknown and revoked callers receive the same rejection. */ }
          res.type('text/xml').send(r.toString());
          return;
        }
        const r = new twilio.twiml.MessagingResponse();
        if (!/^SM[0-9a-f]{32}$/i.test(form.MessageSid)) throw new Error('Invalid message');
        const event = db.doc(`telephonySms/${form.MessageSid}`);
        const fresh = await db.runTransaction(async tx => { if ((await tx.get(event)).exists) return false; tx.create(event, { at: new Date().toISOString() }); return true; });
        if (fresh) {
          const e = await due(form.From, c, 'sms');
          if (e.slots.length === 1 && ['1', '2'].includes(form.Body.trim())) {
            const s = { ...e.binding, phone: form.From, date: e.date, slot: e.slots[0], attempt: 1, ...(e.generations[e.slots[0]] ? { generation: e.generations[e.slots[0]] } : {}) } as Session;
            if (form.Body.trim() === '1') { const sch = (await db.doc(`${base(s)}/schedule/${s.slot}`).get()).data() as Schedule; await log(s, sch.medicines.reduce((n, m) => n + m.count, 0), { digits: '1' }); }
            else await retry(s);
          } else { r.message('Please request a callback to clarify the current slot.'); res.type('text/xml').send(r.toString()); return; }
        }
        r.message('Received. We will check your current dose record.'); res.type('text/xml').send(r.toString()); return;
      }
      if (channel !== 'voice' || !['/start', '/gather', '/turn', '/status'].includes(path)) { res.status(404).send('Not found'); return; }
      const id = req.query.callId;
      if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id) || !/^CA[0-9a-f]{32}$/i.test(form.CallSid)) throw new Error('Invalid call');
      const ref = db.doc(`calls/${id}`); let s = (await ref.get()).data() as Session | undefined;
      if (!s) throw new Error('Unknown call');
      // The initial callback can race the REST result; only the signed provider's expected numbers may bind it.
      if (!s.providerSid && path === '/start' && form.To === s.phone && form.From === c.from) {
        await db.runTransaction(async tx => { const data = (await tx.get(ref)).data(); if (!data?.providerSid) tx.update(ref, { providerSid: form.CallSid }); else if (data.providerSid !== form.CallSid) throw new Error('Wrong call'); });
        s = (await ref.get()).data() as Session;
      }
      if (s.providerSid !== form.CallSid) throw new Error('Wrong call');
      try { await current(s, c); } catch (error) { await ref.update({ status: 'revoked', consented: false }); throw error; }
      if (path === '/status') {
        const changed = await db.runTransaction(async tx => { const data = (await tx.get(ref)).data() as Session; const next = nextStatus(data.providerStatus, form.CallStatus); if (next !== data.providerStatus) tx.update(ref, { providerStatus: next, ...(terminal.has(next) ? { status: 'ended' } : {}) }); return ['busy', 'failed', 'no-answer', 'completed'].includes(next) && data.state !== 'done'; });
        if (changed && s.kind !== 'consent') await retry(s);
        res.status(204).send(); return;
      }
      if (terminal.has(s.providerStatus) || s.state === 'done') { res.type('text/xml').send(done('This call has ended.')); return; }
      if (path === '/start') { res.type('text/xml').send(await menu(s, id, c)); return; }
      const step = Number(req.query.step);
      if (!Number.isInteger(step) || step !== s.step) { res.type('text/xml').send(done('This response was already received.')); return; }
      const event = ref.collection('events').doc(String(step));
      if (path === '/turn') form.RecordingSid = recordingSidFromAction(c, form);
      if (path === '/turn' && (!['turn', 'message'].includes(s.state) || !/^RE[0-9a-f]{32}$/i.test(form.RecordingSid) || !/^\d+$/.test(form.RecordingDuration) || Number(form.RecordingDuration) > 8)) throw new Error('Invalid recording state');
      const recordingRef = path === '/turn' ? ref.collection('recordings').doc(form.RecordingSid) : undefined;
      const claimed = await db.runTransaction(async tx => { const [latest, prior, recording] = await Promise.all([tx.get(ref), tx.get(event), recordingRef ? tx.get(recordingRef) : undefined]); if (prior.exists || recording?.exists || latest.data()?.step !== step || latest.data()?.status !== 'active') return false; tx.create(event, { at: new Date().toISOString(), recordingSid: form.RecordingSid ?? '' }); if (recordingRef) tx.create(recordingRef, { providerSid: s!.providerSid, step }); tx.update(ref, { step: step + 1 }); return true; });
      if (!claimed) { res.type('text/xml').send(done('Already received.')); return; }
      s.step++;
      const finish = async (text: string, textMl?: string) => { const r = new twilio.twiml.VoiceResponse(); await say(r, text, s!, id, textMl); r.hangup(); s!.state = 'done'; await ref.update({ state: 'done', status: 'ended' }); return r.toString(); };
      let xml: string;
      if (path === '/turn') {
        if (!['turn', 'message'].includes(s.state) || !/^RE[0-9a-f]{32}$/i.test(form.RecordingSid) || Number(form.RecordingDuration) > 8) throw new Error('Invalid recording state');
        const provider = new TwilioProvider(c); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 3200); let recordingBound = false;
        try {
          const work = async () => {
            const audio = await provider.recording(s!.providerSid, form.RecordingSid, controller.signal);
            recordingBound = true;
            if (s!.state === 'message') return { message: await transcribeRecording(audio, controller.signal) };
            const member = await current(s!, c);
            const schedule = (await db.doc(`${base(s!)}/schedule/${s!.slot}`).get()).data() as Schedule;
            const u = await understandRecording(audio, { familyId: s!.familyId, deviceId: s!.deviceId, memberIds: [s!.memberId], clientTime: new Date().toISOString(), tz: member.timezone ?? 'Asia/Kolkata', slot: s!.slot }, { members: [{ id: s!.memberId, name: member.name ?? '', schedules: [schedule] }], recipients: [{ id: 'onDuty', name: 'On duty supporter', roles: ['supporter'] }] }, controller.signal);
            return u;
          };
          const u = await Promise.race([work(), new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Turn deadline')), { once: true }))]);
          if ('message' in u || (u.intent === 'message' && !u.needsClarification && u.messageText)) {
            await current(s, c);
            const { sendCallMessageService } = await import('../messages');
            const text = 'message' in u ? u.message : u.messageText!;
            const result = await sendCallMessageService(id, text, { provider: async () => ({ transcript: text, translations: [] }) });
            xml = await finish(result.textEn, result.textMl);
          } else if (['ask', 'why'].includes(u.intent) && !u.needsClarification && u.slot === s.slot) {
            const d = (await db.doc(`${base(s)}/doses/${s.date}_${s.slot}`).get()).data();
            xml = await menu(s, id, c, d && ['confirmed', 'reported', 'partial'].includes(d.status) ? 'A dose report is on record. Do not take it again based on this call.' : 'No confirmed report is on record. Ask your supporter before taking another dose.');
            s.state = 'menu'; await ref.update({ state: 'menu' });
          } else if (u.intent === 'explain' && !u.needsClarification) {
            const schedule = (await db.doc(`${base(s)}/schedule/${s.slot}`).get()).data();
            const entered = (schedule?.medicines ?? []).filter((m: { id: string; purpose?: string }) => u.medicines.includes(m.id) && typeof m.purpose === 'string').map((m: { name: string; purpose: string }) => `${m.name}: ${m.purpose}`).join('. ');
            s.state = 'menu'; await ref.update({ state: 'menu' }); xml = await menu(s, id, c, entered || 'No purpose was entered for that medicine. Ask your pharmacist.');
          } else if (u.intent === 'log' && !u.needsClarification && u.count !== null && u.slot === s.slot && u.members.length === 1 && !u.memberActions.length) {
            await current(s, c); const result = await log(s, u.count, { snippet: u.transcript, spans: u.evidence }, u.medicines); xml = await finish(result.reply.textEn, result.reply.textMl);
          } else {
            s.unclearTurns++; s.state = s.unclearTurns >= 2 ? 'menu' : 'turn';
            const r = new twilio.twiml.VoiceResponse();
            if (u.urgency === 'urgent') r.say({ language: 'en-IN' }, 'Call 108 for urgent help. Orma is not an emergency service. Your message has not been sent.');
            if (s.state === 'menu') xml = await menu(s, id, c, 'Please use the keypad. No change was made.');
            else { r.say({ language: 'en-IN' }, 'I could not safely act on that. Say the tablet count you took, or ask to send a message.'); r.record({ action: url(c, 'turn', id, s.step), method: 'POST', maxLength: 8, timeout: 2 }); xml = r.toString(); }
            await ref.update({ state: s.state, unclearTurns: s.unclearTurns });
          }
        } catch { s.state = 'menu'; await ref.update({ state: 'menu' }); xml = await menu(s, id, c, 'Speech is unavailable. No change was made.'); }
        finally {
          clearTimeout(timer); controller.abort();
          if (recordingBound) {
            try { await provider.deleteRecording(form.RecordingSid); }
            catch { await recordingRef!.update({ cleanupPending: true }); }
          } else await recordingRef!.update({ cleanupPending: true, bindingUnverified: true });
        }
      } else if (s.state === 'consent') {
        if (form.Digits === '1') { await db.doc(base(s)).update({ 'consent.calls': true, 'consent.at': new Date().toISOString() }); await ref.update({ consented: true }); xml = await finish('You agreed to reminder calls.'); }
        else { await db.doc(base(s)).update({ 'consent.calls': false }); xml = await finish('No reminder calls will be scheduled.'); }
      } else if (s.state === 'count') {
        if (!/^[1-9]\d?$/.test(form.Digits ?? '')) xml = await menu(s, id, c, 'Enter a valid count.');
        else { try { const result = await log(s, Number(form.Digits), { digits: `1${form.Digits}` }); xml = await finish(result.reply.textEn, result.reply.textMl); } catch { s.state = 'menu'; await ref.update({ state: 'menu' }); xml = await menu(s, id, c, 'Please clarify which medicines with your caregiver. Nothing was recorded.'); } }
      } else if (s.state !== 'menu') throw new Error('Wrong state');
      else if (form.Digits === '1') { s.state = 'count'; await ref.update({ state: 'count' }); xml = await menu(s, id, c); }
      else if (form.Digits === '2' && s.kind !== 'callback') { await retry(s); xml = await finish('A reminder was requested.'); }
      else if (form.Digits === '2') { const d = (await db.doc(`${base(s)}/doses/${s.date}_${s.slot}`).get()).data(); xml = await menu(s, id, c, d && ['confirmed', 'reported', 'partial'].includes(d.status) ? 'A dose report is on record. Do not take it again based on this call.' : 'There is no confirmed report for this slot. This does not mean you should take another dose.'); }
      else if (form.Digits === '3') { s.state = 'message'; await ref.update({ state: 'message' }); const r = new twilio.twiml.VoiceResponse(); await say(r, 'After the beep, leave a message for your on duty supporter. For urgent help call 108. Orma is not an emergency service.', s, id); r.record({ action: url(c, 'turn', id, s.step), method: 'POST', maxLength: 8, timeout: 2 }); xml = r.toString(); }
      else if (form.Digits === '4') { const sch = (await db.doc(`${base(s)}/schedule/${s.slot}`).get()).data(); const purposes = (sch?.medicines ?? []).filter((m: { purpose?: string }) => typeof m.purpose === 'string').map((m: { name: string; purpose: string }) => `${m.name}: ${m.purpose}`).join('. '); xml = await menu(s, id, c, purposes || 'No medicine purpose was entered. Ask your pharmacist.'); }
      else if (form.Digits === '0' || !form.Digits) { s.state = 'turn'; await ref.update({ state: 'turn' }); const r = new twilio.twiml.VoiceResponse(); await say(r, 'Say what you took and the tablet count, or ask to send a message.', s, id); r.record({ action: url(c, 'turn', id, s.step), method: 'POST', maxLength: 8, timeout: 2 }); xml = r.toString(); }
      else xml = await menu(s, id, c);
      res.type('text/xml').send(xml);
    } catch { if (!res.headersSent) { if (path === '/status') res.status(503).send('Unavailable'); else if (channel === 'sms') { const r = new twilio.twiml.MessagingResponse(); r.message('Unable to process. Please contact your supporter.'); res.type('text/xml').send(r.toString()); } else res.type('text/xml').send(generic); } }
  };
}
export const voice = onRequest({ region: 'asia-south1', secrets: ['TWILIO_AUTH_TOKEN', 'OPENAI_API_KEY'], timeoutSeconds: 30 }, createWebhookHandler('voice'));
export const sms = onRequest({ region: 'asia-south1', secrets: ['TWILIO_AUTH_TOKEN'], timeoutSeconds: 30 }, createWebhookHandler('sms'));
