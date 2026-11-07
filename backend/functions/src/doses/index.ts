import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { assertCurrentAccess, decideDose, doseProjection, logDoseSchema, memberPath, synchronizeStock, type Actor, type LogDoseInput, type Member, type Schedule } from './core';
import { readDose, storedDose } from './storage';
import { answerFromFacts, buildFactPack } from '../replies/core';

export * from './core';

/** actor comes from verified auth/device context, never from request.data.by. */
export async function logDose(db: Firestore, raw: LogDoseInput, actor: Actor) {
  const input = logDoseSchema.parse(raw);
  const base = memberPath(input);
  const key = `${input.date}_${input.slot}`;
  const at = new Date().toISOString();
  return db.runTransaction(async tx => {
    const [memberSnap, sharingSnap, schedulesSnap, doseSnap] = await Promise.all([
      tx.get(db.doc(base)), tx.get(db.doc(`${base}/settings/sharing`)), tx.get(db.collection(`${base}/schedule`)),
      tx.get(db.doc(`${base}/doses/${key}`)),
    ]);
    const accessSnap = await tx.get(db.collection(`families/${input.familyId}/access`));
    const schedules = Object.fromEntries(schedulesSnap.docs.map(doc => [doc.id, doc.data() as Schedule]));
    const schedule = schedules[input.slot];
    if (!memberSnap.exists || !schedule) throw new Error('Member or confirmed schedule not found');
    const member = { ...memberSnap.data(), sharing: sharingSnap.data() } as Member;
    assertCurrentAccess(member, input, actor, accessSnap.docs.find(doc => doc.id === actor.uid)?.data());
    const viewers = accessSnap.docs.filter(doc => {
      const access = doc.data();
      return access.active === true && access.memberIds?.includes(input.memberId) &&
        (member.ownerUid === doc.id || member.sharing?.guardianId === doc.id ||
          access.roles?.some((role: string) => ['leadSupporter', 'supporter'].includes(role)) ||
          (access.roles?.includes('nurse') && member.nurseIds?.includes(doc.id)));
    });
    if (actor.role !== 'device' && !viewers.some(doc => doc.id === actor.uid)) throw new Error('Permission denied: membership changed');
    if (viewers.length > 150) throw new Error('Too many viewers for an atomic dose update');
    const decision = decideDose(schedule, input, actor, at, readDose(doseSnap.data()));
    const stockChanges = decision.result === 'duplicate_blocked' ? {} : synchronizeStock(schedules, input.slot, decision.medicines, decision.dose.medicinesTaken);
    if (decision.result === 'duplicate_blocked') {
      tx.update(db.doc(`${base}/doses/${key}`), { evidence: storedDose(decision.dose).evidence });
      tx.set(db.doc(`alerts/double_${input.familyId}_${input.memberId}_${key}`), {
        familyId: input.familyId, memberId: input.memberId, type: 'double',
        rule: 'An already recorded dose was submitted again; no stock was changed.', at: Timestamp.fromDate(new Date(at)),
      });
    } else {
      tx.set(db.doc(`${base}/doses/${key}`), { ...storedDose(decision.dose), date: input.date, slot: input.slot });
      for (const [slot, changed] of Object.entries(stockChanges)) {
        tx.update(db.doc(`${base}/schedule/${slot}`), { medicines: changed.medicines });
      }
      if (decision.result === 'partial') tx.set(db.doc(`alerts/partial_${input.familyId}_${input.memberId}_${key}`), {
        familyId: input.familyId, memberId: input.memberId, type: 'partial',
        rule: 'The recorded count is below the confirmed schedule count.', at: Timestamp.fromDate(new Date(at)),
      });
    }
    for (const viewer of viewers) {
      const viewBase = `families/${input.familyId}/views/${viewer.id}/members/${input.memberId}`;
      const memberData = memberSnap.data()!;
      tx.set(db.doc(viewBase), { name: memberData.name ?? '', mode: memberData.mode ?? 'assisted' });
      tx.set(db.doc(`${viewBase}/doses/${key}`), doseProjection(input, decision.dose, member, viewer.id));
      if (decision.result === 'duplicate_blocked' || decision.result === 'partial') {
        const type = decision.result === 'partial' ? 'partial' : 'double';
        tx.set(db.doc(`${viewBase}/alerts/${type}_${key}`), { type,
          rule: type === 'double' ? 'An already recorded dose was submitted again.' : 'Only part of this dose was recorded.',
          date: input.date, slot: input.slot, at: Timestamp.fromDate(new Date(at)) });
      }
    }
    const answer = await answerFromFacts(buildFactPack(input, member, actor, decision.dose));
    return { result: decision.result, status: decision.dose.status, doseId: key,
      reply: { templateId: decision.result === 'duplicate_blocked' ? 'duplicate_blocked' : decision.dose.status,
        vars: {}, textEn: answer.textEn, textMl: answer.textMl } };
  });
}
