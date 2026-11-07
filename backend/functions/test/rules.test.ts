import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { documentId, requireAuth, sharingAllowed } from "../src/platform/auth";

let env: RulesTestEnvironment;
const base = "families/demo";
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-orma", firestore: { rules: readFileSync("../firestore.rules", "utf8") }, storage: { rules: readFileSync("../storage.rules", "utf8") } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const entries: Record<string, object> = {
      [`${base}/members/amma`]: { ownerUid: "amma", name: "Amma", phone: "private", nurseIds: ["mini"] },
      [`${base}/members/achan`]: { ownerUid: "achan", nurseIds: [] },
      [`${base}/members/amma/settings/sharing`]: { counts: false, messages: false, risk: false, nurseNotes: false, version: 1 },
      [`${base}/members/amma/doses/today_morning`]: { status: "confirmed", countTaken: 3, evidence: [{ snippet: "private" }] },
    };
    for (const [uid, roles] of [["amma", ["member"]], ["rahul", ["supporter"]], ["mini", ["nurse"]]] as const) {
      entries[`${base}/access/${uid}`] = { active: true, roles: [...roles], memberIds: ["amma", "achan"] };
      entries[`${base}/views/${uid}/members/amma`] = { name: "Amma", mode: "assisted" };
      entries[`${base}/views/${uid}/members/amma/doses/today_morning`] = { date: "2026-11-07", slot: "morning", status: "confirmed" };
    }
    entries[`${base}/views/mini/members/achan`] = { name: "Achan", mode: "assisted" };
    for (const [path, value] of Object.entries(entries)) await setDoc(doc(db, path), value);
  });
});
afterAll(async () => { await env?.cleanup(); });

test("owner reads canonical, supporters and nurse cannot read private whole documents", async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext("amma").firestore(), `${base}/members/amma/doses/today_morning`)));
  for (const uid of ["rahul", "mini"]) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, `${base}/members/amma`)));
    await assertFails(getDoc(doc(db, `${base}/members/amma/doses/today_morning`)));
    await assertSucceeds(getDoc(doc(db, `${base}/views/${uid}/members/amma/doses/today_morning`)));
  }
});
test("nurse needs assignment and active membership; viewer cannot read someone else's projection", async () => {
  const db = env.authenticatedContext("mini").firestore();
  await assertFails(getDoc(doc(db, `${base}/views/mini/members/achan`)));
  await assertFails(getDoc(doc(db, `${base}/views/rahul/members/amma`)));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), `${base}/access/mini`), { active: false, roles: ["nurse"], memberIds: ["amma"] }));
  await assertFails(getDoc(doc(db, `${base}/views/mini/members/amma`)));
});
test("counts/evidence cannot leak via status and optional sharing is checked live", async () => {
  const path = `${base}/views/rahul/members/amma/doses/today_morning`;
  const db = env.authenticatedContext("rahul").firestore();
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), { date: "2026-11-07", slot: "morning", status: "partial", countTaken: 2 }));
  await assertFails(getDoc(doc(db, path)));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), `${base}/members/amma/settings/sharing`), { counts: true, version: 2 }));
  await assertSucceeds(getDoc(doc(db, path)));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), { status: "partial", evidence: ["private"] }));
  await assertFails(getDoc(doc(db, path)));
});
test("stale generated answers and per-supporter overrides revoke reads", async () => {
  const path = `${base}/views/rahul/members/amma/answers/a`;
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), path), { sharingVersion: 1, sentences: [] });
  });
  const db = env.authenticatedContext("rahul").firestore();
  await assertSucceeds(getDoc(doc(db, path)));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), `${base}/members/amma/settings/sharing`), { counts: true, perSupporter: { rahul: { counts: false } }, version: 2 }));
  await assertFails(getDoc(doc(db, path)));
});
test("all client dose, sharing, projection and FL writes denied; anonymous reads denied", async () => {
  for (const path of [`${base}/members/amma/doses/a`, `${base}/members/amma/settings/sharing`, `${base}/views/amma/members/amma`, "flUpdates/1/clients/a", "flModels/latest"]) {
    await assertFails(setDoc(doc(env.authenticatedContext("amma").firestore(), path), { hacked: true }));
  }
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `${base}/views/rahul/members/amma`)));
});
test("callable identity and ID validation fail closed", () => {
  expect(() => requireAuth({ auth: undefined })).toThrow();
  expect(() => documentId("../other", "memberId")).toThrow();
  expect(documentId("amma", "memberId")).toBe("amma");
  expect(sharingAllowed({ isOwner: false, uid: "rahul", sharing: { counts: true, perSupporter: { rahul: { counts: false } } } } as any, "counts")).toBe(false);
});
