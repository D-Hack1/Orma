import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db } from '../platform/firebase';
import { documentId, requireAuth, resolveMemberAccess, sharingAllowed, type MemberAccess } from '../platform/auth';
import { geminiMessageProvider, messageResultSchema, type MessageProvider } from './providers';

const inputSchema = z.object({ familyId: z.string(), memberId: z.string(), fromId: z.string().optional(),
  to: z.string().min(1).max(128), text: z.string().trim().min(1).max(2000).optional(),
  audioUrl: z.string().max(2048).optional(), retainAudio: z.boolean().default(false),
}).strict().refine(value => value.text !== undefined || value.audioUrl !== undefined, 'A message is required');

// shortcut: free-form model translations cannot be proven faithful; expand this reviewed phrase list before displaying more.
const reviewedTranslations = [
  { originals: ['please call me', 'enne vilikku', 'എന്നെ വിളിക്കൂ'], ml: 'എന്നെ വിളിക്കൂ', en: 'Please call me' },
  { originals: ['enikku thalavedana undu', 'എനിക്ക് തലവേദനയുണ്ട്', 'i have a headache'], ml: 'എനിക്ക് തലവേദനയുണ്ട്', en: 'I have a headache' },
  { originals: ['nenju vedana', 'നെഞ്ചുവേദന', 'chest pain'], ml: 'നെഞ്ചുവേദന', en: 'Chest pain' },
  { originals: ['veenu', 'വീണു', 'i fell'], ml: 'വീണു', en: 'I fell' },
  { originals: ['swasam muttal', 'ശ്വാസം മുട്ടുന്നു', 'breathless'], ml: 'ശ്വാസം മുട്ടുന്നു', en: 'Breathless' },
  { originals: ['thala karakkam', 'തലകറക്കം', 'dizzy'], ml: 'തലകറക്കം', en: 'Dizzy' },
];

