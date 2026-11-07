import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../platform/firebase';
import { requireAuth, resolveMemberAccess, sharingAllowed } from '../platform/auth';
import { doseKeySchema } from './core';

type SupportMedicine = { id: string; name: string; purpose?: string; ifUnsure?: string; timeCritical?: boolean; aliases?: string[] };
type SupportSchedule = { time?: string; afterFood?: boolean; timeCritical?: boolean; medicines: SupportMedicine[] };
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
function localParts(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const value = (key: string) => parts.find(part => part.type === key)!.value;
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
}

/** Resolve a wall-clock time, rejecting nonexistent and ambiguous DST minutes rather than guessing. */
export function localInstant(date: string, time: string, zone: string): Date {
  if (!clock.test(time)) throw new HttpsError('failed-precondition', 'A confirmed schedule time is required.');
  const wall = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = new Date(wall + hours * 3600000);
    const local = localParts(probe, zone);
    offsets.add(Date.parse(`${local.date}T${local.time}:00Z`) - probe.getTime());
  }
  const matches = [...offsets].map(offset => new Date(wall - offset)).filter(at => {
    const local = localParts(at, zone); return local.date === date && local.time === time;
  });
  if (matches.length !== 1) throw new HttpsError('failed-precondition', 'Schedule time is ambiguous or unavailable in this timezone.');
  return matches[0];
}

export function planSnooze(input: { date: string; slot: 'morning' | 'noon' | 'night'; reason: 'not_eaten' | 'not_home' | 'later'; delayMinutes?: number },
  schedule: SupportSchedule, meals: Record<string, string>, zone: string, now: Date) {
  const due = localInstant(input.date, schedule.time ?? '', zone);
  if (localParts(now, zone).date !== input.date) throw new HttpsError('failed-precondition', 'Only today’s dose can be snoozed.');
  if (schedule.timeCritical || schedule.medicines.some(medicine => medicine.timeCritical)) {
    return { allowed: false as const, dueAt: due.toISOString(), textEn: 'This medicine has time-critical instructions. Do not change its timing; ask your pharmacist or care team.',
      textMl: 'ഈ മരുന്നിന് സമയക്രമം പ്രധാനമാണ്. സമയം മാറ്റരുത്; ഫാർമസിസ്റ്റിനോടോ പരിചരണ സംഘത്തോടോ ചോദിക്കുക.' };
  }
  if (input.delayMinutes !== undefined && (!Number.isInteger(input.delayMinutes) || input.delayMinutes < 1 || input.delayMinutes > 120)) throw new HttpsError('invalid-argument', 'Snooze must be between 1 and 120 minutes.');
  let remindAt = new Date(now.getTime() + (input.delayMinutes ?? 30) * 60000);
  if (input.reason === 'not_eaten' && schedule.afterFood) {
    const meal = meals[{ morning: 'breakfast', noon: 'lunch', night: 'dinner' }[input.slot]];
    if (meal && clock.test(meal)) {
      const mealAt = localInstant(input.date, meal, zone);
      if (mealAt > now && mealAt >= due) remindAt = mealAt;
    }
  }
  const time = localParts(remindAt, zone).time;
  return { allowed: true as const, remindAt: remindAt.toISOString(), dueAt: due.toISOString(),
    textEn: `I will remind you again at ${time}. This does not record a dose as taken.`,
    textMl: `${time}-ന് വീണ്ടും ഓർമ്മിപ്പിക്കാം. ഇത് മരുന്ന് കഴിച്ചതായി രേഖപ്പെടുത്തുന്നില്ല.` };
}

