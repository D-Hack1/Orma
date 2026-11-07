import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), send: vi.fn(), sms: vi.fn() }));
vi.mock('firebase-admin/functions', () => ({ getFunctions: () => ({ taskQueue: () => ({ enqueue: mocks.enqueue }) }) }));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEachForMulticast: mocks.send }) }));
vi.mock('../src/telephony', () => ({ sendSms: mocks.sms }));
import { acknowledgeAlert, alertCreated, alertProjection, createAlert, eligibleRecipient, processEscalation, routeNotification, selectRecipients } from '../src/alerts';
import { onShift } from '../src/scheduler/core';
import { base, memoryDb } from './schedulerFake';

const now = new Date('2026-11-07T04:00:00Z');
const alert = { familyId: 'home', memberId: 'amma', type: 'unknown', rule: 'three_unanswered_reminders', date: '2026-11-07', slot: 'morning', escalationStep: 0, at: Timestamp.fromDate(now) };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.enqueue.mockReset().mockResolvedValue(undefined);
  mocks.send.mockReset().mockResolvedValue({ successCount: 1 });
  mocks.sms.mockReset().mockResolvedValue(false);
});

it('selects on-duty supporter, assigned on-shift nurse, then all active supporters', () => {
  const access = Object.entries(base).filter(([path]) => path.includes('/access/')).map(([path, data]) => ({ id: path.split('/').at(-1)!, data }));
  const family = base['families/home'], member = base['families/home/members/amma'];
  expect(selectRecipients(access, family, member, 'amma', 1, false, now)).toEqual(['anu']);
  expect(selectRecipients(access, family, member, 'amma', 2, false, now)).toEqual(['mini']);
  expect(selectRecipients(access, family, { nurseIds: [] }, 'amma', 2, false, now)).toEqual([]);
  expect(selectRecipients(access, family, member, 'amma', 3, false, now)).toEqual(['anu']);
  expect(selectRecipients(access, family, member, 'amma', 1, true, now)).toEqual(['anu', 'mini']);
  expect(selectRecipients(access, family, member, 'amma', 2, false, new Date('2026-11-07T15:00:00Z'))).toEqual([]);
  expect(eligibleRecipient('anu', { active: false, roles: ['supporter'], memberIds: ['amma'] }, 'amma', member)).toBe(false);
});

it('handles an overnight roster in the family timezone and rejects malformed shifts', () => {
  const shift = { days: [5], from: '22:00', to: '06:00' };
  expect(onShift(shift, new Date('2026-11-06T23:00:00Z'), 'Asia/Kolkata')).toBe(true);
  expect(onShift(shift, now, 'Asia/Kolkata')).toBe(false);
  expect(onShift({ ...shift, from: 'nonsense' }, now, 'Asia/Kolkata')).toBe(false);
});

it('creates idempotent alert/task keys and projects no counts/evidence/transcript', async () => {
  const { db, records } = memoryDb(base);
  const first = await createAlert(db, { familyId: 'home', memberId: 'amma', type: 'double', rule: 'duplicate_blocked', date: '2026-11-07', slot: 'morning' });
  const second = await createAlert(db, { familyId: 'home', memberId: 'amma', type: 'double', rule: 'duplicate_blocked', date: '2026-11-07', slot: 'morning' });
  expect(first).toEqual(second);
  expect([...records.keys()].filter(key => key.startsWith('alerts/'))).toHaveLength(1);
  expect(mocks.enqueue.mock.calls[0][1].id).toEqual(mocks.enqueue.mock.calls[1][1].id);
  expect(alertProjection({ ...alert, countTaken: 9, evidence: ['secret'], transcript: 'private' })).toEqual({ type: 'unknown', rule: 'three_unanswered_reminders', date: '2026-11-07', slot: 'morning', at: alert.at });
});

