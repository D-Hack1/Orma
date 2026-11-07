import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../platform/firebase';
import { requireAuth, resolveMemberAccess, type MemberAccess } from '../platform/auth';
import { MAX_DOWNLOAD_BYTES } from '../platform/media';
import { geminiAnswerGenerator, persistDerived, reauthorize, sharingVersion } from '../answers';
import { routeNotification } from '../alerts';
import { exportPath } from '../summaries';
import { composeSummary, rangeSchema } from '../summaries/core';
import { readSummaryRecords, summaryFacts, canReadMedicines } from '../summaries/records';
import { adherenceFacts, englishPdfFacts, renderReportPdf } from './core';

export const doctorReportInputSchema = rangeSchema.and(z.object({ familyId: z.string(), memberId: z.string(), language: z.enum(['en', 'ml']).default('en') }));

export async function createDoctorReport(context: MemberAccess, from: string, to: string, language: 'en' | 'ml') {
  rangeSchema.parse({ from, to });
  if (language !== 'en') throw new HttpsError('failed-precondition', 'Malayalam PDF rendering is not supported safely. Please request an English report.');
  if (!(context.isOwner || context.isSupporter || context.isGuardian)) throw new HttpsError('permission-denied', 'Only the member or an authorized supporter may export a report.');
  const records = await readSummaryRecords(context, from, to);
  const facts = summaryFacts(records, from, to);
  if (canReadMedicines(context)) facts.push(...adherenceFacts(records, from, to));
  await reauthorize(context);
  const result = await composeSummary(englishPdfFacts(facts), language, geminiAnswerGenerator);
  const sections = [{ title: 'Dose records and schedule-based recording rates', sentences: result.sentences }];
  const pdf = await renderReportPdf(sections, result.sources, { from, to });
  if (pdf.length > MAX_DOWNLOAD_BYTES) throw new HttpsError('resource-exhausted', 'The report is too large. Request a shorter date range.');
  await reauthorize(context);
  const reportId = randomUUID();
  const path = exportPath(context, `report-${reportId}.pdf`);
  const file = getStorage().bucket().file(path);
  await file.save(pdf, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, contentType: 'application/pdf', metadata: { cacheControl: 'private, no-store', metadata: {
    familyId: context.familyId, memberId: context.memberId, viewerUid: context.uid,
    sharingVersion: String(sharingVersion(context)), kind: 'pdf',
  } } });
  const pdfUrl = `gs://${file.bucket.name}/${path}`;
  await persistDerived(context, 'reports', reportId, { range: { from, to }, sections, sources: result.sources, pdfUrl, language, fallbackUsed: result.fallbackUsed });
  await reauthorize(context);
  await routeNotification(db, { familyId: context.familyId, memberId: context.memberId, recipientIds: [context.uid], kind: 'report', eventId: reportId });
  await reauthorize(context);
  return { reportId, pdfUrl, sections, sources: result.sources, textMl: 'ഡോക്ടറെ കാണാനുള്ള സംഗ്രഹം തയ്യാറായി.', textEn: 'Your doctor-visit summary is ready.' };
}

export const doctorReport = onCall({ enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' }, async request => {
  const uid = requireAuth(request);
  try {
    const input = doctorReportInputSchema.parse(request.data);
    const context = await resolveMemberAccess(uid, input.familyId, input.memberId);
    return await createDoctorReport(context, input.from, input.to, input.language);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(error instanceof z.ZodError ? 'invalid-argument' : 'failed-precondition', 'The report could not be created safely.');
  }
});
