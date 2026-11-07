import { createHash } from 'node:crypto';
import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db as database } from '../platform/firebase';
import { documentId, requireAuth } from '../platform/auth';
import { sendSms } from '../telephony';
import { eventKey, isDue, localClock, millis, onShift, recorded, refillThresholds, taskInput } from '../scheduler/core';
import { enqueueTask, runClaimed } from '../scheduler/jobs';

export type AlertInput = {
  familyId: string; memberId: string; type: 'missed' | 'partial' | 'double' | 'unknown' | 'stock' | 'urgent' | 'risk';
  rule: string; date?: string; slot?: string; urgency?: 'normal' | 'urgent';
};
export type NotificationInput = {
  familyId: string; memberId: string; recipientIds?: string[];
  kind?: 'alert' | 'message' | 'report' | 'reminder'; eventId: string; step?: number; urgency?: 'normal' | 'urgent';
  date?: string; slot?: string; generation?: number;
};

const alertTypes = z.enum(['missed', 'partial', 'double', 'unknown', 'stock', 'urgent', 'risk']);
const canonicalAlert = taskInput.pick({ familyId: true, memberId: true }).extend({ type: alertTypes }).passthrough();

export function eligibleRecipient(uid: string, access: DocumentData, memberId: string, member: DocumentData): boolean {
  if (access.active !== true || !access.memberIds?.includes(memberId)) return false;
  return member.ownerUid === uid || access.roles?.some((role: string) => ['supporter', 'leadSupporter'].includes(role)) ||
    (access.roles?.includes('nurse') && member.nurseIds?.includes(uid));
}

export function selectRecipients(access: { id: string; data: DocumentData }[], family: DocumentData, member: DocumentData, memberId: string, step = 1, urgent = false, now = new Date()): string[] {
  const eligible = access.filter(entry => eligibleRecipient(entry.id, entry.data, memberId, member));
  const roster = (family.roster ?? []).filter((entry: DocumentData) => onShift(entry, now, family.timezone));
  const supporter = (entry: typeof eligible[number]) => entry.data.roles?.some((role: string) => ['supporter', 'leadSupporter'].includes(role));
  const nurse = (entry: typeof eligible[number]) => entry.data.roles?.includes('nurse') && member.nurseIds?.includes(entry.id);
  if (urgent) return eligible.filter(entry => roster.some((shift: DocumentData) => shift.memberId === entry.id) && (supporter(entry) || nurse(entry))).map(entry => entry.id);
  if (step === 1) return eligible.filter(entry => supporter(entry) && roster.some((shift: DocumentData) => shift.memberId === entry.id && shift.role !== 'nurse')).slice(0, 1).map(entry => entry.id);
  if (step === 2) return eligible.filter(entry => nurse(entry) && roster.some((shift: DocumentData) => shift.memberId === entry.id && shift.role === 'nurse')).map(entry => entry.id);
  return eligible.filter(supporter).map(entry => entry.id);
}

const shared = (sharing: DocumentData, uid: string, field: string) => (sharing.perSupporter?.[uid]?.[field] ?? sharing[field]) === true;
export function alertVisible(alert: DocumentData, sharing: DocumentData, uid: string, member: DocumentData): boolean {
  return member.ownerUid === uid || (alert.type !== 'stock' || shared(sharing, uid, 'counts')) && (alert.type !== 'risk' || shared(sharing, uid, 'risk'));
}
export function alertProjection(alert: DocumentData) {
  const type = alertTypes.safeParse(alert.type).data ?? 'unknown';
  const genericRule = { missed: 'overdue_dose', partial: 'partial_dose', double: 'duplicate_blocked', unknown: 'unknown_dose', stock: 'stock_low', urgent: 'urgent_message', risk: 'risk_alert' }[type];
  const rule = type === 'stock' && /^stock_(7|4|2)_days$/.test(alert.rule) ? alert.rule :
    type === 'unknown' && alert.rule === 'three_unanswered_reminders' ? alert.rule : genericRule;
  return { type, rule, ...(z.iso.date().safeParse(alert.date).success ? { date: alert.date } : {}),
    ...(['morning', 'noon', 'night'].includes(alert.slot) ? { slot: alert.slot } : {}), at: alert.at instanceof Timestamp ? alert.at : Timestamp.now() };
}

