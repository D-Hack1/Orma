import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { assertActor, assertCurrentAccess, decideDose, doseProjection, logDose, logDoseSchema, synchronizeStock, type Actor, type LogDoseInput, type Schedule } from '../src/doses';

const actor: Actor = { uid: 'amma', memberId: 'amma', role: 'member' };
const input: LogDoseInput = { familyId: 'home', memberId: 'amma', date: '2026-11-07', slot: 'morning', countTaken: 3, source: 'tap' };
const schedule: Schedule = { medicines: [{ id: 'bp', name: 'BP', count: 1, stock: 10 }, { id: 'vitamin', name: 'Vitamin', count: 2, stock: 20 }] };
const at = '2026-11-07T02:30:00Z';

describe('dose decisions', () => {
  it('records self-report and decrements actual medicine quantities', () => {
    const result = decideDose(schedule, input, actor, at);
    expect(result.dose.status).toBe('confirmed');
    expect(result.medicines.map(m => m.stock)).toEqual([9, 18]);
    expect(result.dose.by).toBe('amma');
  });
  it('does not trust caller by or source to turn a supporter report into confirmation', () => {
    expect(() => decideDose(schedule, { ...input, by: 'amma' }, { uid: 'anu', role: 'supporter' }, at)).toThrow('authenticated');
    const result = decideDose(schedule, { ...input, evidence: [{ by: 'amma', at: 'fake', type: 'photo' }] }, { uid: 'anu', role: 'supporter' }, at);
    expect(result.dose.status).toBe('reported');
    expect(result.dose.by).toBe('anu');
    expect(result.dose.evidence[0].by).toBe('anu');
  });
  it('records partial with precise stock and rejects its duplicate without mutation', () => {
    const partial = decideDose(schedule, { ...input, countTaken: 1, medicinesTaken: ['bp'] }, actor, at);
    expect(partial.result).toBe('partial');
    expect(partial.medicines.map(m => m.stock)).toEqual([9, 20]);
    const replay = decideDose({ medicines: partial.medicines }, input, actor, at, partial.dose);
    expect(replay.result).toBe('duplicate_blocked');
    expect(replay.medicines).toEqual(partial.medicines);
  });
  it('requires clarification rather than guessing stock for count-only partial', () => {
    expect(() => decideDose(schedule, { ...input, countTaken: 1 }, actor, at)).toThrow('Clarify');
  });
  it('supports an explicit partial quantity of one named medicine', () => {
    const result = decideDose(schedule, { ...input, countTaken: 1, medicinesTaken: ['vitamin'] }, actor, at);
    expect(result.result).toBe('partial');
    expect(result.medicines.map(m => m.stock)).toEqual([10, 19]);
  });
  it('does not turn a photo observation into ingestion confirmation', () => {
    expect(() => decideDose(schedule, { ...input, source: 'photo' }, actor, at)).toThrow('photo');
  });
  it.each([
    { countTaken: 4 }, { countTaken: -1 }, { countTaken: 0 },
    { medicinesTaken: ['other'] }, { medicinesTaken: ['bp', 'bp'] },
    { medicinesTaken: ['bp'] }, { date: '2026-02-30' }, { familyId: '../bad' },
  ])('rejects invalid input %j', changes => {
    expect(() => decideDose(schedule, { ...input, ...changes }, actor, at)).toThrow();
  });
  it('rejects stock underflow instead of silently clamping', () => {
    expect(() => decideDose({ medicines: [{ id: 'bp', name: 'BP', count: 3, stock: 2 }] }, input, actor, at)).toThrow('stock');
  });
  it('drops invented evidence spans and keeps authenticated provenance', () => {
    const result = decideDose(schedule, { ...input, evidence: { snippet: 'three tablets', spans: [{ field: 'count', span: 'three' }, { field: 'slot', span: 'morning' }] } }, actor, at);
    expect(result.dose.evidence[0].spans).toEqual([{ field: 'count', span: 'three' }]);
  });
  it('requires a recorded capacity note for guardian full access', () => {
    expect(() => assertActor({ sharing: { guardianId: 'anu' } }, logDoseSchema.parse(input), { role: 'guardian', uid: 'anu' })).toThrow();
  });
  it('keeps independent member decisions separate for group requests', () => {
    const first = decideDose(schedule, input, actor, at);
    const second = decideDose(schedule, { ...input, memberId: 'achan' }, { ...actor, memberId: 'achan' }, at);
    expect(first.dose.countTaken).toBe(3);
    expect(second.dose.countTaken).toBe(3);
    expect(schedule.medicines[0].stock).toBe(10);
  });
});

