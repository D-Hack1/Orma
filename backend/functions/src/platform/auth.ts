import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { DocumentData } from "firebase-admin/firestore";
import { db } from "./firebase";

export function requireAuth(request: Pick<CallableRequest, "auth">): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return request.auth.uid;
}

export function documentId(value: unknown, name: string): string {
  if (typeof value !== "string" || !value || value === "." || value === ".." || value.includes("/") || value.length > 128) {
    throw new HttpsError("invalid-argument", `Invalid ${name}.`);
  }
  return value;
}

export async function resolveMemberAccess(uid: string, familyId: string, memberId: string) {
  documentId(familyId, "familyId");
  documentId(memberId, "memberId");
  const memberRef = db.doc(`families/${familyId}/members/${memberId}`);
  const [accessDoc, memberDoc, sharingDoc] = await db.getAll(
    db.doc(`families/${familyId}/access/${uid}`), memberRef, memberRef.collection("settings").doc("sharing"),
  );
  const access = accessDoc.data() ?? {};
  const member = memberDoc.data() ?? {};
  const sharing = sharingDoc.data() ?? {};
  const active = access.active === true && Array.isArray(access.memberIds) && access.memberIds.includes(memberId);
  const roles: string[] = Array.isArray(access.roles) ? access.roles : [];
  const isOwner = active && member.ownerUid === uid;
  const isGuardian = active && sharing.guardianId === uid && typeof sharing.capacityNote === "string" && sharing.capacityNote.trim().length > 0;
  const isNurse = active && roles.includes("nurse") && Array.isArray(member.nurseIds) && member.nurseIds.includes(uid);
  const isSupporter = active && roles.some(role => role === "leadSupporter" || role === "supporter");
  if (!memberDoc.exists || !(isOwner || isGuardian || isNurse || isSupporter)) {
    throw new HttpsError("permission-denied", "Member access is not allowed.");
  }
  return { uid, familyId, memberId, memberRef, member, access, sharing, isOwner, isGuardian, isNurse, isSupporter };
}

export type MemberAccess = Awaited<ReturnType<typeof resolveMemberAccess>>;
export type SharingField = "counts" | "messages" | "risk" | "askedTwice" | "nurseNotes";

export function sharingAllowed(context: MemberAccess, field: SharingField): boolean {
  if (context.isOwner) return true;
  const overrides: DocumentData = context.sharing.perSupporter?.[context.uid] ?? {};
  return (overrides[field] ?? context.sharing[field]) === true;
}
