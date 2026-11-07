import { createHash, randomBytes } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from './firebase';
import { documentId, requireAuth, resolveMemberAccess, sharingAllowed } from './auth';

const text = z.string().trim().min(1).max(100);
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/).or(z.literal('')).default('');
const mode = z.enum(['assisted', 'independent', 'keypad']);
const language = z.enum(['en', 'ml']);
const slots = z.enum(['morning', 'noon', 'night']);
const options = { region: 'asia-south1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' };
const sharingDefaults = { doseStatus: true, counts: false, messages: false, risk: false, askedTwice: false, nurseNotes: false, perSupporter: {}, version: 0 };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const familyProfileSchema = z.strictObject({ name: text, phone, language: language.default('en') });
export const scheduleInputSchema = z.strictObject({
  familyId: text, memberId: text, slot: slots, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), afterFood: z.boolean(),
  medicines: z.array(z.strictObject({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), name: text,
    strength: z.string().trim().max(100).default(''), dose: z.string().trim().max(100).default(''),
    count: z.number().int().min(1).max(20), stock: z.number().int().min(0).max(10000),
    purpose: z.string().trim().max(300).default(''), timeCritical: z.boolean().default(false),
  })).min(1).max(12),
}).superRefine((value, ctx) => {
  if (new Set(value.medicines.map(m => m.id)).size !== value.medicines.length) ctx.addIssue({ code: 'custom', message: 'Medicine IDs must be unique.' });
  if (value.medicines.reduce((n, m) => n + m.count, 0) > 99) ctx.addIssue({ code: 'custom', message: 'Too many tablets.' });
});

async function activeAccess(uid: string, familyId: string) {
  documentId(familyId, 'familyId');
  const ref = db.doc(`families/${familyId}/access/${uid}`);
  const data = (await ref.get()).data();
  if (!data?.active) throw new HttpsError('permission-denied', 'Family access is not active.');
  return data;
}
async function lead(uid: string, familyId: string) {
  const data = await activeAccess(uid, familyId);
  if (!data.roles?.includes('leadSupporter')) throw new HttpsError('permission-denied', 'The family lead must do this.');
  return data;
}
function callable(handler: (uid: string, data: any) => Promise<unknown>) {
  return onCall(options, async request => {
    const uid = requireAuth(request);
    try { return await handler(uid, request.data); }
    catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof z.ZodError) throw new HttpsError('invalid-argument', 'Check the setup fields.');
      throw new HttpsError('failed-precondition', 'Setup could not be completed. Please try again.');
    }
  });
}