it.each([actor, { uid: 'anu', memberId: 'amma', role: 'guardian' } as Actor])('transaction uses fixed document ID, performs all reads first and blocks replay for $role', async caller => {
  const records = new Map<string, unknown>([
    ['families/home/members/amma', { ownerUid: 'amma' }],
    ['families/home/members/amma/settings/sharing', { guardianId: 'anu', capacityNote: 'Recorded legal guardian' }],
    ['families/home/members/amma/schedule/morning', schedule],
  ]);
  let writing = false;
  const tx = {
    get: async (path: string) => {
      expect(writing).toBe(false);
      if (path.endsWith('/access')) return { docs: [{ id: 'amma', data: () => ({ active: true, memberIds: ['amma'], roles: ['member'] }) }, { id: 'anu', data: () => ({ active: true, memberIds: ['amma'], roles: ['supporter'] }) }] };
      if (path.endsWith('/schedule')) return { docs: [...records.entries()].filter(([id]) => id.startsWith(`${path}/`)).map(([id, data]) => ({ id: id.slice(path.length + 1), data: () => data })) };
      return { exists: records.has(path), data: () => records.get(path) };
    },
    set: (path: string, value: unknown) => { writing = true; records.set(path, value); },
    update: (path: string, value: object) => { writing = true; records.set(path, { ...records.get(path) as object, ...value }); },
  };
  const db = { doc: (path: string) => path, collection: (path: string) => path, runTransaction: async (fn: (tx: unknown) => unknown) => { writing = false; return fn(tx); } } as unknown as Firestore;
  const logged = await logDose(db, input, caller);
  expect(logged.result).toBe('logged');
  const status = caller.role === 'guardian' ? 'reported' : 'confirmed';
  expect(logged.status).toBe(status);
  expect((await logDose(db, input, caller)).result).toBe('duplicate_blocked');
  expect(records.has('families/home/members/amma/doses/2026-11-07_morning')).toBe(true);
  expect((records.get('families/home/members/amma/schedule/morning') as Schedule).medicines[0].stock).toBe(9);
  expect(records.has('alerts/double_home_amma_2026-11-07_morning')).toBe(true);
  expect(records.get('families/home/views/anu/members/amma/doses/2026-11-07_morning')).toEqual({ date: input.date, slot: input.slot, status });
});

it('synchronizes a shared medicine stock across slots without copying dose quantities', () => {
  const schedules = { morning: schedule, night: { medicines: [{ id: 'bp', name: 'BP', count: 2, stock: 10 }] } };
  const decision = decideDose(schedule, input, actor, at);
  const changed = synchronizeStock(schedules, 'morning', decision.medicines, decision.dose.medicinesTaken);
  expect(changed.night.medicines[0]).toEqual({ id: 'bp', name: 'BP', count: 2, stock: 9 });
  expect(changed.morning.medicines.map(m => m.stock)).toEqual([9, 18]);
  expect(schedules.night.medicines[0].stock).toBe(10);
});

it.each([9, undefined])('rejects inconsistent shared stock %s without guessing', stock => {
  const decision = decideDose(schedule, input, actor, at);
  expect(() => synchronizeStock({ morning: schedule, night: { medicines: [{ id: 'bp', name: 'BP', count: 1, stock }] } },
    'morning', decision.medicines, decision.dose.medicinesTaken)).toThrow('Reconcile');
});

it.each(['supporter', 'nurse'] as const)('rejects a revoked %s role despite active member assignment', role => {
  const member = { nurseIds: ['anu'] };
  const key = logDoseSchema.parse(input);
  const caller: Actor = { uid: 'anu', role };
  expect(() => assertCurrentAccess(member, key, caller, { active: true, memberIds: ['amma'], roles: ['member'] })).toThrow('role changed');
  expect(() => assertCurrentAccess(member, key, caller, { active: true, memberIds: ['amma'], roles: [role] })).not.toThrow();
});

