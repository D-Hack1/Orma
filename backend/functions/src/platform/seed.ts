import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { app, db } from "./firebase";

export function assertEmulator(env: NodeJS.ProcessEnv = process.env): void {
  const local = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
  if ((env.GCLOUD_PROJECT ?? "demo-orma") !== "demo-orma"
    || !local.test(env.FIRESTORE_EMULATOR_HOST ?? "") || !local.test(env.FIREBASE_AUTH_EMULATOR_HOST ?? "")) {
    throw new Error("Seed/reset require project demo-orma and loopback Firestore AND Auth emulator hosts. Production is refused.");
  }
}

const fixtureSchema = z.object({
  synthetic: z.literal(true), today: z.string(),
  people: z.array(z.object({ id: z.string(), uid: z.string().optional(), name: z.string(), roles: z.array(z.string()), language: z.string() })),
  families: z.array(z.object({ id: z.string(), name: z.string(), ownerId: z.string(), timezone: z.string(), memberIds: z.array(z.string()), roster: z.array(z.record(z.string(), z.unknown())) })),
  members: z.array(z.object({ id: z.string(), familyId: z.string(), ownerUid: z.string().optional(), mode: z.string(), nurseIds: z.array(z.string()) }).passthrough()),
  devices: z.array(z.object({ id: z.string() }).passthrough()),
  sharingDefaults: z.record(z.string(), z.unknown()),
  sharingOverrides: z.array(z.object({ memberId: z.string(), supporterId: z.string() }).passthrough()),
  schedule: z.array(z.object({ memberId: z.string(), slot: z.string(), time: z.string(), medicines: z.array(z.object({ id: z.string(), count: z.number() }).passthrough()) }).passthrough()),
  history: z.array(z.record(z.string(), z.string())), model: z.object({ version: z.string() }).passthrough(),
});

export function demoDate(value?: string): string {
  const date = value ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Use a real --date=YYYY-MM-DD.");
  return date;
}