export const saveProfile = callable(async (uid, raw) => {
  const profile = familyProfileSchema.parse(raw);
  await db.doc(`profiles/${uid}`).set({ ...profile, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await getAuth().updateUser(uid, { displayName: profile.name });
  return { saved: true };
});

export const createFamily = callable(async (uid, raw) => {
  const input = z.strictObject({ name: text, independent: z.boolean().default(false) }).parse(raw);
  const ref = db.collection('families').doc();
  const profile = (await db.doc(`profiles/${uid}`).get()).data();
  if (!profile) throw new HttpsError('failed-precondition', 'Set up your name first.');
  const ownMember = input.independent ? db.collection('_ids').doc().id : null;
  const batch = db.batch();
  batch.create(ref, { name: input.name, ownerId: uid, timezone: 'Asia/Kolkata', roster: [], createdAt: FieldValue.serverTimestamp() });
  batch.set(ref.collection('access').doc(uid), { active: true, roles: ['leadSupporter', ...(ownMember ? ['member'] : [])], memberIds: ownMember ? [ownMember] : [] });
  if (ownMember) {
    const member = ref.collection('members').doc(ownMember);
    batch.set(member, { name: profile.name, phone: profile.phone, language: profile.language, ownerUid: uid, mode: 'independent', roles: ['member'], tier: 'T1',
      nurseIds: [], deviceIds: [], consent: { calls: false, fl: false }, usualMealTimes: {}, relations: {} });
    batch.set(member.collection('settings').doc('sharing'), sharingDefaults);
  }
  batch.set(db.doc(`profiles/${uid}/families/${ref.id}`), { name: input.name, role: ownMember ? 'independent' : 'supporter' });
  await batch.commit();
  return { familyId: ref.id, memberId: ownMember };
});

export const addFamilyMember = callable(async (uid, raw) => {
  const input = z.strictObject({ familyId: text, name: text, mode: mode.default('assisted'), language: language.default('ml'),
    caregiverRelation: z.enum(['son', 'daughter', 'child', 'other']).default('child') }).parse(raw);
  await lead(uid, input.familyId);
  const members = db.collection(`families/${input.familyId}/members`);
  const existing = await members.limit(31).get();
  if (existing.size >= 30) throw new HttpsError('resource-exhausted', 'This family already has 30 members.');
  const member = members.doc();
  const supporters = await db.collection(`families/${input.familyId}/access`).where('active', '==', true).get();
  const batch = db.batch();
  batch.create(member, { name: input.name, mode: input.mode, language: input.language, roles: ['member'], tier: input.mode === 'keypad' ? 'T4' : 'T1',
    nurseIds: [], deviceIds: [], consent: { calls: false, fl: false }, usualMealTimes: {}, relations: { [uid]: input.caregiverRelation }, createdBy: uid });
  batch.set(member.collection('settings').doc('sharing'), sharingDefaults);
  for (const supporter of supporters.docs) if (supporter.data().roles?.some((r: string) => ['leadSupporter', 'supporter'].includes(r))) {
    batch.update(supporter.ref, { memberIds: FieldValue.arrayUnion(member.id) });
    batch.set(db.doc(`families/${input.familyId}/views/${supporter.id}/members/${member.id}`), { name: input.name, mode: input.mode });
  }
  await batch.commit();
  return { memberId: member.id };
});

export const inviteFamilyMember = callable(async (uid, raw) => {
  const input = z.strictObject({ familyId: text, memberId: text.optional(), role: z.enum(['member', 'supporter', 'nurse']),
    relation: z.enum(['son', 'daughter', 'child', 'other']).default('other') }).parse(raw);
  const access = await lead(uid, input.familyId);
  if (input.role === 'member' && !input.memberId) throw new HttpsError('invalid-argument', 'Choose the parent this invitation is for.');
  if (input.memberId && !access.memberIds?.includes(input.memberId)) throw new HttpsError('permission-denied', 'Member is not in your family.');
  const code = randomBytes(6).toString('hex').toUpperCase();
  await db.doc(`familyInvites/${hash(code)}`).create({ familyId: input.familyId, memberId: input.memberId ?? null, role: input.role,
    relation: input.relation, createdBy: uid, expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60_000), usedBy: null });
  return { code, expiresInHours: 24 };
});

export const joinFamily = callable(async (uid, raw) => {
  const input = z.strictObject({ code: z.string().trim().regex(/^[A-Fa-f0-9]{12}$/), shareMedicineDetails: z.boolean().default(false) }).parse(raw);
  const invitation = db.doc(`familyInvites/${hash(input.code.toUpperCase())}`);
  return db.runTransaction(async tx => {
    const invite = (await tx.get(invitation)).data();
    if (!invite || invite.expiresAt.toMillis() < Date.now() || (invite.usedBy && invite.usedBy !== uid)) throw new HttpsError('failed-precondition', 'Invitation is invalid, expired or already used.');
    const familyRef = db.doc(`families/${invite.familyId}`);
    const [family, profile, members, current] = await Promise.all([tx.get(familyRef), tx.get(db.doc(`profiles/${uid}`)),
      tx.get(familyRef.collection('members')), tx.get(familyRef.collection('access').doc(uid))]);
    if (!family.exists || !profile.exists) throw new HttpsError('failed-precondition', 'Complete your profile first.');
    if (invite.role === 'member') {
      const member = members.docs.find(d => d.id === invite.memberId);
      if (!member || (member.data().ownerUid && member.data().ownerUid !== uid)) throw new HttpsError('failed-precondition', 'This parent already has an account.');
      tx.update(member.ref, { ownerUid: uid, name: profile.data()!.name, phone: profile.data()!.phone, language: profile.data()!.language });
      if (input.shareMedicineDetails) tx.update(member.ref.collection('settings').doc('sharing'), { [`perSupporter.${invite.createdBy}.counts`]: true, version: FieldValue.increment(1) });
    } else if (invite.role === 'nurse') {
      if (!invite.memberId) throw new HttpsError('invalid-argument', 'Nurse invitation must identify the assigned member.');
      const member = members.docs.find(d => d.id === invite.memberId);
      if (!member) throw new HttpsError('not-found', 'Assigned member not found.');
      tx.update(member.ref, { nurseIds: FieldValue.arrayUnion(uid) });
    } else for (const member of members.docs) tx.update(member.ref, { [`relations.${uid}`]: invite.relation });
    const ids = invite.role === 'supporter' ? members.docs.map(d => d.id) : [invite.memberId];
    const roles = [...new Set([...(current.data()?.roles ?? []), invite.role])];
    tx.set(familyRef.collection('access').doc(uid), { active: true, roles, memberIds: [...new Set([...(current.data()?.memberIds ?? []), ...ids])] });
    tx.set(db.doc(`profiles/${uid}/families/${familyRef.id}`), { name: family.data()!.name, role: invite.role === 'member' ? 'assisted' : invite.role });
    tx.update(invitation, { usedBy: uid });
    return { familyId: familyRef.id, memberId: invite.memberId, role: invite.role };
  });
});

export const getFamily = callable(async (uid, raw) => {
  const { familyId } = z.strictObject({ familyId: text }).parse(raw);
  const access = await activeAccess(uid, familyId);
  const familyRef = db.doc(`families/${familyId}`);
  const [family, participants] = await Promise.all([familyRef.get(), familyRef.collection('access').where('active', '==', true).get()]);
  const members = await Promise.all((access.memberIds as string[]).map(async id => {
    const context = await resolveMemberAccess(uid, familyId, id);
    const pending = !context.member.ownerUid;
    const canManage = access.roles?.some((r: string) => ['leadSupporter', 'supporter'].includes(r)) && (pending || sharingAllowed(context, 'counts'))
      || context.isOwner && context.member.mode === 'independent';
    const visible = context.isOwner || canManage || sharingAllowed(context, 'counts');
    const schedule = visible ? (await context.memberRef.collection('schedule').get()).docs.map(d => ({ slot: d.id, ...d.data() })) : [];
    if (!context.isOwner) await db.doc(`families/${familyId}/views/${uid}/members/${id}`).set({ name: context.member.name, mode: context.member.mode });
    return { id, name: context.member.name, mode: context.member.mode, language: context.member.language, isOwner: context.isOwner,
      canManage: Boolean(canManage), awaitingAccount: pending, schedules: schedule,
      sharing: context.isOwner ? context.sharing : { counts: sharingAllowed(context, 'counts'), messages: sharingAllowed(context, 'messages'), risk: sharingAllowed(context, 'risk'), nurseNotes: sharingAllowed(context, 'nurseNotes') },
      relations: context.isOwner ? context.member.relations ?? {} : {} };
  }));
  const contacts = await Promise.all(participants.docs.map(async doc => {
    const profile = (await db.doc(`profiles/${doc.id}`).get()).data();
    const auth = profile ? undefined : await getAuth().getUser(doc.id).catch(() => undefined);
    return { uid: doc.id, name: profile?.name ?? auth?.displayName ?? doc.id, phone: profile?.phone ?? '', roles: doc.data().roles };
  }));
  return { familyId, name: family.data()?.name ?? '', timezone: family.data()?.timezone ?? 'Asia/Kolkata', uid,
    role: members.some(m => m.isOwner && m.mode === 'independent') ? 'independent' : access.roles?.includes('leadSupporter') || access.roles?.includes('supporter') ? 'supporter' : access.roles?.includes('nurse') ? 'nurse' : 'assisted', members, contacts };
});

export const listMyFamilies = callable(async uid => {
  const families = await db.collection(`profiles/${uid}/families`).get();
  return { families: families.docs.map(d => ({ familyId: d.id, ...d.data() })) };
});

export const updateMedicineSchedule = callable(async (uid, raw) => {
  const input = scheduleInputSchema.parse(raw);
  const context = await resolveMemberAccess(uid, input.familyId, input.memberId);
  const pending = !context.member.ownerUid;
  if (!(context.isSupporter && (pending || sharingAllowed(context, 'counts')) || context.isOwner && context.member.mode === 'independent')) {
    throw new HttpsError('permission-denied', 'The member must share medicine details with an authorized supporter to manage this schedule.');
  }
  return db.runTransaction(async tx => {
    const schedules = await tx.get(context.memberRef.collection('schedule'));
    const current = schedules.docs.find(d => d.id === input.slot);
    if (current && JSON.stringify(current.data().medicines.map((m: any) => m.id).sort()) !== JSON.stringify(input.medicines.map(m => m.id).sort())) {
      const doses = await tx.get(context.memberRef.collection('doses').where('date', '==', new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())));
      if (doses.docs.some(d => d.data().slot === input.slot && ['confirmed', 'reported', 'partial'].includes(d.data().status))) throw new HttpsError('failed-precondition', 'A dose is already recorded today. Review the change with your care team.');
    }
    for (const medicine of input.medicines) for (const other of schedules.docs.filter(d => d.id !== input.slot)) {
      const match = other.data().medicines?.find((m: any) => m.id === medicine.id);
      if (match && (match.stock !== medicine.stock || match.name !== medicine.name)) throw new HttpsError('failed-precondition', 'Shared medicine stock/name must agree across slots.');
    }
    tx.set(context.memberRef.collection('schedule').doc(input.slot), { slot: input.slot, time: input.time, afterFood: input.afterFood,
      medicines: input.medicines, confirmedBy: uid, confirmedAt: FieldValue.serverTimestamp() });
    return { saved: true, slot: input.slot };
  });
});

export const registerDevice = callable(async (uid, raw) => {
  const input = z.strictObject({ familyId: text, deviceId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/), memberIds: z.array(text).max(30), tier: z.enum(['T1', 'T2', 'T3']).default('T1') }).parse(raw);
  const access = await activeAccess(uid, input.familyId);
  if (input.memberIds.some(id => !access.memberIds.includes(id))) throw new HttpsError('permission-denied', 'Device cannot access those members.');
  const ref = db.doc(`devices/${input.deviceId}`);
  await db.runTransaction(async tx => {
    const existing = (await tx.get(ref)).data();
    if (existing?.uid && existing.uid !== uid) throw new HttpsError('permission-denied', 'Device belongs to another account.');
    tx.set(ref, { uid, ownerUid: uid, registeredUid: uid, active: true, familyId: input.familyId, memberIds: input.memberIds, tier: input.tier, capabilities: {}, updatedAt: FieldValue.serverTimestamp() });
    for (const id of input.memberIds) tx.update(db.doc(`families/${input.familyId}/members/${id}`), { deviceIds: FieldValue.arrayUnion(input.deviceId) });
  });
  return { registered: true };
});
