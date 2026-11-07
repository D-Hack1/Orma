import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { db as database } from '../platform/firebase';
import { createAlert, eligibleRecipient, routeNotification } from '../alerts';
import { placeReminderCall } from '../telephony';
import { eventKey, isDue, localClock, millis, refillThresholds, taskInput, type ReminderInput } from './core';
import { enqueueTask } from './jobs';

export async function processReminder(db: Firestore, raw: unknown, now = new Date()): Promise<{ action: 'call_queued' | 'skipped' | 'escalated' | 'notification_queued' }> {
  const input = taskInput.parse(raw);
  const root = `families/${input.familyId}/members/${input.memberId}`;
  const [familyDoc, memberDoc, scheduleDoc, doseDoc, snoozeDoc] = await db.getAll(db.doc(`families/${input.familyId}`), db.doc(root), db.doc(`${root}/schedule/${input.slot}`), db.doc(`${root}/doses/${input.date}_${input.slot}`), db.doc(`${root}/snoozes/${input.date}_${input.slot}`));
  if (!familyDoc.exists || !memberDoc.exists || !scheduleDoc.exists) return { action: 'skipped' };
  const family = familyDoc.data()!, member = memberDoc.data()!, schedule = scheduleDoc.data()!;
  const generation = millis(snoozeDoc.data()?.remindAt);
  if (input.generation !== undefined && input.generation !== generation) return { action: 'skipped' };
  if (input.date !== localClock(now, member.timezone ?? family.timezone).date || !isDue(now, family, member, schedule, doseDoc.data(), snoozeDoc.data())) return { action: 'skipped' };
  if (input.attempt === 4) {
    const changed = await db.runTransaction(async tx => {
      const doseRef = db.doc(`${root}/doses/${input.date}_${input.slot}`);
      const [dose, currentMember, snooze, currentFamily, currentSchedule] = await tx.getAll(doseRef, db.doc(root), db.doc(`${root}/snoozes/${input.date}_${input.slot}`), familyDoc.ref, scheduleDoc.ref);
      const access = await tx.get(db.collection(`families/${input.familyId}/access`));
      if (!currentFamily.exists || !currentMember.exists || !currentSchedule.exists ||
        input.date !== localClock(now, currentMember.data()?.timezone ?? currentFamily.data()?.timezone).date ||
        !isDue(now, currentFamily.data() ?? {}, currentMember.data()!, currentSchedule.data()!, dose.data(), snooze.data()) ||
        (input.generation !== undefined && input.generation !== millis(snooze.data()?.remindAt))) return false;
      const viewers = access.docs.filter(doc => eligibleRecipient(doc.id, doc.data(), input.memberId, currentMember.data()!));
      if (viewers.length > 150) throw new Error('Too many viewers for an atomic status update.');
      tx.set(doseRef, { date: input.date, slot: input.slot, status: 'unknown', attempts: 3, at: Timestamp.fromDate(now) }, { merge: true });
      for (const viewer of viewers) {
        const viewRoot = `families/${input.familyId}/views/${viewer.id}/members/${input.memberId}`;
        tx.set(db.doc(viewRoot), { name: currentMember.data()?.name ?? '', mode: currentMember.data()?.mode ?? 'assisted' });
        tx.set(db.doc(`${viewRoot}/doses/${input.date}_${input.slot}`), { date: input.date, slot: input.slot, status: 'unknown' });
      }
      return true;
    });
    if (!changed) return { action: 'skipped' };
    await createAlert(db, { familyId: input.familyId, memberId: input.memberId, date: input.date, slot: input.slot, type: 'unknown', rule: 'three_unanswered_reminders' });
    return { action: 'escalated' };
  }
  if (member.mode === 'keypad' || member.tier === 'T4') {
    // The telephony worker rechecks current consent, phone verification, quiet hours and dose in its own claim.
    return placeReminderCall(input);
  }
  const eventId = eventKey('reminder', input.familyId, input.memberId, input.date, input.slot, input.attempt, generation);
  const recipients = typeof member.ownerUid === 'string' ? [member.ownerUid] : [];
  if (!recipients.length) throw new Error('No authorized reminder recipient is configured.');
  // A dose can be logged while this task waits: notification routing checks it once more at send time.
  const sent = await routeNotification(db, { familyId: input.familyId, memberId: input.memberId, recipientIds: recipients, eventId, kind: 'reminder', date: input.date, slot: input.slot, generation });
  if (!sent.length) return { action: 'skipped' };
  await enqueueTask('retryCall', { ...input, generation, attempt: input.attempt + 1 }, eventKey('reminder', input.familyId, input.memberId, input.date, input.slot, input.attempt + 1, generation), 900);
  return { action: 'notification_queued' };
}

export async function sweepDoses(db: Firestore, now = new Date()) {
  let checked = 0, notificationsQueued = 0, callsQueued = 0;
  const failures: unknown[] = [];
  const families = await db.collection('families').get();
  for (const familyDoc of families.docs) {
    const family = familyDoc.data();
    const members = await db.collection(`${familyDoc.ref.path}/members`).get();
    for (const memberDoc of members.docs) {
      try {
        const member = memberDoc.data();
        const date = localClock(now, member.timezone ?? family.timezone).date;
        const schedules = await memberDoc.ref.collection('schedule').get();
        for (const threshold of refillThresholds(schedules.docs.map(doc => doc.data()))) {
          await createAlert(db, { familyId: familyDoc.id, memberId: memberDoc.id, type: 'stock', rule: `stock_${threshold}_days`, date });
        }
        for (const scheduleDoc of schedules.docs) {
          if (!['morning', 'noon', 'night'].includes(scheduleDoc.id)) continue;
          checked++;
          const [dose, snooze] = await db.getAll(memberDoc.ref.collection('doses').doc(`${date}_${scheduleDoc.id}`), memberDoc.ref.collection('snoozes').doc(`${date}_${scheduleDoc.id}`));
          if (!isDue(now, family, member, scheduleDoc.data(), dose.data(), snooze.data())) continue;
          const generation = millis(snooze.data()?.remindAt);
          const input: ReminderInput = { familyId: familyDoc.id, memberId: memberDoc.id, date, slot: scheduleDoc.id as ReminderInput['slot'], attempt: 1, generation };
          // Snooze creates a new reminder opportunity without reusing a consumed Cloud Tasks name.
          await enqueueTask('retryCall', input, eventKey('reminder', input.familyId, input.memberId, date, input.slot, 1, generation));
          if (member.mode === 'keypad' || member.tier === 'T4') callsQueued++;
          else notificationsQueued++;
        }
      } catch (error) { failures.push(error); }
    }
  }
  if (failures.length) throw new Error('Some reminder jobs could not be queued; the next sweep will retry.');
  return { checked, notificationsQueued, callsQueued };
}

export const doseSweep = onSchedule({ region: 'asia-south1', schedule: 'every 1 minutes', timeZone: 'UTC', retryCount: 3 }, async () => { await sweepDoses(database); });
export const retryCall = onTaskDispatched({ region: 'asia-south1', invoker: 'private', secrets: ['TWILIO_AUTH_TOKEN'], retryConfig: { maxAttempts: 10, minBackoffSeconds: 30 }, rateLimits: { maxConcurrentDispatches: 10 } }, async request => { await processReminder(database, request.data); });