it('concurrent different-slot transactions retry shared stock reads and never double-count physical stock', async () => {
  const base = 'families/home/members/amma';
  const records = new Map<string, any>([
    [base, { ownerUid: 'amma' }],
    ['families/home/access/amma', { active: true, memberIds: ['amma'], roles: ['member'] }],
    [`${base}/schedule/morning`, { medicines: [{ id: 'bp', name: 'BP', count: 1, stock: 30 }] }],
    [`${base}/schedule/night`, { medicines: [{ id: 'bp', name: 'BP', count: 2, stock: 30 }] }],
  ]);
  let version = 0;
  let retries = 0;
  const db = {
    doc: (path: string) => path, collection: (path: string) => path,
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      for (;;) {
        const readVersion = version;
        const snapshot = new Map(records);
        const writes = new Map<string, any>();
        const tx = {
          get: async (path: string) => {
            expect(writes.size).toBe(0);
            if (path.endsWith('/schedule') || path.endsWith('/access')) return {
              docs: [...snapshot.entries()].filter(([key]) => key.startsWith(`${path}/`)).map(([key, value]) => ({ id: key.slice(path.length + 1), data: () => value })),
            };
            return { exists: snapshot.has(path), data: () => snapshot.get(path) };
          },
          set: (path: string, value: unknown) => writes.set(path, value),
          update: (path: string, value: object) => writes.set(path, { ...snapshot.get(path), ...value }),
        };
        const result = await fn(tx);
        if (readVersion !== version) { retries++; continue; }
        for (const [path, value] of writes) records.set(path, value);
        version++;
        return result;
      }
    },
  } as unknown as Firestore;
  const results = await Promise.all([
    logDose(db, { ...input, countTaken: 1 }, actor),
    logDose(db, { ...input, slot: 'night', countTaken: 2 }, actor),
  ]);
  expect(results.map(result => result.result)).toEqual(['logged', 'logged']);
  expect(retries).toBeGreaterThan(0);
  expect(records.get(`${base}/schedule/morning`).medicines[0].stock).toBe(27);
  expect(records.get(`${base}/schedule/night`).medicines[0].stock).toBe(27);
  expect(records.get(`${base}/doses/2026-11-07_morning`).countTaken).toBe(1);
  expect(records.get(`${base}/doses/2026-11-07_night`).countTaken).toBe(2);
  expect((await logDose(db, { ...input, countTaken: 1 }, actor)).result).toBe('duplicate_blocked');
  expect(records.get(`${base}/schedule/night`).medicines[0].stock).toBe(27);
  records.set(`${base}/schedule/night`, { medicines: [{ id: 'bp', name: 'BP', count: 2, stock: 26 }] });
  await expect(logDose(db, { ...input, date: '2026-11-08', countTaken: 1 }, actor)).rejects.toThrow('Reconcile');
  expect(records.get(`${base}/schedule/morning`).medicines[0].stock).toBe(27);
  expect(records.has(`${base}/doses/2026-11-08_morning`)).toBe(false);
  records.set('families/home/access/anu', { active: true, memberIds: ['amma'], roles: ['member'] });
  await expect(logDose(db, { ...input, date: '2026-11-08', countTaken: 1 }, { uid: 'anu', role: 'supporter' })).rejects.toThrow('role changed');
  expect(records.has(`${base}/doses/2026-11-08_morning`)).toBe(false);
});

it('count projections obey current per-viewer consent without private evidence', () => {
  const { dose } = decideDose(schedule, input, actor, at);
  const projection = doseProjection(logDoseSchema.parse(input), dose, { sharing: { counts: true } }, 'anu');
  expect(Object.keys(projection).sort()).toEqual(['countExpected', 'countTaken', 'date', 'medicinesTaken', 'slot', 'status']);
  expect(Object.keys(doseProjection(logDoseSchema.parse(input), dose, { sharing: { counts: true, perSupporter: { anu: { counts: false } } } }, 'anu')).sort()).toEqual(['date', 'slot', 'status']);
});
