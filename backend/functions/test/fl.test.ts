import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { aggregateRound, submitSimulatedUpdate, submitUpdate } from '../src/fl/core';

const secret = 'test-only-server-secret-32-bytes-long';
const names = ['slot', 'weekend', 'nurseOnShift', 'missRate7d', 'responseDelay', 'snoozes7d', 'repeatedQuestions7d', 'daysSinceDose', 'lowStock', 'unknowns7d'];
const version = 'synthetic-seed42-r12';
const delta = (first = 0.1) => [first, ...Array(10).fill(0)];
const payload = (deviceId = 'phone', extra = {}) => ({ deviceId, modelVersion: version, delta: delta(), n: 2, ...extra });

// Optimistic mock: snapshot reads, staged writes and retry on concurrent commit (including query changes).
function fixture() {
  const records = new Map<string, any>([
    ['flModels/latest', { version, round: 12, weights: Array(11).fill(0), featureNames: names, featureMeans: Array(10).fill(0.5) }],
  ]);
  let revision = 0;
  const ref = (path: string): any => ({ path, collection: (name: string) => collection(`${path}/${name}`) });
  const collection = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), limit: (limit: number) => ({ path, query: true, limit }) });
  const snapshot = (path: string, view: Map<string, any>) => ({ id: path.split('/').at(-1), exists: view.has(path), data: () => view.get(path) });
  const db = {
    doc: ref,
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      for (let retry = 0; retry < 100; retry++) {
        const start = revision;
        const view = new Map(records);
        const writes = new Map<string, any>();
        let writing = false;
        const result = await fn({
          get: async (r: any) => {
            if (writing) throw new Error('Transaction read after write');
            if (!r.query) return snapshot(r.path, view);
            const docs = [...view.keys()].filter(path => path.startsWith(`${r.path}/`) && !path.slice(r.path.length + 1).includes('/'))
              .slice(0, r.limit).map(path => snapshot(path, view));
            return { docs, size: docs.length };
          },
          create: (r: any, value: unknown) => { if (view.has(r.path)) throw new Error('Already exists'); writing = true; writes.set(r.path, value); },
          set: (r: any, value: unknown) => { writing = true; writes.set(r.path, value); },
        });
        if (revision !== start) continue;
        if (writes.size) { for (const [path, value] of writes) records.set(path, value); revision++; }
        return result;
      }
      throw new Error('Retries exhausted');
    },
  } as unknown as Firestore;
  const device = (deviceId = 'phone', uid = 'owner') => {
    records.set(`devices/${deviceId}`, { ownerUid: uid, familyId: 'home', memberIds: [deviceId], tier: 'T1' });
    records.set(`families/home/members/${deviceId}`, { ownerUid: uid, deviceIds: [deviceId], tier: 'T1', consent: { fl: true } });
    records.set(`families/home/access/${uid}`, { active: true, memberIds: [deviceId] });
  };
  device();
  const submitFive = async () => {
    for (let i = 0; i < 5; i++) {
      device(`p${i}`, `u${i}`);
      await submitUpdate(db, `u${i}`, payload(`p${i}`, { delta: delta(i / 10), n: i + 1 }), secret);
    }
  };
  return { db, records, device, submitFive };
}

