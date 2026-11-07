import { z } from 'zod';

const id = z.string().min(1).max(128).refine(value => !value.includes('/'));
const slot = z.enum(['morning', 'noon', 'night']);
const count = z.number().int().min(0).max(99).nullable();
const uniqueIds = z.array(id).max(30).refine(values => new Set(values).size === values.length);
export const understandInputSchema = z.strictObject({
  familyId: id, deviceId: id, memberIds: uniqueIds.nonempty(),
  transcript: z.string().trim().min(1).max(10000).optional(),
  audioBase64: z.string().max(1398104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).optional(),
  mimeType: z.enum(['audio/aac', 'audio/ogg']).optional(),
  durationSeconds: z.number().positive().max(15).optional(),
  clientTime: z.iso.datetime({ offset: true }),
  tz: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }),
  slot: slot.optional(),
}).superRefine((input, ctx) => {
  if ((input.transcript !== undefined) === (input.audioBase64 !== undefined)) ctx.addIssue({ code: 'custom', message: 'Provide exactly one transcript or audio.' });
  if (input.audioBase64 !== undefined && (!input.mimeType || !input.audioBase64.length || Buffer.from(input.audioBase64, 'base64').length > 1048576)) ctx.addIssue({ code: 'custom', message: 'Audio requires MIME type and at most 1 MiB.' });
});

export const understandingSchema = z.strictObject({
  transcript: z.string().max(10000),
  intent: z.enum(['log', 'ask', 'message', 'snooze', 'explain', 'why', 'setSharing', 'unclear']),
  members: uniqueIds, slot: slot.nullable(), count,
  medicines: uniqueIds, snoozeReason: z.enum(['not_eaten', 'not_home', 'later']).nullable(),
  messageTo: z.string().nullable(), messageText: z.string().max(10000).nullable(),
  urgency: z.enum(['normal', 'urgent']), needsClarification: z.boolean(), clarifyQuestion: z.string().nullable(),
  evidence: z.array(z.strictObject({ field: z.string(), span: z.string().min(1) })).max(100),
  sharingChanges: z.strictObject({ supporterId: z.string().nullable(), counts: z.boolean().nullable(), messages: z.boolean().nullable(), risk: z.boolean().nullable(), askedTwice: z.boolean().nullable(), nurseNotes: z.boolean().nullable() }).nullable(),
  memberActions: z.array(z.strictObject({ memberId: id, taken: z.boolean(), count, medicines: z.array(id) })).max(30),
});
export type UnderstandInput = z.infer<typeof understandInputSchema>;
export type Understanding = z.infer<typeof understandingSchema>;
export type UnderstandContext = { members: { id: string; name: string; schedules: unknown[] }[]; recipients: { id: string; name: string; roles: string[] }[] };
export type UnderstandProvider = (input: UnderstandInput, context: UnderstandContext, signal: AbortSignal) => Promise<unknown>;

export function unclear(transcript: string): Understanding {
  return { transcript, intent: 'unclear', members: [], slot: null, count: null, medicines: [], snoozeReason: null, messageTo: null, messageText: null, urgency: 'normal', needsClarification: true, clarifyQuestion: 'Please say who and which medicine or dose you mean.', evidence: [], sharingChanges: null, memberActions: [] };
}