it('actual creation trigger routes legacy direct alerts without recursively writing another alert', async () => {
  const event = { data: { data: () => ({ ...alert, type: 'double', rule: 'Private count 9 and transcript must not leak' }) }, params: { alertId: 'legacy-double' } };
  await alertCreated.run(event as any);
  mocks.enqueue.mockRejectedValueOnce({ code: 'functions/task-already-exists' });
  await alertCreated.run(event as any);
  expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  expect(mocks.enqueue.mock.calls[0][0]).toEqual({ familyId: 'home', memberId: 'amma', alertId: 'legacy-double', step: 1 });
  expect(mocks.enqueue.mock.calls[0][1].id).toEqual(mocks.enqueue.mock.calls[1][1].id);
  expect(alertProjection(event.data.data()).rule).toBe('duplicate_blocked');
  expect(alertProjection({ ...alert, type: 'stock', rule: 'stock_7_days' }).rule).toBe('stock_7_days');
  expect(alertProjection({ ...alert, type: 'partial', rule: 'secret_count_9' }).rule).toBe('partial_dose');
});

it('actual creation trigger shares createAlert queue IDs, ignores invalid selectors/types and retries queue failures', async () => {
  const { db } = memoryDb(base);
  const created = await createAlert(db, { familyId: 'home', memberId: 'amma', type: 'unknown', rule: 'three_unanswered_reminders' });
  const event = { data: { data: () => alert }, params: { alertId: created.alertId } };
  await alertCreated.run(event as any);
  expect(mocks.enqueue.mock.calls[0][1].id).toEqual(mocks.enqueue.mock.calls[1][1].id);
  for (const patch of [{ familyId: '../other' }, { memberId: '' }, { type: 'made_up' }, { ackBy: 'anu' }]) {
    await alertCreated.run({ ...event, data: { data: () => ({ ...alert, ...patch }) } } as any);
  }
  expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  mocks.enqueue.mockRejectedValueOnce({ code: 'permission-denied' });
  await expect(alertCreated.run(event as any)).rejects.toEqual({ code: 'permission-denied' });
});

it('uses generic push only with active trusted device/access bindings and deduplicates replay', async () => {
  const { db, records } = memoryDb({ ...base, 'alerts/event': alert, 'devices/forged': { familyId: 'other', active: true, uid: 'anu', memberIds: ['amma'], fcmToken: 'forged' } });
  const input = { familyId: 'home', memberId: 'amma', eventId: 'event', kind: 'alert' as const, recipientIds: ['anu'] };
  expect(await routeNotification(db, input)).toEqual(['anu']);
  await routeNotification(db, input);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0][0]).toEqual({ tokens: ['supporter-token'], notification: { title: 'Orma', body: 'Open Orma to check an update.' }, data: { eventId: 'event', kind: 'alert' } });
  records.set('families/home/access/anu', { ...base['families/home/access/anu'], active: false });
  expect(await routeNotification(db, { ...input, eventId: 'new-event' })).toEqual([]);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it('revoked nurse assignments and unshared stock/risk do not deliver or project', async () => {
  const { db, records } = memoryDb({ ...base, 'alerts/event': { ...alert, type: 'stock', rule: 'stock_7_days' } });
  expect(await routeNotification(db, { familyId: 'home', memberId: 'amma', eventId: 'event', kind: 'alert', recipientIds: ['anu'] })).toEqual([]);
  expect(records.has('families/home/views/anu/members/amma/alerts/event')).toBe(false);
  records.set('alerts/event', { ...alert, type: 'risk' });
  expect(await routeNotification(db, { familyId: 'home', memberId: 'amma', eventId: 'event', kind: 'alert', recipientIds: ['mini'] })).toEqual([]);
  records.set('alerts/event', alert);
  records.set('families/home/members/amma', { ...base['families/home/members/amma'], nurseIds: [] });
  expect(await routeNotification(db, { familyId: 'home', memberId: 'amma', eventId: 'event', kind: 'alert', recipientIds: ['mini'] })).toEqual([]);
  expect(mocks.send).not.toHaveBeenCalled();
});

it('rechecks acknowledgement and dose when queued alerts finally run', async () => {
  const { db, records } = memoryDb({ ...base, 'alerts/event': alert });
  const input = { familyId: 'home', memberId: 'amma', alertId: 'event', step: 1 };
  await acknowledgeAlert(db, 'anu', inputWithoutStep(input));
  expect(await processEscalation(db, input)).toEqual({ sentTo: [] });
  expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  records.set('alerts/event', alert);
  records.set('families/home/members/amma/doses/2026-11-07_morning', { status: 'partial' });
  expect((await processEscalation(db, input)).sentTo).toEqual([]);
  expect(mocks.send).not.toHaveBeenCalled();
});