describe('FL submission validation', () => {
  it.each([
    { delta: Array(10).fill(0) }, { delta: Array(12).fill(0) },
    { delta: delta(NaN) }, { delta: delta(Infinity) }, { delta: delta(-Infinity) },
    { delta: delta(1.001) }, { delta: Array(11).fill(0.4) },
    { n: 0 }, { n: 10001 }, { n: 1.5 },
    { roles: ['admin'] }, { simulated: true }, { familyId: 'attacker' }, { rawFeatures: [] },
    { modelVersion: 'x'.repeat(129) }, { deviceId: '../phone' },
  ])('rejects invalid or excessive payload %j', async extra => {
    const { db, records } = fixture();
    await expect(submitUpdate(db, 'owner', payload('phone', extra), secret)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect([...records.keys()].some(path => path.startsWith('flUpdates/'))).toBe(false);
  });
  it('enforces current model version and feature order', async () => {
    const { db, records } = fixture();
    await expect(submitUpdate(db, 'owner', payload('phone', { modelVersion: 'v0' }), secret)).rejects.toMatchObject({ code: 'failed-precondition' });
    records.get('flModels/latest').featureNames = [...names].reverse();
    await expect(submitUpdate(db, 'owner', payload(), secret)).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('accepts final reclip tolerance and n=10000; saves only allowed update fields', async () => {
    const { db, records } = fixture();
    expect(await submitUpdate(db, 'owner', payload('phone', { delta: delta(1 + 0.5e-6), n: 10000 }), secret)).toEqual({ accepted: true, round: 13 });
    const [path, value] = [...records].find(([key]) => /^flUpdates\/13\/clients\//.test(key))!;
    expect(path).toMatch(/^flUpdates\/13\/clients\/[a-f0-9]{64}$/);
    expect(Object.keys(value).sort()).toEqual(['at', 'clipNorm', 'delta', 'modelVersion', 'n']);
  });
  it('rejects missing auth or weak server secret', async () => {
    const { db } = fixture();
    await expect(submitUpdate(db, '', payload(), secret)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(submitUpdate(db, 'owner', payload(), 'short')).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('serializes duplicate concurrent device submissions', async () => {
    const { db, records } = fixture();
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => submitUpdate(db, 'owner', payload(), secret)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'already-exists')).toBe(true);
    expect(records.get('flUpdates/13').clients).toBe(1);
  });
  it('limits submissions per round', async () => {
    const { db, records } = fixture();
    records.set('flUpdates/13', { baseVersion: version, clients: 100, aggregated: false });
    await expect(submitUpdate(db, 'owner', payload(), secret)).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
  it('does not count a device twice after server secret rotation', async () => {
    const { db } = fixture();
    await submitUpdate(db, 'owner', payload(), secret);
    await expect(submitUpdate(db, 'owner', payload(), `${secret}-rotated`)).rejects.toMatchObject({ code: 'already-exists' });
  });
});

describe('FL server-controlled authorization', () => {
  it.each(['wrongUid', 'unboundOwner', 'conflictingUid', 'revoked', 'inactiveDevice', 'inactiveAccess', 'noAccess', 'noReverseBinding', 'noConsent', 'T2device', 'T2member', 'otherUnconsentedMember'])('rejects %s', async scenario => {
    const { db, records } = fixture();
    const device = records.get('devices/phone');
    const member = records.get('families/home/members/phone');
    const access = records.get('families/home/access/owner');
    if (scenario === 'unboundOwner') delete device.ownerUid;
    if (scenario === 'conflictingUid') device.registeredUid = 'attacker';
    if (scenario === 'revoked') device.revokedAt = new Date();
    if (scenario === 'inactiveDevice') device.active = false;
    if (scenario === 'inactiveAccess') access.active = false;
    if (scenario === 'noAccess') access.memberIds = [];
    if (scenario === 'noReverseBinding') member.deviceIds = [];
    if (scenario === 'noConsent') member.consent.fl = false;
    if (scenario === 'T2device') device.tier = 'T2';
    if (scenario === 'T2member') member.tier = 'T2';
    if (scenario === 'otherUnconsentedMember') {
      device.memberIds.push('other'); access.memberIds.push('other');
      records.set('families/home/members/other', { tier: 'T1', consent: { fl: false }, deviceIds: ['phone'] });
    }
    await expect(submitUpdate(db, scenario === 'wrongUid' ? 'attacker' : 'owner', payload(), secret)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('FL aggregation', () => {
  it('requires K=5 distinct clients, not large sample n', async () => {
    const { db } = fixture();
    await submitUpdate(db, 'owner', payload('phone', { n: 10000 }), secret);
    expect(await aggregateRound(db, 13)).toEqual({ aggregated: false, clients: 1, requiredClients: 5 });
  });
  it('sample-weights deltas and atomically publishes once under concurrency', async () => {
    const { db, records, submitFive } = fixture();
    await submitFive();
    const results = await Promise.all([aggregateRound(db, 13), aggregateRound(db, 13), aggregateRound(db, 13)]);
    expect(results.filter(r => r.aggregated)).toHaveLength(1);
    const latest = records.get('flModels/latest');
    expect(latest.weights[0]).toBeCloseTo((0 + 0.2 + 0.6 + 1.2 + 2) / 15);
    expect(latest.weights.slice(1)).toEqual(Array(10).fill(0));
    expect(latest.version).toMatch(/^fl-r13-/);
    expect(records.get(`flModels/${latest.version}`)).toEqual(latest);
    expect(latest.featureMeans).toEqual(Array(10).fill(0.5));
    expect(latest.clients).toBe(5);
    expect(latest.simulatedClients).toBe(0);
    expect((await aggregateRound(db, 13)).aggregated).toBe(false);
  });
  it('keeps the K boundary consistent when the fifth submission races aggregation', async () => {
    const { db, records, device } = fixture();
    for (let i = 0; i < 4; i++) {
      device(`p${i}`, `u${i}`);
      await submitUpdate(db, `u${i}`, payload(`p${i}`), secret);
    }
    await Promise.all([submitUpdate(db, 'owner', payload(), secret), aggregateRound(db, 13)]);
    await aggregateRound(db, 13);
    expect(records.get('flModels/latest').clients).toBe(5);
    expect(records.get('flModels/latest').weights[0]).toBeCloseTo(0.1);
    expect(records.get('flUpdates/13').acceptedClients).toBe(5);
  });
  it.each(['consent', 'device', 'access'])('excludes updates revoked before aggregation: %s', async kind => {
    const { db, records, submitFive } = fixture();
    await submitFive();
    if (kind === 'consent') records.get('families/home/members/p0').consent.fl = false;
    if (kind === 'device') records.get('devices/p0').revoked = true;
    if (kind === 'access') records.get('families/home/access/u0').active = false;
    expect(await aggregateRound(db, 13)).toEqual({ aggregated: false, clients: 4, requiredClients: 5 });
    expect(records.get('flModels/latest').version).toBe(version);
  });
  it('rejects stale round even when latest round number is unchanged', async () => {
    const { db, records, submitFive } = fixture();
    await submitFive();
    records.get('flModels/latest').version = 'replacement-opaque-version';
    await expect(aggregateRound(db, 13)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect([...records.keys()].filter(key => key.startsWith('flModels/'))).toHaveLength(1);
  });
  it('revalidates stored version and numerical bounds', async () => {
    const { db, records, submitFive } = fixture();
    await submitFive();
    const client = [...records].find(([path]) => path.startsWith('flUpdates/13/clients/'))![1];
    client.delta[0] = Infinity;
    await expect(aggregateRound(db, 13)).rejects.toMatchObject({ code: 'invalid-argument' });
    client.delta = delta(); client.modelVersion = 'old';
    await expect(aggregateRound(db, 13)).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('labels admin-only simulations in the published model and prevents duplicate simulated keys', async () => {
    const { db, records } = fixture();
    for (let i = 0; i < 4; i++) await submitSimulatedUpdate(db, `synthetic-${i}`, { modelVersion: version, delta: delta(), n: 3 }, secret);
    await expect(submitSimulatedUpdate(db, 'synthetic-0', { modelVersion: version, delta: delta(), n: 3 }, secret)).rejects.toMatchObject({ code: 'already-exists' });
    expect(await aggregateRound(db, 13)).toMatchObject({ aggregated: false, clients: 4 });
    await submitUpdate(db, 'owner', payload(), secret);
    expect(await aggregateRound(db, 13)).toMatchObject({ aggregated: true, clients: 5, simulatedClients: 4 });
    expect(records.get('flModels/latest').simulatedClients).toBe(4);
  });
  it('uses different pseudonyms in subsequent rounds and rejects the previous base', async () => {
    const { db, records, submitFive } = fixture();
    await submitFive();
    await submitUpdate(db, 'owner', payload(), secret);
    const oldId = [...records].find(([path, value]) => path.startsWith('flRoundBindings/13/clients/') && value.deviceId === 'phone')![0].split('/').at(-1);
    await aggregateRound(db, 13);
    await expect(submitUpdate(db, 'owner', payload(), secret)).rejects.toMatchObject({ code: 'failed-precondition' });
    await submitUpdate(db, 'owner', payload('phone', { modelVersion: records.get('flModels/latest').version }), secret);
    const newId = [...records.keys()].find(path => path.startsWith('flUpdates/14/clients/'))!.split('/').at(-1);
    expect(newId).not.toBe(oldId);
  });
});
