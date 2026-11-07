import { createHmac, createHash } from 'node:crypto';
import { FieldValue, type Firestore, type Transaction, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

const id = z.string().min(1).max(128).refine(value => !value.includes('/') && value !== '.' && value !== '..');
const updateSchema = z.object({
  modelVersion: id,
  delta: z.array(z.number().finite()).length(11),
  n: z.number().int().min(1).max(10000),
}).strict();
const submitSchema = updateSchema.extend({ deviceId: id }).strict();
const featureNames = ['slot', 'weekend', 'nurseOnShift', 'missRate7d', 'responseDelay', 'snoozes7d', 'repeatedQuestions7d', 'daysSinceDose', 'lowStock', 'unknowns7d'];
const K = 5;
// Bound transaction reads and training influence per round; this is not formal DP or secure aggregation.
const MAX_CLIENTS = 100;

function invalid(message: string): never { throw new HttpsError('invalid-argument', message); }
function denied(): never { throw new HttpsError('permission-denied', 'Device is not eligible for FL.'); }
function update(value: unknown) {
  const parsed = updateSchema.safeParse(value);
  if (!parsed.success) return invalid('Expected 11 finite deltas, modelVersion, and n in 1..10000.');
  const clipNorm = Math.hypot(...parsed.data.delta);
  if (clipNorm > 1 + 1e-6) return invalid('Final delta norm exceeds 1.');
  return { ...parsed.data, clipNorm };
}
function model(value: DocumentData | undefined) {
  if (!value || !id.safeParse(value.version).success || value.version === 'latest' ||
      !Number.isSafeInteger(value.round) || value.round < 0 || value.round >= Number.MAX_SAFE_INTEGER ||
      !Array.isArray(value.weights) || value.weights.length !== 11 || !value.weights.every(Number.isFinite) ||
      JSON.stringify(value.featureNames) !== JSON.stringify(featureNames) ||
      !Array.isArray(value.featureMeans) || value.featureMeans.length !== 10 ||
      !value.featureMeans.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new HttpsError('failed-precondition', 'No valid current model.');
  }
  return value as DocumentData & { version: string; round: number; weights: number[] };
}
function pseudonym(secret: string, round: number, kind: string, client: string) {
  if (Buffer.byteLength(secret) < 32) throw new HttpsError('failed-precondition', 'FL secret must have at least 32 bytes.');
  return createHmac('sha256', secret).update(JSON.stringify([round, kind, client])).digest('hex');
}

async function eligible(db: Firestore, tx: Transaction, uid: string, deviceId: string) {
  const device = (await tx.get(db.doc(`devices/${deviceId}`))).data();
  if (!device || (device.ownerUid ?? device.registeredUid) !== uid ||
      (device.ownerUid !== undefined && device.ownerUid !== uid) ||
      (device.registeredUid !== undefined && device.registeredUid !== uid) ||
      device.active === false || device.revoked === true || device.revokedAt != null || device.tier !== 'T1' ||
      !id.safeParse(device.familyId).success || !Array.isArray(device.memberIds) ||
      !device.memberIds.length || device.memberIds.length > 20 ||
      new Set(device.memberIds).size !== device.memberIds.length || !device.memberIds.every((v: unknown) => id.safeParse(v).success)) return denied();
  const access = (await tx.get(db.doc(`families/${device.familyId}/access/${uid}`))).data();
  if (access?.active !== true || !Array.isArray(access.memberIds)) return denied();
  for (const memberId of device.memberIds) {
    const member = (await tx.get(db.doc(`families/${device.familyId}/members/${memberId}`))).data();
    if (!access.memberIds.includes(memberId) || !member || member.tier !== 'T1' || member.consent?.fl !== true ||
        !Array.isArray(member.deviceIds) || !member.deviceIds.includes(deviceId)) return denied();
  }
}

/** Auth UID is supplied only by the callable, never from request data. */
export async function submitUpdate(db: Firestore, uid: string, data: unknown, secret: string) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (!data || typeof data !== 'object' || !Array.isArray((data as DocumentData).delta) || (data as DocumentData).delta.length !== 11) {
    return invalid('Expected exactly 11 deltas.');
  }
  const parsed = submitSchema.safeParse(data);
  if (!parsed.success) return invalid('Invalid FL payload; only deviceId, modelVersion, delta and n are accepted.');
  const { deviceId, ...values } = parsed.data;
  const value = update(values);
  return db.runTransaction(async tx => {
    await eligible(db, tx, uid, deviceId);
    const base = model((await tx.get(db.doc('flModels/latest'))).data());
    if (base.version !== value.modelVersion) throw new HttpsError('failed-precondition', 'Model version is stale.');
    const round = base.round + 1;
    const anonId = pseudonym(secret, round, 'device', deviceId);
    await storeUpdate(db, tx, round, anonId, value, { uid, deviceId }, base.version, `device:${deviceId}`);
    return { accepted: true, round };
  });
}

