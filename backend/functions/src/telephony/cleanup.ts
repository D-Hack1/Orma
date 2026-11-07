import type { Firestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../platform/firebase';
import { configuration, TwilioProvider } from './provider';

/** Retry privacy cleanup even if transcription failed before a recording could be bound. */
export async function cleanupRecordings(database: Firestore, provider: Pick<TwilioProvider, 'deleteBoundRecording'>) {
  const pending = await database.collectionGroup('recordings').where('cleanupPending', '==', true).limit(25).get();
  let deleted = 0;
  for (const recording of pending.docs) {
    const parts = recording.ref.path.split('/');
    if (parts.length !== 4 || parts[0] !== 'calls' || parts[2] !== 'recordings' || !/^RE[0-9a-f]{32}$/i.test(recording.id)) continue;
    const call = (await database.doc(`calls/${parts[1]}`).get()).data();
    const sid = recording.data().providerSid;
    if (!call || call.providerSid !== sid || typeof sid !== 'string') continue;
    try {
      await provider.deleteBoundRecording(sid, recording.id, AbortSignal.timeout(5000));
      await recording.ref.update({ cleanupPending: false, bindingUnverified: false });
      deleted++;
    } catch { /* Keep the bound item pending; the next scheduled run retries it. */ }
  }
  return { deleted };
}

export const recordingCleanup = onSchedule({ region: 'asia-south1', schedule: 'every 60 minutes', secrets: ['TWILIO_AUTH_TOKEN'], maxInstances: 1 }, async () => {
  const config = configuration();
  if (config) await cleanupRecordings(db, new TwilioProvider(config));
});
