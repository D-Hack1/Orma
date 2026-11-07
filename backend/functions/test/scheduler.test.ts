import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), send: vi.fn(), call: vi.fn(), sms: vi.fn() }));
vi.mock('firebase-admin/functions', () => ({ getFunctions: () => ({ taskQueue: () => ({ enqueue: mocks.enqueue }) }) }));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEachForMulticast: mocks.send }) }));
vi.mock('../src/telephony', () => ({ placeReminderCall: mocks.call, sendSms: mocks.sms }));
import { processReminder, sweepDoses } from '../src/scheduler';
import { eventKey, isDue, localClock, refillThresholds } from '../src/scheduler/core';
import { enqueueTask, runClaimed } from '../src/scheduler/jobs';
import { base, memoryDb } from './schedulerFake';

const input = { familyId: 'home', memberId: 'amma', date: '2026-11-07', slot: 'morning', attempt: 1 };
const now = new Date('2026-11-07T04:00:00Z');
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.enqueue.mockReset().mockResolvedValue(undefined);
  mocks.send.mockReset().mockResolvedValue({ successCount: 1 });
  mocks.call.mockReset().mockResolvedValue({ action: 'call_queued' });
});

describe('member-local due times and refill stock', () => {
  it('uses member timezone over family timezone and respects midnight', () => {
    expect(localClock(new Date('2026-11-07T01:00:00Z'), 'America/Los_Angeles').date).toBe('2026-11-06');
    expect(isDue(now, { timezone: 'Asia/Kolkata' }, { timezone: 'UTC' }, { time: '08:00', medicines: [{}] })).toBe(false);
    expect(isDue(now, { timezone: 'Asia/Kolkata' }, {}, { time: '08:00', medicines: [{}] })).toBe(true);
  });
  it('blocks recorded partial doses and active snoozes without inferring missed', () => {
    const schedule = { time: '08:00', medicines: [{}] };
    expect(isDue(now, {}, {}, schedule, { status: 'partial' })).toBe(false);
    expect(isDue(now, {}, {}, schedule, undefined, { remindAt: Timestamp.fromMillis(now.getTime() + 1) })).toBe(false);
    expect(isDue(now, {}, {}, { ...schedule, time: '25:00' })).toBe(false);
  });
  it('sums the daily use of shared medicine IDs instead of double-counting stock', () => {
    expect(refillThresholds([{ medicines: [{ id: 'bp', count: 1, stock: 8 }] }, { medicines: [{ id: 'bp', count: 1, stock: 8 }] }])).toEqual([4]);
    expect(refillThresholds([{ medicines: [{ id: 'bp', count: 1, stock: 2 }] }])).toEqual([2]);
    expect(refillThresholds([{ medicines: [{ id: 'bp', count: 1, stock: 7 }] }])).toEqual([7]);
    expect(refillThresholds([])).toEqual([]);
  });
});

it('sweeps duplicate ticks with deterministic task IDs and skips a logged dose', async () => {
  const { db, records } = memoryDb(base);
  await sweepDoses(db, now); await sweepDoses(db, now);
  expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  expect(mocks.enqueue.mock.calls[0][1].id).toEqual(mocks.enqueue.mock.calls[1][1].id);
  records.set('families/home/members/amma/doses/2026-11-07_morning', { status: 'confirmed' });
  await sweepDoses(db, now);
  expect(mocks.enqueue).toHaveBeenCalledTimes(2);
});

it('rechecks dose before keypad retry and delegates eligible calls only once per task', async () => {
  const { db, records } = memoryDb({ ...base, 'families/home/members/amma': { mode: 'keypad', consent: { calls: true } } });
  expect(await processReminder(db, input, now)).toEqual({ action: 'call_queued' });
  records.set('families/home/members/amma/doses/2026-11-07_morning', { status: 'reported' });
  expect(await processReminder(db, { ...input, attempt: 2 }, now)).toEqual({ action: 'skipped' });
  expect(mocks.call).toHaveBeenCalledTimes(1);
});

it('deduplicates accepted pushes and uses a new key after snooze expires', async () => {
  const { db, records } = memoryDb(base);
  await processReminder(db, input, now); await processReminder(db, input, now);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  const remindAt = Timestamp.fromMillis(now.getTime() - 1000);
  records.set('families/home/members/amma/snoozes/2026-11-07_morning', { remindAt });
  await processReminder(db, { ...input, generation: 0 }, now);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  await processReminder(db, { ...input, generation: remindAt.toMillis() }, now);
  expect(mocks.send).toHaveBeenCalledTimes(2);
});

it('does not overwrite a dose logged between final retry reads and its transaction', async () => {
  const { db, records } = memoryDb(base);
  const original = db.runTransaction.bind(db);
  db.runTransaction = (async (fn: any) => {
    records.set('families/home/members/amma/doses/2026-11-07_morning', { status: 'confirmed' });
    return original(fn);
  }) as any;
  expect(await processReminder(db, { ...input, attempt: 4 }, now)).toEqual({ action: 'skipped' });
  expect(records.get('families/home/members/amma/doses/2026-11-07_morning').status).toBe('confirmed');
  expect(mocks.enqueue).not.toHaveBeenCalled();
});

it('marks unanswered as unknown, never missed, and creates one canonical alert on replay', async () => {
  const { db, records } = memoryDb(base);
  await processReminder(db, { ...input, attempt: 4 }, now); await processReminder(db, { ...input, attempt: 4 }, now);
  expect(records.get('families/home/members/amma/doses/2026-11-07_morning').status).toBe('unknown');
  expect(records.get('families/home/views/anu/members/amma/doses/2026-11-07_morning')).toEqual({ date: '2026-11-07', slot: 'morning', status: 'unknown' });
  expect([...records.keys()].filter(key => key.startsWith('alerts/'))).toHaveLength(1);
});

it('claims concurrent jobs, releases unavailable providers and recovers expired leases', async () => {
  const { db, records } = memoryDb({});
  let release!: () => void;
  const work = new Promise<boolean>(resolve => { release = () => resolve(true); });
  const first = runClaimed(db, 'same', () => work, now);
  await vi.waitFor(() => expect(records.size).toBe(1));
  await expect(runClaimed(db, 'same', async () => true, now)).rejects.toThrow('already');
  release(); await first;
  const replay = vi.fn(async () => true);
  await runClaimed(db, 'same', replay, now); expect(replay).not.toHaveBeenCalled();
  expect(await runClaimed(db, 'missing-config', async () => false, now)).toBe(false);
  expect(records.get(`jobs/${eventKey('missing-config')}`).state).toBe('pending');
  expect(await runClaimed(db, 'missing-config', async () => true, now)).toBe(true);
  records.set(`jobs/${eventKey('crashed')}`, { state: 'claimed', owner: 'old', leaseUntil: Timestamp.fromMillis(now.getTime() - 1) });
  expect(await runClaimed(db, 'crashed', async () => true, now)).toBe(true);
});

it('only suppresses duplicate task errors, not permission/provider failures', async () => {
  mocks.enqueue.mockRejectedValueOnce({ code: 'functions/task-already-exists' });
  await expect(enqueueTask('retryCall', input, 'fixed')).resolves.toBeUndefined();
  mocks.enqueue.mockRejectedValueOnce({ code: 'permission-denied' });
  await expect(enqueueTask('retryCall', input, 'fixed')).rejects.toEqual({ code: 'permission-denied' });
});