async function storeUpdate(db: Firestore, tx: Transaction, round: number, anonId: string,
  value: ReturnType<typeof update>, binding: DocumentData, baseVersion: string, identity: string) {
  const roundRef = db.doc(`flUpdates/${round}`);
  const clientRef = roundRef.collection('clients').doc(anonId);
  const state = (await tx.get(roundRef)).data();
  const duplicate = await tx.get(clientRef);
  // Private stable deduplication also survives Secret Manager key rotation mid-round.
  const seenRef = db.doc(`flRoundBindings/${round}/seen/${createHash('sha256').update(identity).digest('hex')}`);
  const seen = await tx.get(seenRef);
  if (duplicate.exists || seen.exists) throw new HttpsError('already-exists', 'Device already submitted in this round.');
  if (state && (state.aggregated || state.baseVersion !== baseVersion)) throw new HttpsError('failed-precondition', 'Round is closed.');
  if ((state?.clients ?? 0) >= MAX_CLIENTS) throw new HttpsError('resource-exhausted', 'Round is full.');
  tx.create(clientRef, { ...value, at: FieldValue.serverTimestamp() });
  // Private server-only provenance permits consent/device revocation checks without identifying update documents.
  tx.create(db.doc(`flRoundBindings/${round}/clients/${anonId}`), binding);
  tx.create(seenRef, { submitted: true });
  tx.set(roundRef, { baseVersion, clients: (state?.clients ?? 0) + 1, aggregated: false });
}

/** Trusted Admin SDK tooling ONLY. Synthetic clients are explicitly labelled, never a public count override. */
export async function submitSimulatedUpdate(db: Firestore, clientKey: string, data: unknown, secret: string) {
  if (!id.safeParse(clientKey).success) return invalid('Invalid synthetic client key.');
  const value = update(data);
  return db.runTransaction(async tx => {
    const base = model((await tx.get(db.doc('flModels/latest'))).data());
    if (value.modelVersion !== base.version) throw new HttpsError('failed-precondition', 'Model version is stale.');
    const round = base.round + 1;
    await storeUpdate(db, tx, round, pseudonym(secret, round, 'simulated', clientKey), value, { simulated: true }, base.version, `simulated:${clientKey}`);
    return { accepted: true, round, simulated: true };
  });
}

/** Scheduled/trusted admin core; Firestore retries serialize concurrent submissions and aggregators. */
export async function aggregateRound(db: Firestore, round: number) {
  if (!Number.isSafeInteger(round) || round < 1) return invalid('Invalid round.');
  return db.runTransaction(async tx => {
    const roundRef = db.doc(`flUpdates/${round}`);
    const state = (await tx.get(roundRef)).data();
    if (state?.aggregated) return { aggregated: false, clients: state.acceptedClients, modelVersion: state.modelVersion };
    const base = model((await tx.get(db.doc('flModels/latest'))).data());
    if (round !== base.round + 1 || (state && state.baseVersion !== base.version)) {
      throw new HttpsError('failed-precondition', 'Round base version is no longer current.');
    }
    const clients = await tx.get(roundRef.collection('clients').limit(MAX_CLIENTS + 1));
    if (clients.size > MAX_CLIENTS) throw new HttpsError('resource-exhausted', 'Round is too large.');
    const accepted: ReturnType<typeof update>[] = [];
    let simulatedClients = 0;
    for (const client of clients.docs) {
      const value = update({ modelVersion: client.data().modelVersion, delta: client.data().delta, n: client.data().n });
      if (value.modelVersion !== base.version) throw new HttpsError('failed-precondition', 'Mixed model versions in round.');
      const binding = (await tx.get(db.doc(`flRoundBindings/${round}/clients/${client.id}`))).data();
      if (binding?.simulated === true) simulatedClients++;
      else {
        if (!binding || typeof binding.uid !== 'string' || !id.safeParse(binding.deviceId).success) continue;
        try { await eligible(db, tx, binding.uid, binding.deviceId); }
        catch (error) { if (error instanceof HttpsError && error.code === 'permission-denied') continue; throw error; }
      }
      accepted.push(value);
    }
    if (accepted.length < K) return { aggregated: false, clients: accepted.length, requiredClients: K };
    const totalN = accepted.reduce((sum, client) => sum + client.n, 0);
    const weights = base.weights.map((weight, i) => weight + accepted.reduce((sum, client) => sum + client.n * client.delta[i], 0) / totalN);
    if (!weights.every(Number.isFinite)) throw new HttpsError('failed-precondition', 'Invalid aggregated model.');
    // Base versions are opaque simulator strings, not numeric v0/v1 counters.
    const version = `fl-r${round}-${createHash('sha256').update(base.version).digest('hex').slice(0, 16)}`;
    const versionRef = db.doc(`flModels/${version}`);
    if ((await tx.get(versionRef)).exists) throw new HttpsError('already-exists', 'Model version already exists.');
    const published = { version, weights, featureNames: base.featureNames, featureMeans: base.featureMeans,
      round, clients: accepted.length, simulatedClients, createdAt: FieldValue.serverTimestamp() };
    tx.create(versionRef, published);
    tx.set(db.doc('flModels/latest'), published);
    tx.set(roundRef, { ...state, aggregated: true, acceptedClients: accepted.length, simulatedClients, modelVersion: version });
    return { aggregated: true, clients: accepted.length, simulatedClients, modelVersion: version };
  });
}
