import { randomUUID, createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';
import { db } from '../platform/firebase';
import { documentId, requireAuth, resolveMemberAccess, type MemberAccess } from '../platform/auth';
import { geminiAnswerGenerator, persistDerived, reauthorize, sharingVersion } from '../answers';
import { routeNotification } from '../alerts';
import { synthesizePrivateAudio } from '../audio';
import { composeSummary, localDateSchema, memberLocalClock } from './core';
import { readSummaryRecords, summaryFacts } from './records';

export const digestInputSchema = z.object({ familyId: z.string(), memberId: z.string(), date: localDateSchema, language: z.enum(['en', 'ml']).default('en') }).strict();

export function exportPath(context: MemberAccess, name: string) {
  documentId(context.uid, 'viewerUid');
  return `families/${context.familyId}/members/${context.memberId}/exports/${context.uid}/${name}`;
}

export async function createDailyDigest(context: MemberAccess, date: string, language: 'en' | 'ml') {
  localDateSchema.parse(date);
  const records = await readSummaryRecords(context, date, date);
  await reauthorize(context);
  const result = await composeSummary(summaryFacts(records, date, date), language, geminiAnswerGenerator);
  const digestId = `${date}_${context.uid}_${language}`;
  let audioUrl: string | undefined;
  let audioPath: string | undefined;
  try {
    await reauthorize(context);
    const path = exportPath(context, `digest-${randomUUID()}.mp3`);
    audioPath = path;
    await synthesizePrivateAudio(language === 'ml' ? result.textMl : result.textEn, { language, path });
    await reauthorize(context);
    const file = getStorage().bucket().file(path);
    await file.setMetadata({ metadata: { familyId: context.familyId, memberId: context.memberId, viewerUid: context.uid, sharingVersion: String(sharingVersion(context)), kind: 'audio' } });
    audioUrl = `gs://${file.bucket.name}/${path}`;
  } catch {
    if (audioPath) await getStorage().bucket().file(audioPath).delete({ ignoreNotFound: true }).catch(() => undefined);
    await reauthorize(context); // Access/version failures are never optional-audio failures.
  }
  const document = { ...result, date, language, sentTo: [] as string[], ...(audioUrl ? { audioUrl } : {}) };
  await persistDerived(context, 'digests', digestId, document);
  await reauthorize(context);
  const sentTo = await routeNotification(db, { familyId: context.familyId, memberId: context.memberId, recipientIds: [context.uid], kind: 'report', eventId: createHash('sha256').update(`digest_${digestId}_v${sharingVersion(context)}`).digest('hex') });
  if (sentTo.length) await persistDerived(context, 'digests', digestId, { ...document, sentTo });
  await reauthorize(context);
  return { digestId, ...result, ...(audioUrl ? { audioUrl } : {}) };
}

export const dailyDigest = onCall({ enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' }, async request => {
  const uid = requireAuth(request);
  try {
    const input = digestInputSchema.parse(request.data);
    const context = await resolveMemberAccess(uid, input.familyId, input.memberId);
    return await createDailyDigest(context, input.date, input.language);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(error instanceof z.ZodError ? 'invalid-argument' : 'failed-precondition', 'The summary could not be created safely.');
  }
});

export async function runDailyDigestSweep(now = new Date()) {
  let generated = 0;
  const families = await db.collection('families').get();
  for (const family of families.docs) {
    const [members, access] = await Promise.all([family.ref.collection('members').get(), family.ref.collection('access').where('active', '==', true).get()]);
    for (const member of members.docs) {
      let clock: ReturnType<typeof memberLocalClock>;
      try { clock = memberLocalClock(now, member.data().timezone ?? family.data().timezone ?? 'Asia/Kolkata'); } catch { continue; }
      if (clock.hour !== '20' || clock.minute !== '00') continue;
      for (const viewer of access.docs) {
        if (!(viewer.data().roles ?? []).some((role: string) => ['supporter', 'leadSupporter'].includes(role))) continue;
        try {
          const context = await resolveMemberAccess(viewer.id, family.id, member.id);
          const language = viewer.data().language === 'ml' ? 'ml' : 'en';
          const existing = await context.memberRef.collection('digests').doc(`${clock.date}_${viewer.id}_${language}`).get();
          if (existing.data()?.sharingVersion === sharingVersion(context)) continue;
          await createDailyDigest(context, clock.date, language);
          generated++;
        } catch { /* An inaccessible member or provider failure must not block other viewers. */ }
      }
    }
  }
  return { generated };
}

// UTC minute sweep supports member-local 20:00, including half/quarter-hour zones and DST.
export const dailyDigestScheduled = onSchedule({ schedule: '* * * * *', timeZone: 'UTC' }, async event => { await runDailyDigestSweep(new Date(event.scheduleTime)); });
