import { expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { explain } from '../src/explain';

const input = { familyId: 'home', memberId: 'amma', date: '2026-11-07', slot: 'morning' as const };
const base = 'families/home/members/amma';
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
