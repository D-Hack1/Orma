import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "./firebase";
import { requireAuth, resolveMemberAccess } from "./auth";

const optionalFlags = z.object({
  counts: z.boolean().optional(), messages: z.boolean().optional(), risk: z.boolean().optional(),
  askedTwice: z.boolean().optional(), nurseNotes: z.boolean().optional(),
}).strict();
const input = z.object({
  familyId: z.string(), memberId: z.string(),
  changes: optionalFlags.extend({ supporterId: z.string().optional() }).strict(),
}).strict();

export const setSharing = onCall({ region: "asia-south1", enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" }, async request => {
  const uid = requireAuth(request);
  const parsed = input.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid sharing changes.");
  const { familyId, memberId, changes } = parsed.data;
  const context = await resolveMemberAccess(uid, familyId, memberId);
  if (!context.isOwner && !context.isGuardian) throw new HttpsError("permission-denied", "Only the member or recorded guardian can change sharing.");
  const settings = context.memberRef.collection("settings").doc("sharing");
  const { supporterId, ...flags } = changes;
  if (supporterId !== undefined && (!supporterId.trim() || supporterId.includes("/") || supporterId.length > 128)) {
    throw new HttpsError("invalid-argument", "Invalid supporterId.");
  }
  await db.runTransaction(async transaction => {
    const [settingsDoc, accessDoc, memberDoc] = await transaction.getAll(settings, db.doc(`families/${familyId}/access/${uid}`), context.memberRef);
    const current = settingsDoc.data() ?? {};
    const access = accessDoc.data();
    if (!access?.active || !access.memberIds?.includes(memberId)) throw new HttpsError("permission-denied", "Membership has changed.");
    const stillOwner = memberDoc.data()?.ownerUid === uid;
    // Recheck guardian authority inside the transaction; clients cannot appoint guardians.
    if (!stillOwner && !(current.guardianId === uid && typeof current.capacityNote === "string" && current.capacityNote.trim())) {
      throw new HttpsError("permission-denied", "Guardian authority has changed.");
    }
    const patch = supporterId
      ? { perSupporter: { ...current.perSupporter, [supporterId]: { ...current.perSupporter?.[supporterId], ...flags } } }
      : flags;
    transaction.set(settings, { ...patch, doseStatus: true, version: (current.version ?? 0) + 1, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  // Rules already reject revoked optional data; remove stale derived content before returning.
  const viewers = await db.collection(`families/${familyId}/views`).get();
  const access = await db.collection(`families/${familyId}/access`).get();
  const ids = new Set([...viewers.docs, ...access.docs].map(doc => doc.id));
  for (const viewer of ids) {
    await db.recursiveDelete(db.doc(`families/${familyId}/views/${viewer}/members/${memberId}`));
  }
  return { saved: true, sharing: (await settings.get()).data(), textMl: "നിങ്ങളുടെ പങ്കിടൽ ക്രമീകരണം മാറ്റി.", textEn: "Your sharing settings were updated." };
});
