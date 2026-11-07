import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { answerFromFacts, askStatus, buildFactPack, isBeforeScheduledTime, validateSentences } from '../src/replies';
import type { Actor, Dose, DoseKey, Member } from '../src/doses';

const key: DoseKey = { familyId: 'home', memberId: 'amma', date: '2026-11-07', slot: 'morning' };
const owner: Actor = { uid: 'amma', memberId: 'amma', role: 'member' };
const supporter: Actor = { uid: 'anu', role: 'supporter' };
const member: Member = { ownerUid: 'amma' };
const dose: Dose = { status: 'confirmed', countTaken: 2, countExpected: 2, medicinesTaken: ['bp'], source: 'voice', by: 'amma', at: '08:15', attempts: 0,
  evidence: [{ type: 'voice', by: 'amma', at: '08:15', snippet: 'private words' }] };
const schedule = { time: '08:00', medicines: [{ id: 'bp', name: 'BP', count: 2, stock: 30 }] };
afterEach(() => vi.useRealTimers());

function statusDb(records: Map<string, unknown>) {
  const ref = (path: string) => ({ path, set: async (value: unknown) => records.set(path, value) });
  const tx = {
    get: async (reference: { path: string }) => ({ exists: records.has(reference.path), data: () => records.get(reference.path) }),
    set: (reference: { path: string }, value: unknown) => records.set(reference.path, value),
  };
  return { doc: ref, runTransaction: async (fn: (value: unknown) => unknown) => fn(tx) } as unknown as Firestore;
}

describe('grounded replies', () => {
  it('no record stays unknown even when generator invents confirmation', async () => {
    const pack = buildFactPack(key, member, owner);
    const answer = await answerFromFacts(pack, async () => ({ sentences: [{ text: 'Confirmed taken at 08:15.', cites: [pack.facts[0].id] }] }));
    expect(answer.status).toBe('unknown');
    expect(answer.fallbackUsed).toBe(true);
    expect(answer.textEn).toContain('Please wait');
    expect(answer.textEn).not.toContain('asking');
  });
  it('accepts approved text with a real citation', async () => {
    const pack = buildFactPack(key, member, owner, dose);
    const answer = await answerFromFacts(pack, async () => ({ sentences: [{ text: pack.facts[0].textEn, cites: [pack.facts[0].id] }] }));
    expect(answer.fallbackUsed).toBe(false);
  });
  it.each([
    { text: 'Taken at 08:15.', cites: ['invented'] },
    { text: 'Taken at 09:15.', cites: ['dose:2026-11-07_morning:evidence:0'] },
    { text: '3 of 2 tablets are recorded as taken.', cites: ['dose:2026-11-07_morning:count'] },
    { text: 'Take Warfarin now.', cites: ['dose:2026-11-07_morning'] },
    { text: 'Definitely taken.', cites: [] },
    { text: 'You are safe to take another dose.', cites: ['dose:2026-11-07_morning'] },
  ])('drops ungrounded sentence %j', sentence => {
    expect(validateSentences({ sentences: [sentence] }, buildFactPack(key, member, owner, dose))).toEqual([]);
  });
  it('does not let count-only generation omit safety wording', async () => {
    const pack = buildFactPack(key, member, owner, dose);
    const count = pack.facts.find(f => f.kind === 'count')!;
    expect((await answerFromFacts(pack, async () => ({ sentences: [{ text: count.textEn, cites: [count.id] }] }))).fallbackUsed).toBe(true);
  });
  it('falls back on generator failure or malformed response', async () => {
    const pack = buildFactPack(key, member, owner, dose);
    expect((await answerFromFacts(pack, async () => { throw Error('offline'); })).fallbackUsed).toBe(true);
    expect((await answerFromFacts(pack, async () => null)).fallbackUsed).toBe(true);
  });
  it('filters private facts before any generator sees them', async () => {
    const pack = buildFactPack(key, member, supporter, dose);
    expect(pack.facts.map(f => f.kind)).toEqual(['status']);
    expect(JSON.stringify(pack)).not.toContain('08:15');
    expect(JSON.stringify(pack)).not.toContain('private words');
  });
  it('honors per-supporter count denial over shared default', () => {
    const sharing = { counts: true, perSupporter: { anu: { counts: false } } };
    expect(buildFactPack(key, { ...member, sharing }, supporter, dose).facts).toHaveLength(1);
  });
  it('count sharing never grants evidence access', () => {
    expect(buildFactPack(key, { ...member, sharing: { counts: true } }, supporter, dose).facts.map(f => f.kind)).toEqual(['status', 'count']);
  });
  it('guardian authority does not grant private counts or evidence', () => {
    const guardian: Actor = { uid: 'anu', memberId: key.memberId, role: 'guardian' };
    const sharing = { guardianId: 'anu', capacityNote: 'Recorded legal guardian' };
    expect(buildFactPack(key, { ...member, sharing }, guardian, dose).facts.map(f => f.kind)).toEqual(['status']);
    expect(buildFactPack(key, { ...member, sharing: { ...sharing, counts: true } }, guardian, dose).facts.map(f => f.kind)).toEqual(['status', 'count']);
    expect(buildFactPack(key, { ...member, sharing: { ...sharing, counts: true, perSupporter: { anu: { counts: false } } } }, guardian, dose).facts.map(f => f.kind)).toEqual(['status']);
  });
  it.each(['confirmed', 'reported', 'partial', 'pending', 'unknown'] as const)('keeps %s meaning in fallback', async status => {
    const answer = await answerFromFacts(buildFactPack(key, member, owner, { ...dose, status }, { schedule, now: new Date('2026-11-07T01:00:00Z') }));
    expect(answer.status).toBe(status);
    expect(answer.textMl.length).toBeGreaterThan(0);
  });
});