async function currentNotification(db: Firestore, input: NotificationInput, uid: string) {
  const root = `families/${input.familyId}`;
  const [accessDoc, memberDoc, sharingDoc, alertDoc] = await db.getAll(db.doc(`${root}/access/${uid}`), db.doc(`${root}/members/${input.memberId}`), db.doc(`${root}/members/${input.memberId}/settings/sharing`), db.doc(`alerts/${input.eventId}`));
  const access = accessDoc.data() ?? {}, member = memberDoc.data() ?? {}, sharing = sharingDoc.data() ?? {};
  if (!memberDoc.exists || !eligibleRecipient(uid, access, input.memberId, member)) return;
  if (input.kind === 'reminder') {
    if (!input.date || !input.slot) return;
    const [dose, snooze, schedule, family] = await db.getAll(db.doc(`${root}/members/${input.memberId}/doses/${input.date}_${input.slot}`), db.doc(`${root}/members/${input.memberId}/snoozes/${input.date}_${input.slot}`), db.doc(`${root}/members/${input.memberId}/schedule/${input.slot}`), db.doc(root));
    if (!schedule.exists || input.date !== localClock(new Date(), member.timezone ?? family.data()?.timezone).date || !isDue(new Date(), family.data() ?? {}, member, schedule.data()!, dose.data(), snooze.data()) || (input.generation ?? 0) !== millis(snooze.data()?.remindAt)) return;
  }
  if (input.kind === 'alert') {
    const alert = alertDoc.data();
    if (!alert || alert.ackBy || alert.familyId !== input.familyId || alert.memberId !== input.memberId || !alertVisible(alert, sharing, uid, member)) return;
    if (alert.date && alert.slot && ['unknown', 'missed'].includes(alert.type)) {
      const [dose, snooze] = await db.getAll(db.doc(`${root}/members/${input.memberId}/doses/${alert.date}_${alert.slot}`), db.doc(`${root}/members/${input.memberId}/snoozes/${alert.date}_${alert.slot}`));
      if (recorded(dose.data()) || millis(snooze.data()?.remindAt) > Date.now()) return;
    }
    if (alert.type === 'stock') {
      const schedules = await db.collection(`${root}/members/${input.memberId}/schedule`).get();
      const threshold = Number(/^stock_(7|4|2)_days$/.exec(alert.rule)?.[1]);
      if (!refillThresholds(schedules.docs.map(doc => doc.data())).includes(threshold)) return;
    }
    return { access, member, alert };
  }
  return { access, member };
}

