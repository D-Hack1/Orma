import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { requireAuth, resolveMemberAccess, sharingAllowed } from '../platform/auth';
import { db } from '../platform/firebase';
import { runUnderstanding, understandInputSchema, unclear, type UnderstandContext } from './core';
import { geminiProvider, openaiProvider } from './providers';

export const understand = onCall({ region: 'asia-south1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', secrets: ['OPENAI_API_KEY'], timeoutSeconds: 30 }, async request => {
  const uid = requireAuth(request);
  const parsed = understandInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid speech input.');
  const input = parsed.data;
  const device = (await db.doc(`devices/${input.deviceId}`).get()).data();
  if (!device || device.familyId !== input.familyId || !Array.isArray(device.memberIds) || !input.memberIds.every(id => device.memberIds.includes(id))) {
    throw new HttpsError('permission-denied', 'Device binding does not allow these members.');
  }
  const access = await Promise.all(input.memberIds.map(id => resolveMemberAccess(uid, input.familyId, id)));
  const members = await Promise.all(access.map(async context => {
    const schedules = await context.memberRef.collection('schedule').get();
    return { id: context.memberId, name: String(context.member.name ?? context.memberId), schedules: schedules.docs.map(doc => ({ slot: doc.id,
      medicines: sharingAllowed(context, 'counts') ? (doc.data().medicines ?? []).map((medicine: { id: string; name: string }) => ({ id: medicine.id, name: medicine.name })) : [],
    })) };
  }));
  // Membership supplies names/IDs, not private health records of other family members.
  const active = await db.collection(`families/${input.familyId}/access`).where('active', '==', true).get();
  const recipients: UnderstandContext['recipients'] = await Promise.all(active.docs.map(async doc => {
    const profile = await getAuth().getUser(doc.id).catch(() => undefined);
    return { id: doc.id, name: String(profile?.displayName ?? doc.data().name ?? doc.id), roles: Array.isArray(doc.data().roles) ? doc.data().roles : [] };
  }));
  const result = await runUnderstanding(input, { members, recipients }, [geminiProvider, openaiProvider]);
  const medicineIds = new Set(members.flatMap(member => member.schedules.flatMap(schedule => schedule.medicines.map((medicine: { id: string }) => medicine.id))));
  if (result.medicines.some(id => !medicineIds.has(id)) || result.memberActions.some(action => action.medicines.some(id => !medicineIds.has(id)))) return unclear(result.transcript);
  if (result.memberActions.some(action => {
    const member = members.find(member => member.id === action.memberId);
    const allowed = new Set(member?.schedules.flatMap(schedule => schedule.medicines.map((medicine: { id: string }) => medicine.id)));
    return action.medicines.some(id => !allowed.has(id));
  })) return unclear(result.transcript);
  if (result.messageTo && result.messageTo !== 'onDuty' && !recipients.some(recipient => recipient.id === result.messageTo)) return unclear(result.transcript);
  if (result.sharingChanges?.supporterId && !recipients.some(recipient => recipient.id === result.sharingChanges!.supporterId)) return unclear(result.transcript);
  if (result.intent === 'setSharing' && (access.length !== 1 || !access.every(context => context.isOwner || context.isGuardian))) {
    return unclear(result.transcript);
  }
  return result;
});
