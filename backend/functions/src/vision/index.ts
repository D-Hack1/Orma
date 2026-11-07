import { createHash } from 'node:crypto';
import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../platform/firebase';
import { requireAuth, resolveMemberAccess, sharingAllowed, type MemberAccess } from '../platform/auth';
import { readAuthorizedMedia } from '../platform/media';
import { confirmSchema, extract, imageInputSchema, matchStrip, pillboxInputSchema, pillboxSchema,
  stripSchema, validateExtraction, type ConfirmInput, type VisionTask } from './core';
import { geminiVisionProvider } from './provider';
import { geminiSecrets } from '../platform/genai';

const options = { region: 'asia-south1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true', timeoutSeconds: 60, secrets: geminiSecrets };
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpsError('invalid-argument', 'Invalid vision request.');
  return result.data;
}
type Operation = 'draft' | 'confirm' | 'observe';
function authorize(context: MemberAccess, operation: Operation = 'draft') {
  if (context.isSupporter && !context.isOwner && !sharingAllowed(context, 'counts')) {
    throw new HttpsError('permission-denied', 'Medicine details are not shared.');
  }
  const independentOwner = context.isOwner && context.member.mode === 'independent';
  if (operation === 'confirm' ? context.isNurse || !(context.isSupporter || independentOwner) :
    !(context.isNurse || context.isSupporter || (operation === 'observe' ? context.isOwner : independentOwner))) {
    throw new HttpsError('permission-denied', operation === 'confirm' ? 'Schedule confirmation is not allowed.' : 'Image access is not allowed.');
  }
}

// Re-read authorization within each write transaction so a concurrent revocation wins.
async function transactionAccess(tx: Transaction, context: MemberAccess, operation: Operation = 'draft') {
  const [memberDoc, accessDoc, sharingDoc] = await Promise.all([
    tx.get(context.memberRef), tx.get(db.doc(`families/${context.familyId}/access/${context.uid}`)),
    tx.get(context.memberRef.collection('settings').doc('sharing')),
  ]);
  const member = memberDoc.data() ?? {}, access = accessDoc.data() ?? {}, sharing = sharingDoc.data() ?? {};
  if (!memberDoc.exists || access.active !== true || !access.memberIds?.includes(context.memberId)) {
    throw new HttpsError('permission-denied', 'Member access is no longer allowed.');
  }
  const fresh = { ...context, member, access, sharing, isOwner: member.ownerUid === context.uid,
    isNurse: access.roles?.includes('nurse') === true && member.nurseIds?.includes(context.uid) === true,
    isSupporter: access.roles?.some((role: string) => ['leadSupporter', 'supporter'].includes(role)) === true };
  authorize(fresh, operation);
  return fresh;
}
async function contextFor(request: CallableRequest, input: { familyId: string; memberId: string }, operation: Operation = 'draft') {
  const context = await resolveMemberAccess(requireAuth(request), input.familyId, input.memberId);
  authorize(context, operation);
  return context;
}
async function readImage(context: MemberAccess, photoUrl: string, task: VisionTask) {
  try {
    const image = await readAuthorizedMedia(context, photoUrl, 'image');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType) || !image.bytes.length || image.bytes.length > 10 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Unsupported image.');
    }
    return await extract(geminiVisionProvider, task, image);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unavailable', 'Image reading is unavailable. Please try again.');
  }
}

export const parsePrescription = onCall(options, async request => {
  requireAuth(request);
  const input = parse(imageInputSchema, request.data);
  const context = await contextFor(request, input);
  let lines: ReturnType<typeof validateExtraction>;
  try { lines = validateExtraction(await readImage(context, input.photoUrl, 'prescription')); }
  catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unavailable', 'The prescription could not be read safely.');
  }
  const ref = context.memberRef.collection('prescriptions').doc();
  await db.runTransaction(async tx => {
    await transactionAccess(tx, context);
    tx.create(ref, { photoUrl: input.photoUrl, extractedLines: lines, status: 'draft', createdBy: context.uid, createdAt: Timestamp.now() });
  });
  return { prescriptionId: ref.id, lines };
});

function confirmationHash(input: ConfirmInput) {
  const lines = input.lines.map(line => line.accepted ? { ...line, slots: [...line.slots].sort((a, b) => a.slot.localeCompare(b.slot)) } : line)
    .sort((a, b) => a.lineId.localeCompare(b.lineId));
  return createHash('sha256').update(JSON.stringify(lines)).digest('hex');
}

