import { expect, it } from 'vitest';
import type { MemberAccess } from '../src/platform/auth';
import { readSummaryRecords } from '../src/summaries/records';

function viewer(sharing: Record<string, unknown>, reads: string[]): MemberAccess {
  const docs = { schedule: [], doses: [], messages: [{ id: 'm1', data: () => ({ at: '2026-11-06T20:00:00Z', text: 'Headache reported' }) }], notes: [] };
  const context = { uid: 'anu', isOwner: false, sharing, member: {}, memberRef: {
    parent: { parent: { get: async () => ({ data: () => ({ timezone: 'Asia/Kolkata' }) }) } },
    collection: (name: keyof typeof docs) => {
      reads.push(name);
      const query: any = { get: async () => ({ docs: docs[name] }), orderBy: () => query, startAt: () => query, endAt: () => query };
      return query;
    },
  } };
  return context as unknown as MemberAccess;
}

it('never even reads unshared optional records and honors per-supporter denial', async () => {
  const reads: string[] = [];
  const records = await readSummaryRecords(viewer({ messages: true, perSupporter: { anu: { messages: false } } }, reads), '2026-11-07', '2026-11-07');
  expect(reads.sort()).toEqual(['doses', 'schedule']);
  expect(records.optionalFacts).toEqual([]);
});

it('places authorized message records in the member-local day, not UTC day', async () => {
  const records = await readSummaryRecords(viewer({ messages: true }, []), '2026-11-07', '2026-11-07');
  expect(records.optionalFacts).toHaveLength(1);
  expect(records.optionalFacts![0].textEn).toContain('unverified statement');
  expect(records.optionalFacts![0].textEn).toContain('Headache reported');
});