function inputWithoutStep(input: { familyId: string; memberId: string; alertId: string }) { return { familyId: input.familyId, memberId: input.memberId, alertId: input.alertId }; }

it('requires active same-family authority to acknowledge and keeps the first audit actor', async () => {
  const { db, records } = memoryDb({ ...base, 'alerts/event': alert });
  const input = { familyId: 'home', memberId: 'amma', alertId: 'event' };
  await expect(acknowledgeAlert(db, 'intruder', input)).rejects.toThrow('not allowed');
  await expect(acknowledgeAlert(db, 'anu', { ...input, familyId: 'other' })).rejects.toThrow('not allowed');
  await acknowledgeAlert(db, 'anu', input); await acknowledgeAlert(db, 'mini', input);
  expect(records.get('alerts/event').ackBy).toBe('anu');
});

it('queues escalation exactly five minutes ahead and stops queued nurse delivery after ack', async () => {
  const { db } = memoryDb({ ...base, 'alerts/event': alert });
  const input = { familyId: 'home', memberId: 'amma', alertId: 'event', step: 1 };
  const result = await processEscalation(db, input);
  expect(result.sentTo).toEqual(['anu']);
  expect(result.nextStepAt).toBe('2026-11-07T04:05:00.000Z');
  expect(mocks.enqueue.mock.calls[0][1].scheduleDelaySeconds).toBe(300);
  await acknowledgeAlert(db, 'anu', inputWithoutStep(input));
  await processEscalation(db, { ...input, step: 2 });
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it('does not mark provider failures delivered and retries successfully after configuration is fixed', async () => {
  const { db, records } = memoryDb({ ...base, 'alerts/event': alert });
  mocks.send.mockResolvedValueOnce({ successCount: 0 });
  const input = { familyId: 'home', memberId: 'amma', eventId: 'event', kind: 'alert' as const, recipientIds: ['anu'] };
  await expect(routeNotification(db, input)).rejects.toThrow('unavailable');
  expect([...records.values()].find(value => value.state)?.state).toBe('pending');
  expect(await routeNotification(db, input)).toEqual(['anu']);
  expect(mocks.send).toHaveBeenCalledTimes(2);
});

it('requires opted-in verified UID-bound SMS and never claims no-credentials delivery', async () => {
  const phone = '+919000000001';
  const hash = createHash('sha256').update(phone).digest('hex');
  const { db, records } = memoryDb({ ...base, 'alerts/event': alert, 'devices/anu': { ...base['devices/anu'], active: false }, 'families/home/access/anu': { ...base['families/home/access/anu'], smsConsent: true, phone }, [`phoneBindings/${hash}`]: { verified: true, sms: true, uid: 'someone-else', familyId: 'home' } });
  const input = { familyId: 'home', memberId: 'amma', eventId: 'event', kind: 'alert' as const, recipientIds: ['anu'] };
  await expect(routeNotification(db, input)).rejects.toThrow('unavailable');
  expect(mocks.sms).not.toHaveBeenCalled();
  records.set(`phoneBindings/${hash}`, { verified: true, sms: true, uid: 'anu', familyId: 'home' });
  await expect(routeNotification(db, input)).rejects.toThrow('unavailable');
  mocks.sms.mockResolvedValueOnce(true);
  expect(await routeNotification(db, input)).toEqual(['anu']);
  expect(mocks.sms.mock.calls[0][0]).toEqual({ to: phone, body: 'Open Orma to check an update.' });
});

it('queues next escalation tier even when the current provider is unavailable', async () => {
  const { db } = memoryDb({ ...base, 'alerts/event': alert });
  mocks.send.mockResolvedValueOnce({ successCount: 0 });
  await expect(processEscalation(db, { familyId: 'home', memberId: 'amma', alertId: 'event', step: 1 })).rejects.toThrow('unavailable');
  expect(mocks.enqueue.mock.calls[0][0].step).toBe(2);
});