export const confirmPrescription = onCall(options, async request => {
  requireAuth(request);
  const input = parse(confirmSchema, request.data);
  const context = await contextFor(request, input, 'confirm');
  const prescriptionRef = context.memberRef.collection('prescriptions').doc(input.prescriptionId);
  const hash = confirmationHash(input);
  return db.runTransaction(async tx => {
    const fresh = await transactionAccess(tx, context, 'confirm');
    const [draftDoc, schedules, viewers] = await Promise.all([tx.get(prescriptionRef),
      tx.get(context.memberRef.collection('schedule')), tx.get(db.collection(`families/${input.familyId}/access`))]);
    if (!draftDoc.exists) throw new HttpsError('not-found', 'Prescription draft not found.');
    const draft = draftDoc.data()!;
    if (draft.status === 'confirmed') {
      if (draft.confirmationHash !== hash) throw new HttpsError('failed-precondition', 'This prescription was already confirmed differently.');
      return { prescriptionId: input.prescriptionId, status: 'confirmed', scheduleSlots: draft.scheduleSlots };
    }
    if (draft.status !== 'draft' || !Array.isArray(draft.extractedLines)) throw new HttpsError('failed-precondition', 'Invalid prescription draft.');
    const ids = draft.extractedLines.map((line: { lineId: string }) => line.lineId);
    if (input.lines.length !== ids.length || new Set(ids).size !== ids.length ||
      new Set(input.lines.map(line => line.lineId)).size !== ids.length || input.lines.some(line => !ids.includes(line.lineId))) {
      throw new HttpsError('invalid-argument', 'Accept or reject every draft line exactly once.');
    }
    const accepted = input.lines.filter(line => line.accepted);
    if (new Set(accepted.map(line => line.medicineId)).size !== accepted.length) throw new HttpsError('invalid-argument', 'Duplicate medicine ID.');
    const existingIds = new Set(schedules.docs.flatMap(doc => (doc.data().medicines ?? []).map((m: { id: string }) => m.id)));
    const updates = new Map<string, { slot: string; time: string; afterFood: boolean; food: string; medicines: Record<string, unknown>[] }>();
    for (const line of accepted) {
      if (existingIds.has(line.medicineId)) throw new HttpsError('failed-precondition', 'Medicine already exists; resolve it without replacing stock.');
      const quantities = line.frequency.split('-').map(Number);
      const slotNames = ['morning', 'noon', 'night'];
      if (new Set(line.slots.map(slot => slot.slot)).size !== line.slots.length ||
        quantities.some((count, i) => count !== (line.slots.some(slot => slot.slot === slotNames[i]) ? line.count : 0))) {
        throw new HttpsError('invalid-argument', 'Frequency, slots and count must agree.');
      }
      for (const slot of line.slots) {
        const existing = updates.get(slot.slot) ?? schedules.docs.find(doc => doc.id === slot.slot)?.data();
        if (existing && (existing.time !== slot.time || (existing.food ?? (existing.afterFood ? 'after' : 'any')) !== line.food)) {
          throw new HttpsError('failed-precondition', 'Existing slot timing/food conflicts; human resolution is required.');
        }
        updates.set(slot.slot, { ...(existing ?? {}), slot: slot.slot, time: slot.time, afterFood: line.food === 'after', food: line.food,
          medicines: [...(existing?.medicines ?? []), { id: line.medicineId, name: line.medicine, strength: line.strength,
            dose: line.dose, count: line.count, stock: line.stock, food: line.food, duration: line.duration, prescriptionId: input.prescriptionId }] });
      }
    }
    if (viewers.docs.length > 150) throw new HttpsError('resource-exhausted', 'Too many schedule viewers.');
    for (const [slot, schedule] of updates) {
      tx.set(context.memberRef.collection('schedule').doc(slot), schedule);
      for (const viewer of viewers.docs) {
        const access = viewer.data();
        const permitted = access.active === true && access.memberIds?.includes(input.memberId) &&
          (fresh.member.ownerUid === viewer.id || access.roles?.some((role: string) => ['leadSupporter', 'supporter'].includes(role)) ||
            (access.roles?.includes('nurse') && fresh.member.nurseIds?.includes(viewer.id)));
        const counts = fresh.member.ownerUid === viewer.id || (fresh.sharing.perSupporter?.[viewer.id]?.counts ?? fresh.sharing.counts) === true;
        if (permitted && counts) tx.set(db.doc(`families/${input.familyId}/views/${viewer.id}/members/${input.memberId}/schedule/${slot}`), schedule);
      }
    }
    const scheduleSlots = [...updates.keys()].sort();
    tx.update(prescriptionRef, { status: 'confirmed', confirmedBy: context.uid, confirmedAt: Timestamp.now(),
      confirmedLines: input.lines, confirmationHash: hash, scheduleSlots });
    return { prescriptionId: input.prescriptionId, status: 'confirmed', scheduleSlots };
  });
});

