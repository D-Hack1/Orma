import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { eventKey, millis } from './core';

export async function enqueueTask(name: 'retryCall' | 'escalate', data: object, key: string, delaySeconds = 0) {
  try {
    await getFunctions().taskQueue(`locations/asia-south1/functions/${name}`).enqueue(data, { id: key, scheduleDelaySeconds: delaySeconds });
  } catch (error) {
    if (!['functions/task-already-exists', 'already-exists', 6].includes((error as { code: string | number }).code)) throw error;
  }
}

// A lease recovers crashed workers; completion is recorded only after an accepted send.
// shortcut: a crash after provider acceptance can resend a generic push/SMS; use provider receipts if exactly-once delivery becomes required.
export async function runClaimed(db: Firestore, key: string, work: () => Promise<boolean>, now = new Date()): Promise<boolean> {
  const ref = db.doc(`jobs/${eventKey(key)}`), owner = randomUUID();
  const claim = await db.runTransaction(async tx => {
    const job = (await tx.get(ref)).data();
    if (job?.state === 'done') return 'done';
    if (millis(job?.leaseUntil) > now.getTime()) return 'busy';
    tx.set(ref, { state: 'claimed', owner, leaseUntil: Timestamp.fromMillis(now.getTime() + 120_000) });
    return 'claimed';
  });
  if (claim === 'done') return true;
  if (claim === 'busy') throw new Error('Job is already being processed; retry later.');
  let done = false;
  try { done = await work(); return done; }
  finally {
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.owner === owner) tx.set(ref, { state: done ? 'done' : 'pending', owner, leaseUntil: Timestamp.fromMillis(0) });
    });
  }
}