export function isUrgentMessage(text: string): boolean {
  return /chest[\s-]*pain|\b(?:fell|fallen|fall|breathless|dizzy|dizziness)\b|can['’]?t\s*breathe|shortness\s+of\s+breath|nenj[uie]?[\s-]*vedana|veenu|veen[uoa]|s[wh]asam\s*mu[tth]+al|shwasam\s*mut[t]?al|thala\s*kara[k]+am|നെഞ്ചു?\s*വേദന|നെഞ്ച്\s*വേദന|നെഞ്ചുവേദന|വീണു|ശ്വാസം\s*മുട്ട|തല\s*കറക്കം|തലകറക്കം/iu.test(text);
}

export type MessageNotification = { familyId: string; memberId: string; messageId: string; to: string[];
  urgency: 'normal' | 'urgent'; text: string; urgent108: boolean };
export type MessageDependencies = {
  provider?: MessageProvider;
  readAudio?: (context: MemberAccess, url: string, kind: 'audio') => Promise<{ bytes: Buffer; mimeType: string }>;
  notify?: (message: MessageNotification) => Promise<{ delivered: boolean }>;
  now?: Date;
};

function onDuty(roster: Record<string, unknown>[], zone: string, now: Date): Set<string> {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(part('weekday')) + 1;
  const time = `${part('hour')}:${part('minute')}`;
  return new Set(roster.filter(row => Array.isArray(row.days) && typeof row.from === 'string' && typeof row.to === 'string' &&
    (row.from <= row.to ? row.days.includes(day) && time >= row.from && time < row.to
      : (row.days.includes(day) && time >= row.from) || (row.days.includes(day === 1 ? 7 : day - 1) && time < row.to)))
    .map(row => row.memberId).filter((id): id is string => typeof id === 'string'));
}

/** Server-only service: uid MUST come from verified Auth, never request.data.fromId. */
export async function sendMessageService(uid: string, raw: unknown, deps: MessageDependencies = {}) {
  return saveMessage(uid, raw, deps);
}

async function saveMessage(uid: string, raw: unknown, deps: MessageDependencies, callId?: string) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid message.');
  const input = parsed.data;
  const context = await resolveMemberAccess(uid, input.familyId, input.memberId);
  if (input.fromId !== undefined && input.fromId !== uid && !(context.isOwner && input.fromId === input.memberId)) {
    throw new HttpsError('permission-denied', 'Sender does not match authenticated identity.');
  }
  if (!context.isOwner && !sharingAllowed(context, 'messages')) throw new HttpsError('permission-denied', 'Messages are not shared with you.');
  const retain = input.retainAudio && !!input.audioUrl;
  if (retain && (!context.isOwner || context.member.consent?.messageAudio !== true)) {
    throw new HttpsError('permission-denied', 'Explicit member consent is required to retain message audio.');
  }
  if (input.to !== 'onDuty') documentId(input.to, 'recipient');
  const [accessSnap, familySnap] = await Promise.all([
    db.collection(`families/${input.familyId}/access`).get(), db.doc(`families/${input.familyId}`).get(),
  ]);
  const family = familySnap.data() ?? {};
  const duty = onDuty(family.roster ?? [], family.timezone ?? 'Asia/Kolkata', deps.now ?? new Date());
  const eligible: string[] = [];
  for (const row of accessSnap.docs) {
    try {
      const recipient = await resolveMemberAccess(row.id, input.familyId, input.memberId);
      // A member explicitly sending their own message grants ONLY this addressed delivery.
      if (context.isOwner || recipient.isOwner || sharingAllowed(recipient, 'messages')) eligible.push(row.id);
    } catch (error) {
      if (!(error instanceof HttpsError) || error.code !== 'permission-denied') throw error;
    }
  }
  const addressed = input.to === input.memberId ? context.member.ownerUid : input.to;
  let recipients = eligible.filter(id => input.to === 'onDuty' ? duty.has(id) : id === addressed);
  if (!recipients.length && callId && input.to === 'onDuty') {
    recipients = eligible.filter(id => context.member.nurseIds?.includes(id));
  }
  if (!recipients.length) throw new HttpsError('permission-denied', 'No authorized active recipient.');
  let audio: { bytes: Buffer; mimeType: string } | undefined;
  if (input.audioUrl) {
    const reader = deps.readAudio ?? (await import('../platform/media')).readAuthorizedMedia;
    audio = await reader(context, input.audioUrl, 'audio');
    if (!audio.bytes.length || audio.bytes.length > 1024 * 1024 || !['audio/aac', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/mp4'].includes(audio.mimeType)) {
      throw new HttpsError('invalid-argument', 'Audio is too large or unsupported.');
    }
  }
  let text = input.text ?? '';
  const translated: Record<string, string> = {};
  let fallbackUsed = true;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      (deps.provider ?? geminiMessageProvider)({ text: input.text, audio }, controller.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Timeout')); }, 6500); }),
    ]);
    const value = messageResultSchema.parse(result);
    if (input.text !== undefined && value.transcript !== input.text) throw new Error('Original changed');
    if (!value.transcript.trim()) throw new Error('No faithful transcript');
    text = value.transcript;
    const reviewed = reviewedTranslations.find(phrase => phrase.originals.includes(text.trim().toLocaleLowerCase()));
    for (const translation of value.translations) {
      if (translation.source === text && translation.backTranslation === text &&
        reviewed?.[translation.language] === translation.text) translated[translation.language] = translation.text;
    }
    fallbackUsed = false;
  } catch { /* Original text/audio remains available; never fabricate a transcript offline. */ }
  finally { clearTimeout(timer); controller.abort(); }
  if (!text && !input.retainAudio) throw new HttpsError('unavailable', 'Could not transcribe audio. Please retry or type your message.');
  const urgency = isUrgentMessage(`${input.text ?? ''} ${text}`) ? 'urgent' as const : 'normal' as const;
  if (urgency === 'urgent') recipients = [...new Set([...recipients, ...eligible.filter(id => duty.has(id))])];
  const ref = context.memberRef.collection('messages').doc();
  const message = { from: uid, to: recipients, text, translated, urgency, at: FieldValue.serverTimestamp(),
    ...(callId ? { source: 'call', callId } : {}),
    sharingVersion: context.sharing.version ?? 0, directDelivery: context.isOwner,
    ...(retain ? { audioUrl: input.audioUrl } : {}) };
  const batch = db.batch();
  batch.set(ref, message);
  for (const id of recipients) batch.set(db.doc(`families/${input.familyId}/views/${id}/members/${input.memberId}/messages/${ref.id}`), message);
  await batch.commit();
  if (!deps.notify) deps = { ...deps, notify: async notification => {
    const { createAlert, routeNotification } = await import('../alerts');
    if (notification.urgency === 'urgent') await createAlert(db, { familyId: input.familyId, memberId: input.memberId,
      type: 'urgent', urgency: 'urgent', rule: `urgent_message_${createHash('sha256').update(ref.id).digest('hex').slice(0, 16)}` });
    const sent = await routeNotification(db, { familyId: input.familyId, memberId: input.memberId,
      recipientIds: notification.to, kind: 'message', eventId: notification.messageId, urgency: notification.urgency });
    return { delivered: notification.to.every(id => sent.includes(id)) };
  } };
  let notificationStatus: 'not-configured' | 'sent' | 'failed' = 'not-configured';
  if (deps.notify) {
    try { notificationStatus = (await deps.notify({ familyId: input.familyId, memberId: input.memberId, messageId: ref.id,
      to: recipients, urgency, text, urgent108: urgency === 'urgent' })).delivered ? 'sent' : 'failed'; }
    catch { notificationStatus = 'failed'; }
  }
  return { messageId: ref.id, urgency, notificationStatus, fallbackUsed, templateId: urgency === 'urgent' ? 'urgent108' : 'message_saved', textMl: urgency === 'urgent'
    ? 'അടിയന്തര സഹായത്തിന് 108 വിളിക്കുക. ഓർമ്മ അടിയന്തര സേവനമല്ല. സന്ദേശം സൂക്ഷിച്ചു; അറിയിപ്പ് ലഭിച്ചതിന് ഉറപ്പില്ല.'
    : 'സന്ദേശം സൂക്ഷിച്ചു. അറിയിപ്പ് ലഭിച്ചതിന് ഉറപ്പില്ല.', textEn: urgency === 'urgent'
    ? 'Call 108 for emergency help. Orma is not an emergency service. Message saved; notification receipt is not guaranteed.'
    : 'Message saved; notification receipt is not guaranteed.' };
}

