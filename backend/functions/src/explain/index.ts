import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { assertActor, doseKeySchema, hasFullAccess, memberPath, type Actor, type Member } from '../doses/core';
import { readDose } from '../doses/storage';
import { answerFromFacts, buildFactPack } from '../replies/core';

export const explainSchema = doseKeySchema.extend({ kind: z.enum(['status', 'alert', 'risk']).default('status'), alertId: z.string().regex(/^[\w-]+$/).optional() });

export async function explain(db: Firestore, raw: z.input<typeof explainSchema>, viewer: Actor) {
  const input = explainSchema.parse(raw);
  const base = memberPath(input);
  const memberSnap = await db.doc(base).get();
  if (!memberSnap.exists) throw new Error('Member not found');
  const sharingSnap = await db.doc(`${base}/settings/sharing`).get();
  const member = { ...memberSnap.data(), sharing: sharingSnap.data() } as Member;
  assertActor(member, input, viewer);
  if (input.kind === 'risk') {
    const full = hasFullAccess(member, input, viewer);
    const allowed = member.sharing?.perSupporter?.[viewer.uid]?.risk ?? member.sharing?.risk ?? false;
    if (!full && !allowed) throw new Error('Risk explanation is private');
    const risk = (await db.doc(`${base}/risk/${input.date}_${input.slot}`).get()).data();
    return {
      reasons: [{ text: risk ? 'This is a prediction, not evidence that a dose was taken or missed.' : 'No risk prediction is recorded.', cites: risk ? [`risk:${input.date}_${input.slot}`] : [] }],
      contributions: full ? risk?.contributions ?? [] : [], prediction: true,
      textEn: 'A risk prediction does not establish whether a dose was taken.',
      textMl: 'അപകടസാധ്യതയുടെ പ്രവചനം ഡോസ് കഴിച്ചോ എന്ന് തെളിയിക്കുന്നില്ല.',
    };
  }
  if (input.kind === 'alert') {
    if (!input.alertId) throw new Error('alertId is required');
    const alert = (await db.doc(`alerts/${input.alertId}`).get()).data();
    if (!alert || alert.familyId !== input.familyId || alert.memberId !== input.memberId) throw new Error('Alert not found');
    // Alert rules may contain private details; restricted viewers see only the category.
    const reason = hasFullAccess(member, input, viewer) ? String(alert.rule) : 'A dose safety rule raised this alert.';
    return { reasons: [{ text: reason, cites: [`alert:${input.alertId}`] }], textEn: reason, textMl: 'ഡോസ് സുരക്ഷാ നിയമം കാരണം അറിയിപ്പ് നൽകി.' };
  }
  const dose = readDose((await db.doc(`${base}/doses/${input.date}_${input.slot}`).get()).data());
  const pack = buildFactPack(input, member, viewer, dose);
  const answer = await answerFromFacts(pack);
  return { ...answer, reasons: pack.facts.map(fact => ({ text: fact.textEn, cites: fact.id.startsWith('lookup:') ? [] : [fact.id] })), sources: pack.facts };
}