const snoozeSchema = doseKeySchema.extend({ reason: z.enum(['not_eaten', 'not_home', 'later']), delayMinutes: z.number().int().min(1).max(120).optional() }).strict();
export async function snoozeService(uid: string, raw: unknown, now = new Date()) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const parsed = snoozeSchema.safeParse(raw);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid snooze request.');
  const input = parsed.data;
  const context = await resolveMemberAccess(uid, input.familyId, input.memberId);
  const family = (await db.doc(`families/${input.familyId}`).get()).data() ?? {};
  const key = `${input.date}_${input.slot}`;
  return db.runTransaction(async tx => {
    const [dose, schedule, member] = await Promise.all([
      tx.get(context.memberRef.collection('doses').doc(key)), tx.get(context.memberRef.collection('schedule').doc(input.slot)), tx.get(context.memberRef),
    ]);
    if (['confirmed', 'reported', 'partial'].includes(dose.data()?.status)) throw new HttpsError('failed-precondition', 'This dose is already recorded.');
    if (!schedule.exists) throw new HttpsError('not-found', 'Confirmed schedule not found.');
    const result = planSnooze(input, schedule.data() as SupportSchedule, member.data()?.usualMealTimes ?? {}, family.timezone ?? 'Asia/Kolkata', now);
    if (result.allowed) tx.set(context.memberRef.collection('snoozes').doc(key), { date: input.date, slot: input.slot, reason: input.reason,
      remindAt: Timestamp.fromDate(new Date(result.remindAt)), by: uid, at: FieldValue.serverTimestamp() });
    return result;
  });
}

const normalize = (text: string) => text.trim().normalize('NFKC').toLocaleLowerCase();
export function explainEnteredMedicine(schedules: SupportSchedule[], hint: string) {
  const matches = new Map<string, SupportMedicine>();
  for (const schedule of schedules) for (const medicine of schedule.medicines) {
    if ([medicine.id, medicine.name, ...(medicine.aliases ?? [])].some(name => normalize(name) === normalize(hint))) {
      const previous = matches.get(medicine.id);
      if (previous && (previous.purpose !== medicine.purpose || previous.ifUnsure !== medicine.ifUnsure)) {
        return unknownMedicine(true);
      }
      matches.set(medicine.id, medicine);
    }
  }
  if (matches.size !== 1) return unknownMedicine(matches.size > 1);
  const medicine = [...matches.values()][0];
  if (!medicine.purpose?.trim()) return unknownMedicine(false);
  return { found: true, needsClarification: false, reply: { templateId: 'medicine_known', vars: { medicine: medicine.name, purpose: medicine.purpose },
    textEn: `Your family-confirmed record says ${medicine.name}: ${medicine.purpose}.${medicine.ifUnsure ? ` ${medicine.ifUnsure}` : ''}`,
    textMl: `കുടുംബം സ്ഥിരീകരിച്ച രേഖയിൽ ${medicine.name}: ${medicine.purpose}.${medicine.ifUnsure ? ` ${medicine.ifUnsure}` : ''}` } };
}
function unknownMedicine(ambiguous: boolean) {
  return { found: false, needsClarification: ambiguous, reply: { templateId: 'medicine_unknown', vars: {},
    textEn: ambiguous ? 'Which medicine do you mean? Please use its full confirmed name.' : 'No confirmed purpose is recorded for that medicine. Ask your family or pharmacist; I will not guess.',
    textMl: ambiguous ? 'ഏത് മരുന്നാണ്? സ്ഥിരീകരിച്ച മുഴുവൻ പേര് പറയുക.' : 'ഈ മരുന്നിന്റെ ആവശ്യകത സ്ഥിരീകരിച്ച രേഖയിൽ ഇല്ല. കുടുംബത്തോടോ ഫാർമസിസ്റ്റിനോടോ ചോദിക്കുക; ഞാൻ ഊഹിക്കില്ല.' } };
}
const explainSchema = z.object({ familyId: z.string(), memberId: z.string(), medicineHint: z.string().trim().min(1).max(200) }).strict();
export async function explainMedicineService(uid: string, raw: unknown) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const parsed = explainSchema.safeParse(raw);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid medicine request.');
  const input = parsed.data;
  const context = await resolveMemberAccess(uid, input.familyId, input.memberId);
  if (!sharingAllowed(context, 'counts')) throw new HttpsError('permission-denied', 'Medicine details are not shared with you.');
  const schedules = await context.memberRef.collection('schedule').get();
  return explainEnteredMedicine(schedules.docs.map(doc => doc.data() as SupportSchedule), input.medicineHint);
}
const options = { region: 'asia-south1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' };
export const snooze = onCall(options, request => snoozeService(requireAuth(request), request.data));
export const explainMedicine = onCall(options, request => explainMedicineService(requireAuth(request), request.data));
