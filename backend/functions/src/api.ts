import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { ZodError } from 'zod';
import { requireAuth, resolveMemberAccess, type MemberAccess } from './platform/auth';
import { db } from './platform/firebase';
import { logDose as recordDose, doseKeySchema, logDoseSchema, type Actor } from './doses';
import { askStatus as readStatus, askStatusSchema } from './replies';
import { explain as readExplanation, explainSchema } from './explain';

function actor(context: MemberAccess): Actor {
  return { uid: context.uid, memberId: context.memberId,
    role: context.isOwner ? 'member' : context.isGuardian ? 'guardian' : context.isNurse ? 'nurse' : 'supporter' };
}

async function handle(request: CallableRequest, action: 'log' | 'status' | 'explain') {
  const uid = requireAuth(request);
  try {
    const key = doseKeySchema.parse(request.data);
    const context = await resolveMemberAccess(uid, key.familyId, key.memberId);
    const viewer = actor(context);
    if (action === 'explain') return await readExplanation(db, explainSchema.parse(request.data), viewer);
    if (action === 'status') return await readStatus(db, askStatusSchema.parse(request.data), viewer);
    const result = await recordDose(db, logDoseSchema.parse(request.data), viewer);
    // Read through the same privacy-filtered reply engine; never manufacture dose facts here.
    const reply = await readStatus(db, key, viewer);
    return { ...result, reply: { templateId: result.result === 'duplicate_blocked' ? 'duplicate_blocked' : result.status,
      vars: {}, textMl: reply.textMl, textEn: reply.textEn } };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof ZodError) throw new HttpsError('invalid-argument', 'Check the member, date, slot and dose fields.');
    // Do not disclose document paths, private records or provider details in callable errors.
    throw new HttpsError('failed-precondition', 'This request could not be completed safely. Check the schedule or ask your supporter.');
  }
}

const options = { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' };
export const logDose = onCall(options, request => handle(request, 'log'));
export const askStatus = onCall(options, request => handle(request, 'status'));
export const answer = onCall(options, request => handle(request, 'status'));
export const explain = onCall(options, request => handle(request, 'explain'));
