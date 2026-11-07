import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { db } from '../src/platform/firebase';
import { logDose } from '../src/doses';
import { confirmPrescription } from '../src/vision';
import { aggregateRound, submitSimulatedUpdate } from '../src/fl';

let environment: RulesTestEnvironment;
const familyId = 'integration-family', memberId = 'self', uid = 'self-owner';
const base = `families/${familyId}/members/${memberId}`;
const key = { familyId, memberId, date: '2026-11-07', slot: 'morning' as const };
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Local Firestore emulator required.');
  environment = await initializeTestEnvironment({ projectId: 'demo-orma', firestore: { rules: readFileSync('../firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await db.doc(`families/${familyId}`).set({ timezone: 'Asia/Kolkata' });
  await db.doc(base).set({ name: 'Self', mode: 'independent', ownerUid: uid, nurseIds: ['nurse'], deviceIds: [] });
  await db.doc(`families/${familyId}/access/${uid}`).set({ active: true, roles: ['member'], memberIds: [memberId] });
  await db.doc(`${base}/settings/sharing`).set({ version: 0, counts: false, messages: false });
  for (const [slot, time] of [['morning', '08:00'], ['noon', '13:00']]) {
    await db.doc(`${base}/schedule/${slot}`).set({ slot, time, afterFood: true, food: 'after', medicines: [{ id: 'shared-medicine', name: 'Entered medicine', count: 1, stock: 10 }] });
  }
});
afterAll(async () => { await environment?.cleanup(); });

test('real concurrent transactions block duplicates and preserve stock across slots', async () => {
  const input = { ...key, countTaken: 1, medicinesTaken: ['shared-medicine'], source: 'tap' as const };
  const actor = { uid, role: 'member' as const, memberId };
  const results = await Promise.all([logDose(db, input, actor), logDose(db, input, actor)]);
  expect(results.map(result => result.result).sort()).toEqual(['duplicate_blocked', 'logged']);
  await logDose(db, { ...input, slot: 'noon' }, actor);
  for (const slot of ['morning', 'noon']) expect((await db.doc(`${base}/schedule/${slot}`).get()).data()?.medicines[0].stock).toBe(8);
  expect((await db.doc(`${base}/doses/${key.date}_morning`).get()).data()?.evidence).toHaveLength(2);
});

test('real prescription confirmation is idempotent and does not replace existing stock', async () => {
  await db.doc(`${base}/prescriptions/rx`).set({ status: 'draft', extractedLines: [{ lineId: 'line' }] });
  const data = { familyId, memberId, prescriptionId: 'rx', lines: [{ lineId: 'line', accepted: true,
    medicine: 'New entered medicine', strength: '5 mg', dose: '1 tablet', frequency: '1-0-0', food: 'after',
    duration: '30 days', medicineId: 'new-medicine', count: 1, stock: 20, slots: [{ slot: 'morning', time: '08:00' }] }] };
  const request = { auth: { uid, token: {} }, data } as any;
  await confirmPrescription.run(request);
  await confirmPrescription.run(request);
  const schedule = (await db.doc(`${base}/schedule/morning`).get()).data()!;
  expect(schedule.medicines).toHaveLength(2);
  expect(schedule.medicines.find((medicine: any) => medicine.id === 'shared-medicine').stock).toBe(10);
  expect(schedule.medicines.find((medicine: any) => medicine.id === 'new-medicine').stock).toBe(20);
});

test('an assigned nurse cannot confirm a prescription through the real authorization path', async () => {
  await db.doc(`families/${familyId}/access/nurse`).set({ active: true, roles: ['nurse'], memberIds: [memberId] });
  await expect(confirmPrescription.run({ auth: { uid: 'nurse', token: {} }, data: {
    familyId, memberId, prescriptionId: 'rx', lines: [{ lineId: 'line', accepted: false }],
  } } as any)).rejects.toMatchObject({ code: 'permission-denied' });
});

test('real FL transactions wait for five clients and publish only once under concurrent aggregation', async () => {
  const model = JSON.parse(readFileSync('../../ml/out/initial_model.json', 'utf8'));
  await db.doc('flModels/latest').set({ ...model, round: 0 });
  const secret = 'test-only-emulator-secret-at-least-32-bytes';
  for (let index = 1; index <= 4; index++) await submitSimulatedUpdate(db, `synthetic-${index}`, {
    modelVersion: model.version, delta: Array(11).fill(index * 0.01), n: index,
  }, secret);
  expect(await aggregateRound(db, 1)).toMatchObject({ aggregated: false, clients: 4, requiredClients: 5 });
  await submitSimulatedUpdate(db, 'synthetic-5', { modelVersion: model.version, delta: Array(11).fill(0.05), n: 5 }, secret);
  const results = await Promise.all([aggregateRound(db, 1), aggregateRound(db, 1)]);
  expect(results.filter(result => result.aggregated)).toHaveLength(1);
  const latest = (await db.doc('flModels/latest').get()).data()!;
  expect(latest).toMatchObject({ round: 1, clients: 5, simulatedClients: 5 });
  expect(latest.weights[0]).toBeCloseTo(model.weights[0] + 0.55 / 15);
});