const question = /[?？]|\b(did|have|has|should|can|could|whether|kazhicho|kazhichuvo|kazhichittundo)\b|കഴിച്ചോ|കഴിച്ചുവോ|കഴിച്ചിട്ടുണ്ടോ/iu;
const negative = /\b(not|never|didn't|haven't|hasn't|kazhichilla|kazhichittilla|illa)\b|കഴിച്ചില്ല|കഴിച്ചിട്ടില്ല/iu;
const affirmative = /\b(kazhichu|took|taken|swallowed)\b|കഴിച്ചു/iu;
const uncertain = /\b(will|would|might|maybe|perhaps|unsure|remember|think|plan|going to)\b|ഓർമ്മയില്ല|കഴിക്കാം/iu;

export function verifyUnderstanding(raw: unknown, input: UnderstandInput): Understanding {
  const value = understandingSchema.parse(raw);
  if (input.transcript !== undefined && value.transcript !== input.transcript) return unclear(input.transcript);
  value.evidence = value.evidence.filter(item => value.transcript.includes(item.span));
  const has = (field: string) => value.evidence.some(item => item.field === field);
  const clarify = () => { value.needsClarification = true; value.clarifyQuestion ||= 'Please confirm who and which dose or medicine you mean.'; };
  if (value.members.some(member => !input.memberIds.includes(member)) || value.memberActions.some(action => !input.memberIds.includes(action.memberId))) return unclear(value.transcript);
  if (!value.members.length && input.memberIds.length === 1) value.members = [...input.memberIds];
  if (value.slot === null && input.slot) value.slot = input.slot;
  if (value.members.length > 0 && !(input.memberIds.length === 1 && value.members[0] === input.memberIds[0]) && !has('members') && !value.memberActions.length) clarify();
  if (value.slot !== null && value.slot !== input.slot && !has('slot')) clarify();
  if (value.count !== null && !has('count')) clarify();
  if (value.medicines.length && !has('medicines')) clarify();
  if (value.snoozeReason !== null && !has('snoozeReason')) clarify();
  if (value.messageTo !== null && value.messageTo !== 'onDuty' && !has('messageTo')) clarify();
  if (value.messageText !== null && (!has('messageText') || !value.transcript.includes(value.messageText))) clarify();
  if (value.urgency === 'urgent' && !has('urgency')) clarify();
  if (value.memberActions.length && value.intent !== 'log') return unclear(value.transcript);
  if (value.sharingChanges && value.intent !== 'setSharing') return unclear(value.transcript);
  if (['ask', 'snooze', 'why'].includes(value.intent) && (!value.members.length || !value.slot)) clarify();
  if (value.intent === 'snooze' && value.snoozeReason === null) clarify();
  if (value.intent === 'log') {
    if (question.test(value.transcript) || uncertain.test(value.transcript)) return unclear(value.transcript);
    if (!value.members.length || !value.slot) clarify();
    if (value.memberActions.length) {
      if (!value.memberActions.some(action => action.taken)) return unclear(value.transcript);
      if (new Set(value.memberActions.map(action => action.memberId)).size !== value.memberActions.length) return unclear(value.transcript);
      value.memberActions.forEach((action, i) => {
        const span = value.evidence.find(item => item.field === `memberActions.${i}`)?.span;
        if (!span || !value.members.includes(action.memberId) || (action.taken && (!affirmative.test(span) || negative.test(span)))) clarify();
        if (action.count !== null && !has(`memberActions.${i}.count`)) clarify();
        if (action.medicines.length && !has(`memberActions.${i}.medicines`)) clarify();
      });
    } else {
      if (negative.test(value.transcript)) return unclear(value.transcript);
      if (!value.evidence.some(item => item.field === 'intent' && affirmative.test(item.span) && !negative.test(item.span))) clarify();
    }
  } else if (value.intent === 'message') {
    if (!value.members.length || !value.messageTo || !value.messageText || (!has('intent') && !(value.urgency === 'urgent' && has('urgency')))) clarify();
  } else if (value.intent === 'setSharing') {
    if (value.members.length !== 1 || !value.sharingChanges || !has('sharingChanges')) clarify();
    if (value.sharingChanges?.supporterId !== null && !has('sharingChanges.supporterId')) clarify();
  } else if (value.intent !== 'unclear' && !has('intent')) clarify();
  if (value.intent === 'explain' && !value.medicines.length) clarify();
  if (value.intent === 'unclear') clarify();
  if (value.needsClarification) clarify(); else value.clarifyQuestion = null;
  return understandingSchema.parse(value);
}

export async function runUnderstanding(input: UnderstandInput, context: UnderstandContext, providers: UnderstandProvider[]): Promise<Understanding> {
  for (const provider of providers) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        provider(input, context, controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Provider deadline')); }, 6000); }),
      ]);
      return verifyUnderstanding(raw, input);
    } catch {
      // Provider errors and malformed output are never exposed to the caller.
    } finally { clearTimeout(timer); }
  }
  return unclear(input.transcript ?? '');
}