export async function seedDemo(reset = false, dateArg?: string) {
  assertEmulator();
  const today = demoDate(dateArg);
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(resolve(__dirname, "../../../../contracts/demo-family.json"), "utf8")));
  const shift = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fixture.today}T00:00:00Z`);
  const shifted = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + shift).toISOString().slice(0, 10);
  if (reset) {
    for (const family of fixture.families) {
      await db.recursiveDelete(db.doc(`families/${family.id}`));
      for (const collection of ["alerts", "calls"]) {
        const records = await db.collection(collection).where("familyId", "==", family.id).get();
        for (const record of records.docs) await db.recursiveDelete(record.ref);
      }
    }
    for (const device of fixture.devices) await db.doc(`devices/${device.id}`).delete();
  }
  const auth = getAuth(app);
  for (const person of fixture.people.filter(person => person.uid)) {
    try { await auth.getUser(person.uid!); }
    catch (error) {
      if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
      await auth.createUser({ uid: person.uid, displayName: person.name });
    }
  }
  let writes = 0;
  let batch = db.batch();
  const put = async (path: string, data: object) => {
    batch.set(db.doc(path), data);
    if (++writes % 400 === 0) { await batch.commit(); batch = db.batch(); }
  };
  for (const family of fixture.families) {
    const { id, memberIds, ...data } = family;
    await put(`families/${id}`, data);
    for (const person of fixture.people.filter(person => person.uid)) {
      const managed = fixture.members.filter(member => member.familyId === id && (
        member.ownerUid === person.uid || member.nurseIds.includes(person.uid!)
        || (id === "demo-family" && person.roles.some(role => ["leadSupporter", "supporter"].includes(role)))
      )).map(member => member.id);
      if (managed.length) await put(`families/${id}/access/${person.uid}`, { active: true, roles: person.roles, memberIds: managed });
    }
  }
  for (const member of fixture.members) {
    const person = fixture.people.find(person => person.id === member.id)!;
    const { id, familyId, ...data } = member;
    const root = `families/${familyId}/members/${id}`;
    const perSupporter: Record<string, object> = {};
    for (const override of fixture.sharingOverrides.filter(value => value.memberId === id)) {
      const { memberId, supporterId, ...flags } = override;
      perSupporter[supporterId] = flags;
    }
    await put(root, { ...data, name: person.name, roles: person.roles, language: person.language, consent: { ...(data.consent as object), calls: false } });
    await put(`${root}/settings/sharing`, { ...fixture.sharingDefaults, perSupporter, version: 0 });
    const schedules = fixture.schedule.filter(schedule => schedule.memberId === id);
    const viewers = fixture.people.filter(viewer => viewer.uid && (viewer.uid === member.ownerUid || member.nurseIds.includes(viewer.uid)
      || (familyId === "demo-family" && viewer.roles.some(role => ["leadSupporter", "supporter"].includes(role)))));
    for (const viewer of viewers) await put(`families/${familyId}/views/${viewer.uid}/members/${id}`, { name: person.name, mode: member.mode });
    for (const schedule of schedules) {
      const { memberId, ...data } = schedule;
      await put(`${root}/schedule/${schedule.slot}`, data);
      for (const viewer of viewers) {
        if (viewer.uid === member.ownerUid || (perSupporter[viewer.uid!] as { counts?: boolean })?.counts) {
          await put(`families/${familyId}/views/${viewer.uid}/members/${id}/schedule/${schedule.slot}`, data);
        }
      }
    }
    for (const history of fixture.history) {
      for (const [index, slot] of ["morning", "noon", "night"].entries()) {
        const code = history[id]?.[index];
        if (!code || code === "-") continue;
        const schedule = schedules.find(value => value.slot === slot);
        if (!schedule || !"CRPUM".includes(code)) throw new Error(`Invalid history ${id} ${slot} ${code}`);
        const date = shifted(history.date);
        const at = Timestamp.fromMillis(Date.parse(`${date}T${schedule.time}:00+05:30`) + (code === "U" || code === "M" ? 30 : 15) * 60000);
        const by = code === "R" ? "mini" : "CP".includes(code) ? member.ownerUid ?? "server-call" : "server";
        const status = code === "R" ? "reported" : code === "P" ? "partial" : code === "C" ? "confirmed" : "unknown";
        const countExpected = schedule.medicines.reduce((sum, medicine) => sum + medicine.count, 0);
        const known = "CRP".includes(code);
        const countTaken = code === "P" ? 2 : known ? countExpected : 0;
        const medicinesTaken = code === "P" ? ["amma-noon"] : known ? schedule.medicines.map(medicine => medicine.id) : [];
        const source = code === "R" ? "nurse" : known && !member.ownerUid ? "call" : "tap";
        const dose = { date, slot, status, countTaken, countExpected, medicinesTaken, source, by, at, attempts: known ? 1 : 3, evidence: [{ type: known ? source : "checkin", at, by, snippet: "Synthetic demo history" }], ...(code === "M" ? { outcome: "missed" } : {}) };
        await put(`${root}/doses/${date}_${slot}`, dose);
        for (const viewer of viewers) {
          const counts = (perSupporter[viewer.uid!] as { counts?: boolean })?.counts;
          await put(`families/${familyId}/views/${viewer.uid}/members/${id}/doses/${date}_${slot}`, { date, slot, status, ...(counts ? { countTaken, countExpected, medicinesTaken } : {}) });
        }
      }
    }
  }
  for (const device of fixture.devices) { const { id, ...data } = device; await put(`devices/${id}`, data); }
  const model = { ...fixture.model, createdAt: Timestamp.fromDate(new Date(`${today}T00:00:00Z`)) };
  await put(`flModels/${fixture.model.version}`, model);
  await put("flModels/latest", model);
  await batch.commit();
  console.log(`${reset ? "Reset" : "Seeded"} demo-orma for ${today}: ${writes} documents; phone calls disabled.`);
}
