import { defineSecret } from 'firebase-functions/params';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { requireAuth } from '../platform/auth';
import { db } from '../platform/firebase';
import { aggregateRound, submitUpdate } from './core';

const pseudonymKey = defineSecret('FL_PSEUDONYM_KEY');

export const flSubmit = onCall({ region: 'asia-south1', secrets: [pseudonymKey],
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', maxInstances: 10, concurrency: 20,
}, request => submitUpdate(db, requireAuth(request), request.data, pseudonymKey.value()));

export const flAggregate = onSchedule({ region: 'asia-south1', schedule: 'every 5 minutes', retryCount: 3 }, async () => {
  const latest = (await db.doc('flModels/latest').get()).data();
  if (latest) await aggregateRound(db, latest.round + 1);
});

export { aggregateRound, submitSimulatedUpdate } from './core';