it('askStatus repopulates only safe viewer documents and writes unknown alert, not private answers', async () => {
  const base = 'families/home/members/amma';
  const records = new Map<string, unknown>([
    [base, { ownerUid: 'amma', name: 'Amma', mode: 'assisted' }],
    ['families/home/access/anu', { active: true, memberIds: ['amma'], roles: ['supporter'] }],
  ]);
  const db = statusDb(records);
  const answer = await askStatus(db, key, supporter, async pack => {
    expect(pack.facts).toHaveLength(1);
    return { sentences: [{ text: 'Confirmed taken.', cites: [pack.facts[0].id] }] };
  });
  expect(answer.status).toBe('unknown');
  expect(answer.sentences).toEqual([]);
  expect(records.get('families/home/views/anu/members/amma/doses/2026-11-07_morning')).toEqual({ date: key.date, slot: key.slot, status: 'unknown' });
  expect(records.has('alerts/unknown_home_amma_2026-11-07_morning')).toBe(true);
  expect([...records.keys()].some(path => path.includes('/answers/'))).toBe(false);
});

it.each([
  ['2026-11-07T02:29:59Z', 'pending'],
  ['2026-11-07T02:30:00Z', 'unknown'],
  ['2026-11-07T03:00:00Z', 'unknown'],
] as const)('no log at %s resolves member-local status %s using only an actual schedule citation', async (now, expected) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  const base = 'families/home/members/amma';
  const records = new Map<string, unknown>([
    [base, member], ['families/home', { timezone: 'Asia/Kolkata' }],
    [`${base}/schedule/morning`, schedule],
    ['families/home/access/anu', { active: true, memberIds: ['amma'], roles: ['supporter'] }],
  ]);
  const answer = await askStatus(statusDb(records), key, supporter);
  expect(answer.status).toBe(expected);
  expect(answer.factPackIds.some(id => id.startsWith('dose:'))).toBe(false);
  expect(records.has(`${base}/doses/2026-11-07_morning`)).toBe(false);
  if (expected === 'pending') {
    expect(answer.factPackIds).toEqual(['schedule:morning']);
    expect(answer.sources[0].scheduled).toEqual({ date: key.date, slot: key.slot, time: '08:00', timezone: 'Asia/Kolkata' });
    expect(JSON.stringify(answer.sources)).not.toContain('stock');
    expect(JSON.stringify(answer.sources)).not.toContain('BP');
    expect(records.has('alerts/unknown_home_amma_2026-11-07_morning')).toBe(false);
  } else expect(answer.sentences).toEqual([]);
});

it('uses member timezone over family timezone and handles local midnight', async () => {
  const context = { schedule: { ...schedule, time: '00:15' }, timezone: 'Asia/Kolkata', now: new Date('2026-11-06T18:40:00Z') };
  expect(isBeforeScheduledTime(key, context)).toBe(true);
  expect(isBeforeScheduledTime(key, { ...context, now: new Date('2026-11-06T18:45:00Z') })).toBe(false);
  expect(isBeforeScheduledTime(key, { ...context, timezone: 'invalid' })).toBe(false);
  expect(isBeforeScheduledTime(key, { ...context, schedule: { ...schedule, time: '25:00' } })).toBe(false);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T03:00:00Z'));
  const base = 'families/home/members/amma';
  const records = new Map<string, unknown>([
    [base, { ...member, timezone: 'Asia/Dubai' }], ['families/home', { timezone: 'Asia/Kolkata' }],
    [`${base}/schedule/morning`, schedule], ['families/home/access/anu', { active: true, memberIds: ['amma'], roles: ['supporter'] }],
  ]);
  expect((await askStatus(statusDb(records), key, supporter)).status).toBe('pending');
});

it('does not preserve a stale pending dose after the scheduled time', () => {
  const pack = buildFactPack(key, member, owner, { ...dose, status: 'pending' }, { schedule, now: new Date('2026-11-07T03:00:00Z') });
  expect(pack.status).toBe('unknown');
});

it('status queries retain consented count projections from actual records but never project evidence', async () => {
  const base = 'families/home/members/amma';
  const records = new Map<string, unknown>([
    [base, member], [`${base}/settings/sharing`, { counts: true }], [`${base}/doses/2026-11-07_morning`, dose],
    ['families/home/access/anu', { active: true, memberIds: ['amma'], roles: ['supporter'] }],
  ]);
  const answer = await askStatus(statusDb(records), key, supporter);
  expect(answer.sources.map(fact => fact.kind)).toEqual(['status', 'count']);
  expect(records.get('families/home/views/anu/members/amma/doses/2026-11-07_morning')).toEqual({ date: key.date, slot: key.slot,
    status: 'confirmed', countTaken: 2, countExpected: 2, medicinesTaken: ['bp'] });
  records.set(`${base}/settings/sharing`, { counts: true, perSupporter: { anu: { counts: false } } });
  await askStatus(statusDb(records), key, supporter);
  expect(records.get('families/home/views/anu/members/amma/doses/2026-11-07_morning')).toEqual({ date: key.date, slot: key.slot, status: 'confirmed' });
});

it.each(['supporter', 'nurse'] as const)('status transaction denies a revoked %s role before writing projections', async role => {
  const base = 'families/home/members/amma';
  const records = new Map<string, unknown>([
    [base, { ...member, nurseIds: ['anu'] }],
    ['families/home/access/anu', { active: true, memberIds: ['amma'], roles: ['member'] }],
  ]);
  await expect(askStatus(statusDb(records), key, { ...supporter, role })).rejects.toThrow('role changed');
  expect([...records.keys()].some(path => path.includes('/views/'))).toBe(false);
});