export async function routeNotification(db: Firestore, input: NotificationInput): Promise<string[]> {
  input = { ...input, kind: input.kind ?? 'alert' };
  documentId(input.familyId, 'familyId'); documentId(input.memberId, 'memberId'); documentId(input.eventId, 'eventId');
  const root = `families/${input.familyId}`;
  const [familyDoc, memberDoc, accessDocs] = await Promise.all([db.doc(root).get(), db.doc(`${root}/members/${input.memberId}`).get(), db.collection(`${root}/access`).get()]);
  if (!familyDoc.exists || !memberDoc.exists) return [];
  const recipients = input.recipientIds ?? selectRecipients(accessDocs.docs.map(doc => ({ id: doc.id, data: doc.data() })), familyDoc.data()!, memberDoc.data()!, input.memberId, input.step, input.urgency === 'urgent');
  const sent: string[] = [];
  const failures: unknown[] = [];
  for (const uid of new Set(recipients)) {
    try {
      documentId(uid, 'recipientId');
      let eligible = await currentNotification(db, input, uid);
      if (!eligible) continue;
      if (input.kind === 'alert' && eligible.alert) {
        await db.runTransaction(async tx => {
          const [access, member, sharing, alert] = await tx.getAll(db.doc(`${root}/access/${uid}`), db.doc(`${root}/members/${input.memberId}`), db.doc(`${root}/members/${input.memberId}/settings/sharing`), db.doc(`alerts/${input.eventId}`));
          const data = alert.data();
          if (data && !data.ackBy && eligibleRecipient(uid, access.data() ?? {}, input.memberId, member.data() ?? {}) && alertVisible(data, sharing.data() ?? {}, uid, member.data() ?? {})) {
            tx.set(db.doc(`${root}/views/${uid}/members/${input.memberId}/alerts/${input.eventId}`), alertProjection(data));
          }
        });
      }
      let stillEligible = true;
      const accepted = await runClaimed(db, `notification:${input.eventId}:${input.step ?? 0}:${uid}`, async () => {
        // Re-read access, consent and alert acknowledgement after claiming, not just when queued.
        eligible = await currentNotification(db, input, uid);
        if (!eligible) { stillEligible = false; return false; }
        const devices = await db.collection('devices').where('familyId', '==', input.familyId).get();
        const tokens = [...new Set(devices.docs.map(doc => doc.data()).filter(device => device.active === true && device.uid === uid && device.memberIds?.includes(input.memberId) && typeof device.fcmToken === 'string' && device.fcmToken.length > 0).map(device => device.fcmToken as string))];
        // Only a generic inbox signal leaves the server; private content is fetched under current rules.
        const body = 'Open Orma to check an update.';
        if (tokens.length) {
          let delivered = false;
          for (let index = 0; index < tokens.length; index += 500) {
            const result = await getMessaging().sendEachForMulticast({ tokens: tokens.slice(index, index + 500), notification: { title: 'Orma', body }, data: { eventId: input.eventId, kind: input.kind ?? 'alert' } });
            delivered ||= result.successCount > 0;
          }
          return delivered;
        }
        const { access } = eligible;
        if (access.smsConsent !== true || typeof access.phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(access.phone)) return false;
        const binding = (await db.doc(`phoneBindings/${createHash('sha256').update(access.phone).digest('hex')}`).get()).data();
        if (!binding || binding.verified !== true || binding.sms !== true || binding.uid !== uid || binding.familyId !== input.familyId) return false;
        return sendSms({ to: access.phone, body });
      });
      if (accepted && stillEligible) sent.push(uid);
      else if (stillEligible) throw new Error('Notification provider unavailable or no verified delivery channel.');
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new Error('Notification provider unavailable or no verified delivery channel.');
  return sent;
}

export async function createAlert(db: Firestore, input: AlertInput): Promise<{ alertId: string }> {
  canonicalAlert.parse(input);
  documentId(input.familyId, 'familyId'); documentId(input.memberId, 'memberId');
  if (!/^[a-z0-9_:-]{1,100}$/.test(input.rule)) throw new Error('Alert rule must be a privacy-safe rule code.');
  const alertId = eventKey(input.familyId, input.memberId, input.type, input.rule, input.date ?? '', input.slot ?? '');
  await db.runTransaction(async tx => {
    const ref = db.doc(`alerts/${alertId}`);
    if (!(await tx.get(ref)).exists) tx.create(ref, { ...input, escalationStep: 0, at: Timestamp.now() });
  });
  await enqueueTask('escalate', { familyId: input.familyId, memberId: input.memberId, alertId, step: 1 }, eventKey('escalate', alertId, 1));
  return { alertId };
}

// Direct writes from dose/telephony transactions use the same deterministic queue key as createAlert.
export const alertCreated = onDocumentCreated({ document: 'alerts/{alertId}', region: 'asia-south1', retry: true }, async event => {
  const alert = event.data?.data();
  const parsed = canonicalAlert.safeParse(alert);
  if (!parsed.success || alert?.ackBy) return;
  const alertId = documentId(event.params.alertId, 'alertId');
  await enqueueTask('escalate', { familyId: parsed.data.familyId, memberId: parsed.data.memberId, alertId, step: 1 }, eventKey('escalate', alertId, 1));
});

const escalationInput = z.object({ familyId: z.string(), memberId: z.string(), alertId: z.string(), step: z.number().int().min(1).max(3) }).strict();
export async function processEscalation(db: Firestore, raw: unknown) {
  const input = escalationInput.parse(raw);
  for (const [name, value] of Object.entries(input)) if (typeof value === 'string') documentId(value, name);
  const alertRef = db.doc(`alerts/${input.alertId}`);
  const alert = (await alertRef.get()).data();
  if (!alert || alert.ackBy || alert.familyId !== input.familyId || alert.memberId !== input.memberId) return { sentTo: [] };
  // Queue the next tier even when this recipient has no working provider; its handler rechecks acknowledgement.
  const urgent = alert.urgency === 'urgent' || alert.type === 'urgent';
  const nextStepAt = !urgent && input.step < 3 ? new Date(Date.now() + 300_000) : undefined;
  if (nextStepAt) await enqueueTask('escalate', { ...input, step: input.step + 1 }, eventKey('escalate', input.alertId, input.step + 1), 300);
  const sentTo = await routeNotification(db, { ...input, eventId: input.alertId, kind: 'alert', urgency: alert.urgency ?? (alert.type === 'urgent' ? 'urgent' : 'normal') });
  const latest = (await alertRef.get()).data();
  if (!latest || latest.ackBy) return { sentTo };
  await db.runTransaction(async tx => {
    const current = (await tx.get(alertRef)).data();
    if (current && !current.ackBy) tx.update(alertRef, { escalationStep: Math.max(current.escalationStep ?? 0, input.step) });
  });
  return { sentTo, ...(nextStepAt ? { nextStepAt: nextStepAt.toISOString() } : {}) };
}

export const escalate = onTaskDispatched({ region: 'asia-south1', invoker: 'private', secrets: ['TWILIO_AUTH_TOKEN'], retryConfig: { maxAttempts: 10, minBackoffSeconds: 30 }, rateLimits: { maxConcurrentDispatches: 10 } }, async request => { await processEscalation(database, request.data); });

export async function acknowledgeAlert(db: Firestore, uid: string, raw: unknown) {
  const input = escalationInput.omit({ step: true }).parse(raw);
  Object.entries(input).forEach(([name, value]) => documentId(value, name));
  await db.runTransaction(async tx => {
    const root = `families/${input.familyId}`;
    const ref = db.doc(`alerts/${input.alertId}`);
    const [alertDoc, accessDoc, memberDoc, sharingDoc] = await tx.getAll(ref, db.doc(`${root}/access/${uid}`), db.doc(`${root}/members/${input.memberId}`), db.doc(`${root}/members/${input.memberId}/settings/sharing`));
    const alert = alertDoc.data();
    if (!alert || alert.familyId !== input.familyId || alert.memberId !== input.memberId || !eligibleRecipient(uid, accessDoc.data() ?? {}, input.memberId, memberDoc.data() ?? {}) || !alertVisible(alert, sharingDoc.data() ?? {}, uid, memberDoc.data() ?? {})) throw new HttpsError('permission-denied', 'Alert access is not allowed.');
    if (!alert.ackBy) tx.update(ref, { ackBy: uid, ackAt: Timestamp.now() });
  });
  return { acknowledged: true };
}
export const ackAlert = onCall({ region: 'asia-south1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' }, async request => {
  const uid = requireAuth(request);
  try { return await acknowledgeAlert(database, uid, request.data); }
  catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof z.ZodError) throw new HttpsError('invalid-argument', 'Invalid alert acknowledgement.');
    throw new HttpsError('unavailable', 'Alert acknowledgement is temporarily unavailable.');
  }
});