/** Internal capability, never a callable. Session and phone binding were created by trusted telephony. */
export async function sendCallMessageService(callId: string, text: string, deps: MessageDependencies = {}) {
  documentId(callId, 'callId');
  const deny = () => new HttpsError('permission-denied', 'Call message authorization is no longer valid.');
  const session = (await db.doc(`calls/${callId}`).get()).data();
  const expiry = session?.expiresAt?.toDate instanceof Function ? session.expiresAt.toDate() : new Date(session?.expiresAt ?? 0);
  if (!session || session.status !== 'active' || session.consented !== true || !Number.isFinite(expiry.getTime()) || expiry <= (deps.now ?? new Date())) throw deny();
  const { familyId, memberId, deviceId } = session;
  documentId(familyId, 'familyId'); documentId(memberId, 'memberId'); documentId(deviceId, 'deviceId');
  const [memberSnap, deviceSnap] = await Promise.all([
    db.doc(`families/${familyId}/members/${memberId}`).get(), db.doc(`devices/${deviceId}`).get(),
  ]);
  const member = memberSnap.data();
  const device = deviceSnap.data();
  if (!member?.ownerUid || !/^\+[1-9]\d{7,14}$/.test(member.phone ?? '') || session.phone !== member.phone || member.consent?.calls !== true ||
    !member.deviceIds?.includes(deviceId) || device?.active === false || device?.familyId !== familyId || !device?.memberIds?.includes(memberId)) throw deny();
  const hash = createHash('sha256').update(member.phone).digest('hex');
  const binding = (await db.doc(`phoneBindings/${hash}`).get()).data();
  if (binding?.verified !== true || binding.calls !== true || binding.familyId !== familyId ||
    binding.memberId !== memberId || binding.deviceId !== deviceId) throw deny();
  const owner = await resolveMemberAccess(member.ownerUid, familyId, memberId);
  if (!owner.isOwner) throw deny();
  return saveMessage(member.ownerUid, { familyId, memberId, to: 'onDuty', text, retainAudio: false }, deps, callId);
}

export const sendMessage = onCall({ region: 'asia-south1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', timeoutSeconds: 30 },
  request => sendMessageService(requireAuth(request), request.data));