export const checkStrip = onCall(options, async request => {
  requireAuth(request);
  const input = parse(imageInputSchema, request.data);
  const context = await contextFor(request, input, 'observe');
  const read = stripSchema.safeParse(await readImage(context, input.photoUrl, 'strip'));
  if (!read.success) throw new HttpsError('unavailable', 'The strip could not be read safely.');
  // Read the list under the same authorization snapshot; a concurrent revocation retries/denies.
  const medicines = await db.runTransaction(async tx => {
    await transactionAccess(tx, context, 'observe');
    const schedules = await tx.get(context.memberRef.collection('schedule'));
    return schedules.docs.flatMap(doc => doc.data().medicines ?? []);
  });
  const match = matchStrip(read.data, medicines);
  const textEn = match ? `This matches ${match.name} on your confirmed list.` : 'This does not clearly match a medicine on your confirmed list. Ask your pharmacist.';
  const textMl = match ? `ഇത് നിങ്ങളുടെ സ്ഥിരീകരിച്ച പട്ടികയിലെ ${match.name}-യുമായി പൊരുത്തപ്പെടുന്നു.` : 'ഇത് നിങ്ങളുടെ സ്ഥിരീകരിച്ച പട്ടികയുമായി വ്യക്തമായി പൊരുത്തപ്പെടുന്നില്ല. ഫാർമസിസ്റ്റിനോട് ചോദിക്കുക.';
  return { ...read.data, matchedMedicineId: match?.id ?? null,
    sentences: match ? [{ text: textEn, cites: ['S1'] }] : [], textEn, textMl };
});

export const checkPillbox = onCall(options, async request => {
  requireAuth(request);
  const input = parse(pillboxInputSchema, request.data);
  const context = await contextFor(request, input, 'observe');
  const family = await db.doc(`families/${input.familyId}`).get();
  let today: string;
  try { today = new Intl.DateTimeFormat('en-CA', { timeZone: context.member.timezone ?? family.data()?.timezone ?? 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { throw new HttpsError('failed-precondition', 'Member timezone is invalid.'); }
  if (input.date !== today) throw new HttpsError('invalid-argument', 'Use the current member-local date.');
  const observed = pillboxSchema.safeParse(await readImage(context, input.photoUrl, 'pillbox'));
  if (!observed.success) throw new HttpsError('unavailable', 'The compartment could not be read safely.');
  const { slotEmpty } = observed.data;
  const status = await db.runTransaction(async tx => {
    await transactionAccess(tx, context, 'observe');
    const ref = context.memberRef.collection('doses').doc(`${input.date}_${input.slot}`);
    const doseDoc = await tx.get(ref);
    const dose = doseDoc.data();
    const existingReport = dose && ['confirmed', 'reported', 'partial'].includes(dose.status) && dose.source !== 'photo';
    if (existingReport) {
      const evidence = dose.evidence ?? [];
      // The same authorized upload retried for this dose adds evidence once, never stock/logs.
      if (!evidence.some((e: { type: string; photoUrl?: string }) => e.type === 'photo' && e.photoUrl === input.photoUrl)) {
        tx.update(ref, { evidence: [...evidence, { type: 'photo', by: context.uid, at: Timestamp.now(), photoUrl: input.photoUrl,
          slotEmpty, observationOnly: true }] });
      }
    }
    return dose?.status ?? 'unknown';
  });
  return { slotEmpty, status, photoObserved: true,
    textEn: slotEmpty === true ? 'The compartment appears empty. This does not prove the medicine was swallowed.' :
      slotEmpty === false ? 'The compartment appears nonempty. This does not establish whether medicine was taken.' : 'The compartment is unclear. This does not establish whether medicine was taken.',
    textMl: slotEmpty === true ? 'ഫോട്ടോയിൽ ഈ ഭാഗം ഒഴിഞ്ഞതായി തോന്നുന്നു. മരുന്ന് കഴിച്ചതിന്റെ ഉറപ്പല്ല ഇത്.' :
      slotEmpty === false ? 'ഫോട്ടോയിൽ ഈ ഭാഗം ഒഴിഞ്ഞതായി തോന്നുന്നില്ല. മരുന്ന് കഴിച്ചോ എന്ന് ഇതുകൊണ്ട് ഉറപ്പിക്കാനാവില്ല.' : 'ഫോട്ടോയിൽ ഈ ഭാഗം വ്യക്തമല്ല. മരുന്ന് കഴിച്ചോ എന്ന് ഇതുകൊണ്ട് ഉറപ്പിക്കാനാവില്ല.' };
});
