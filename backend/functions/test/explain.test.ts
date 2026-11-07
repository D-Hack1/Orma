import { afterEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { explain } from '../src/explain';

const input = { familyId: 'home', memberId: 'amma', date: '2026-11-07', slot: 'morning' as const };
const base = 'families/home/members/amma';
afterEach(() => vi.useRealTimers());
function fakeDb(extra: Record<string, unknown> = {}) {
  const records: Record<string, unknown> = { [base]: { ownerUid: 'amma' }, ...extra };
  return { doc: (path: string) => ({ get: async () => ({ exists: path in records, data: () => records[path] }) }) } as unknown as Firestore;
}
it('explains missing record without fabricating evidence', async () => {
  const result = await explain(fakeDb(), input, { uid: 'amma', memberId: 'amma', role: 'member' });
  expect(result.textEn).toContain('not sure');
  expect(result.reasons).toHaveLength(1);
});
it('denies private risk and withholds raw contributions from shared supporter risk', async () => {
  await expect(explain(fakeDb(), { ...input, kind: 'risk' }, { uid: 'anu', role: 'supporter' })).rejects.toThrow('private');
  const db = fakeDb({ [`${base}/settings/sharing`]: { risk: true }, [`${base}/risk/2026-11-07_morning`]: { contributions: [{ feature: 'askedTwice', value: 7, delta: 1 }] } });
  const result = await explain(db, { ...input, kind: 'risk' }, { uid: 'anu', role: 'supporter' });
  expect('contributions' in result && result.contributions).toEqual([]);
  expect(result.textEn).toContain('does not establish');
});
it('does not expose another member alert or private rule', async () => {
  const db = fakeDb({ 'alerts/a': { familyId: 'home', memberId: 'achan', rule: 'private' }, 'alerts/b': { familyId: 'home', memberId: 'amma', rule: 'private transcript' } });
  await expect(explain(db, { ...input, kind: 'alert', alertId: 'a' }, { uid: 'anu', role: 'supporter' })).rejects.toThrow('not found');
  const result = await explain(db, { ...input, kind: 'alert', alertId: 'b' }, { uid: 'anu', role: 'supporter' });
  expect(result.textEn).not.toContain('private');
});
it('guardian consent authority does not bypass private risk or alert rules', async () => {
  const guardian = { uid: 'anu', memberId: input.memberId, role: 'guardian' as const };
  const sharing = { guardianId: 'anu', capacityNote: 'Recorded legal guardian' };
  const risk = { contributions: [{ feature: 'askedTwice', value: 7, delta: 1 }] };
  const records = { [`${base}/settings/sharing`]: sharing, [`${base}/risk/2026-11-07_morning`]: risk,
    'alerts/a': { familyId: 'home', memberId: 'amma', rule: 'private transcript' } };
  await expect(explain(fakeDb(records), { ...input, kind: 'risk' }, guardian)).rejects.toThrow('private');
  const alert = await explain(fakeDb(records), { ...input, kind: 'alert', alertId: 'a' }, guardian);
  expect(alert.textEn).not.toContain('private');
  const shared = await explain(fakeDb({ ...records, [`${base}/settings/sharing`]: { ...sharing, risk: true } }), { ...input, kind: 'risk' }, guardian);
  expect('contributions' in shared && shared.contributions).toEqual([]);
});

it.each(['confirmed', 'reported', 'partial', 'pending', 'unknown'] as const)('explains %s without replacing exact authorized provenance', async status => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T01:00:00Z'));
  const evidence = { type: 'voice', by: 'amma', at: '2026-11-07T00:55:00Z', snippet: 'exact private words' };
  const db = fakeDb({
    [`${base}/doses/2026-11-07_morning`]: { status, countTaken: status === 'partial' ? 1 : 2, countExpected: 2,
      medicinesTaken: ['bp'], source: 'voice', by: 'amma', at: evidence.at, attempts: 0, evidence: [evidence] },
    [`${base}/schedule/morning`]: { time: '08:00', medicines: [{ id: 'bp', name: 'BP', count: 2, stock: 30 }] },
  });
  const own = await explain(db, input, { uid: 'amma', memberId: 'amma', role: 'member' });
  expect('status' in own && own.status).toBe(status);
  expect('sources' in own && own.sources.find(fact => fact.kind === 'evidence')?.evidence).toEqual(evidence);
  const shared = await explain(db, input, { uid: 'anu', role: 'supporter' });
  expect('sources' in shared && shared.sources.map(fact => fact.kind)).toEqual(['status']);
  expect(JSON.stringify(shared)).not.toContain('exact private words');
});

it('explains schedule-derived pending with no invented dose record and becomes unknown when due', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T02:29:00Z'));
  const db = fakeDb({ [`${base}/schedule/morning`]: { time: '08:00', medicines: [{ id: 'bp', name: 'BP', count: 2, stock: 30 }] } });
  const before = await explain(db, input, { uid: 'anu', role: 'supporter' });
  expect('status' in before && before.status).toBe('pending');
  expect(before.reasons[0].cites).toEqual(['schedule:morning']);
  expect(JSON.stringify(before)).not.toContain('dose:');
  vi.setSystemTime(new Date('2026-11-07T02:30:00Z'));
  const due = await explain(db, input, { uid: 'anu', role: 'supporter' });
  expect('status' in due && due.status).toBe('unknown');
  expect(due.reasons[0].cites).toEqual([]);
});
