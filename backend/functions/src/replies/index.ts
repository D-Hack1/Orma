import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { assertCurrentAccess, doseKeySchema, doseProjection, memberPath, type Actor, type Member, type Schedule } from '../doses/core';
import { readDose } from '../doses/storage';
import { answerFromFacts, buildFactPack, type Generator } from './core';

export * from './core';
export const askStatusSchema = doseKeySchema.extend({ question: z.string().max(2000).optional() });

/** Auth wrapper must resolve family membership before calling; no private answer documents are written. */
export async function askStatus(db: Firestore, raw: z.input<typeof askStatusSchema>, viewer: Actor, generator?: Generator) {
  const input = askStatusSchema.parse(raw);
  const base = memberPath(input);
  const pack = await db.runTransaction(async tx => {
    const [memberSnap, sharingSnap, doseSnap, accessSnap, scheduleSnap, familySnap] = await Promise.all([
      tx.get(db.doc(base)), tx.get(db.doc(`${base}/settings/sharing`)),
      tx.get(db.doc(`${base}/doses/${input.date}_${input.slot}`)),
      tx.get(db.doc(`families/${input.familyId}/access/${viewer.uid}`)),
      tx.get(db.doc(`${base}/schedule/${input.slot}`)), tx.get(db.doc(`families/${input.familyId}`)),
    ]);
    if (!memberSnap.exists) throw new Error('Member not found');
    const member = { ...memberSnap.data(), sharing: sharingSnap.data() } as Member;
    assertCurrentAccess(member, input, viewer, accessSnap.data());
    const dose = readDose(doseSnap.data());
    const facts = buildFactPack(input, member, viewer, dose, { schedule: scheduleSnap.data() as Schedule | undefined,
      timezone: member.timezone ?? familySnap.data()?.timezone ?? 'Asia/Kolkata' });
    const viewBase = `families/${input.familyId}/views/${viewer.uid}/members/${input.memberId}`;
    tx.set(db.doc(viewBase), { name: memberSnap.data()!.name ?? '', mode: memberSnap.data()!.mode ?? 'assisted' });
    tx.set(db.doc(`${viewBase}/doses/${input.date}_${input.slot}`), dose ?
      { ...doseProjection(input, dose, member, viewer.uid), status: facts.status } : { date: input.date, slot: input.slot, status: facts.status });
    if (facts.status === 'unknown') tx.set(db.doc(`${viewBase}/alerts/unknown_${input.date}_${input.slot}`), {
      type: 'unknown', rule: 'No reliable taken record is available. Check before taking another dose.',
      date: input.date, slot: input.slot, at: Timestamp.now(),
    });
    return facts;
  });
  const answer = await answerFromFacts(pack, generator, input.question);
  if (answer.status === 'unknown') await db.doc(`alerts/unknown_${input.familyId}_${input.memberId}_${input.date}_${input.slot}`).set({
    familyId: input.familyId, memberId: input.memberId, type: 'unknown',
    rule: 'No reliable taken record was available when dose status was requested.', at: Timestamp.now(),
  }, { merge: true });
  return { ...answer, factPackIds: pack.facts.map(fact => fact.id), sources: pack.facts };
}
