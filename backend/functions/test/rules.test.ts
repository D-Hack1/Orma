import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { documentId, requireAuth, sharingAllowed } from "../src/platform/auth";
import { setSharing } from "../src/platform/sharing";
import { assertEmulator, demoDate, seedDemo } from "../src/platform/seed";
import { ref, uploadBytes, getBytes } from "firebase/storage";

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
test("sharing callable rejects supporters, self-appointed guardians and locked fields", async () => {
  const call = (uid: string, changes: object) => setSharing.run({ auth: { uid, token: {} }, data: { familyId: "demo", memberId: "amma", changes } } as any);
  await expect(call("rahul", { counts: true })).rejects.toMatchObject({ code: "permission-denied" });
  await expect(call("amma", { guardianId: "rahul" })).rejects.toMatchObject({ code: "invalid-argument" });
  await expect(call("amma", { doseStatus: false })).rejects.toMatchObject({ code: "invalid-argument" });
  const result = await call("amma", { supporterId: "rahul", messages: false });
  expect(result.saved).toBe(true);
  expect(result.sharing?.perSupporter.rahul.messages).toBe(false);
  await env.withSecurityRulesDisabled(async ctx => {
    expect((await getDoc(doc(ctx.firestore(), `${base}/views/rahul/members/amma/doses/today_morning`))).exists()).toBe(false);
    await setDoc(doc(ctx.firestore(), `${base}/members/amma/settings/sharing`), { guardianId: "rahul", capacityNote: "" });
  });
  await expect(call("rahul", { counts: true })).rejects.toMatchObject({ code: "permission-denied" });
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), `${base}/members/amma/settings/sharing`), { guardianId: "rahul", capacityNote: "Synthetic recorded guardian order", version: 2 }));
  expect((await call("rahul", { counts: false })).saved).toBe(true);
});
test("Storage only accepts bounded owner uploads; derived exports never public", async () => {
  const image = new Uint8Array([1, 2, 3]);
  const owner = env.authenticatedContext("amma").storage();
  const path = "families/demo/members/amma/uploads/photo.jpg";
  await assertSucceeds(uploadBytes(ref(owner, path), image, { contentType: "image/jpeg" }));
  await assertFails(uploadBytes(ref(env.authenticatedContext("rahul").storage(), path), image, { contentType: "image/jpeg" }));
  await assertFails(getBytes(ref(env.authenticatedContext("rahul").storage(), path)));
  await assertFails(uploadBytes(ref(owner, "families/demo/members/amma/uploads/bad.html"), image, { contentType: "text/html" }));
  await assertFails(getBytes(ref(owner, "families/demo/members/amma/reports/private.pdf")));
});
test("seed guard rejects cloud hosts/projects and invalid dates", () => {
  expect(() => assertEmulator({})).toThrow();
  expect(() => assertEmulator({ GCLOUD_PROJECT: "production", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" })).toThrow();
  expect(() => assertEmulator({ FIRESTORE_EMULATOR_HOST: "remote.example:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" })).toThrow();
  expect(() => demoDate("2026-02-30")).toThrow();
  expect(demoDate("2026-11-07")).toBe("2026-11-07");
});
test("seed expands 30-day fixture, shifts to today, reset preserves unrelated namespaces", async () => {
  await seedDemo(false, "2026-11-08");
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    expect((await getDoc(doc(db, "families/demo-family/members/amma/doses/2026-11-07_noon"))).data()?.countExpected).toBe(3);
    expect((await getDoc(doc(db, "families/demo-family/views/rahul/members/amma/doses/2026-11-07_noon"))).data()).not.toHaveProperty("countTaken");
    expect((await getDoc(doc(db, "families/demo-family/access/mini"))).data()?.memberIds).toEqual(["achan", "amma"]);
    await setDoc(doc(db, "families/demo-family/members/amma/messages/delete-me"), { text: "stale" });
    await setDoc(doc(db, "families/unrelated"), { preserve: true });
  });
  await seedDemo(true, "2026-11-08");
  await env.withSecurityRulesDisabled(async ctx => {
    expect((await getDoc(doc(ctx.firestore(), "families/demo-family/members/amma/messages/delete-me"))).exists()).toBe(false);
    expect((await getDoc(doc(ctx.firestore(), "families/unrelated"))).exists()).toBe(true);
  });
});
