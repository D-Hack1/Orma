import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z, ZodError } from 'zod';
import { requireAuth, resolveMemberAccess, type MemberAccess } from './platform/auth';
import { db } from './platform/firebase';
import { logDose as recordDose, doseKeySchema, logDoseSchema, type Actor } from './doses';
import { askStatus as readStatus, askStatusSchema } from './replies';
import { explain as readExplanation, explainSchema } from './explain';
import { geminiAnswerGenerator, persistAnswer } from './answers';
import { geminiSecrets } from './platform/genai';

function actor(context: MemberAccess): Actor {
  return { uid: context.uid, memberId: context.memberId,
    role: context.isOwner ? 'member' : context.isGuardian ? 'guardian' : context.isNurse ? 'nurse' : 'supporter' };
}

const statusRequestSchema = doseKeySchema.partial({ date: true, slot: true }).extend({ question: z.string().trim().min(1).max(2000).optional() });

async function handle(request: CallableRequest, action: 'log' | 'status' | 'explain') {
  const uid = requireAuth(request);
  try {
    const key = action === 'status' ? statusRequestSchema.parse(request.data) : doseKeySchema.parse(request.data);
    const context = await resolveMemberAccess(uid, key.familyId, key.memberId);
    const viewer = actor(context);
    if (action === 'explain') return await readExplanation(db, explainSchema.parse(request.data), viewer);
    if (action === 'status') {
      if (!key.date || !key.slot) return {
        needsClarification: true, clarifyQuestion: 'Which date and dose slot do you mean?',
        sentences: [], fallbackUsed: true,
        textEn: 'Which date and dose slot do you mean? Please wait before taking another dose.',
        textMl: 'ഏത് ദിവസത്തെ, ഏത് നേരത്തെ മരുന്നാണ് ചോദിക്കുന്നത്? വീണ്ടും കഴിക്കുന്നതിന് മുമ്പ് കാത്തിരിക്കൂ.',
      };
      const input = askStatusSchema.parse(request.data);
      const answer = await readStatus(db, input, viewer, geminiAnswerGenerator);
      // Authorization failures here must not be swallowed by the optional wording fallback.
      const answerId = await persistAnswer(context, answer, input.question);
      return { ...answer, answerId };
    }
    return await recordDose(db, logDoseSchema.parse(request.data), viewer);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof ZodError) throw new HttpsError('invalid-argument', 'Check the member, date, slot and dose fields.');
    // Do not disclose document paths, private records or provider details in callable errors.
    throw new HttpsError('failed-precondition', 'This request could not be completed safely. Check the schedule or ask your supporter.');
  }
}

const options = { region: 'asia-south1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', secrets: geminiSecrets };
export const logDose = onCall(options, request => handle(request, 'log'));
export const askStatus = onCall(options, request => handle(request, 'status'));
export const answer = onCall(options, request => handle(request, 'status'));
export const explain = onCall(options, request => handle(request, 'explain'));
