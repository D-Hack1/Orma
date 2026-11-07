import { z } from 'zod';

export const slotSchema = z.enum(['morning', 'noon', 'night']);
export const doseKeySchema = z.object({
  familyId: z.string().regex(/^[\w-]+$/),
  memberId: z.string().regex(/^[\w-]+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date'),
  slot: slotSchema,
});
const inputEvidenceSchema = z.object({
  type: z.string().max(30).optional(), by: z.string().max(128).optional(), at: z.string().max(100).optional(),
  snippet: z.string().max(2000).optional(),
  spans: z.array(z.object({ field: z.string().max(100), span: z.string().min(1).max(500) })).max(30).optional(),
  digits: z.string().regex(/^[0-9*#]{1,30}$/).optional(),
});
export const logDoseSchema = doseKeySchema.extend({
  countTaken: z.number().int().positive().max(100),
  medicinesTaken: z.array(z.string().min(1).max(100)).max(100).default([]),
  source: z.enum(['voice', 'tap', 'notification', 'widget', 'call', 'photo', 'nurse', 'family']),
  by: z.string().max(128).optional(),
  evidence: z.union([inputEvidenceSchema, z.array(inputEvidenceSchema).max(20)]).optional(),
});
export type DoseKey = z.infer<typeof doseKeySchema>;
export type LogDoseInput = z.input<typeof logDoseSchema>;
export type Actor = {
  uid: string;
  role: 'member' | 'guardian' | 'supporter' | 'nurse' | 'device';
  memberId?: string;
  deviceId?: string;
};
export type Medicine = { id: string; name: string; count: number; stock?: number };
export type Schedule = { time?: string; medicines: Medicine[] };
export type DoseStatus = 'confirmed' | 'reported' | 'partial' | 'pending' | 'unknown';
export type Evidence = {
  type: string; by: string; at: string; snippet?: string;
  spans?: { field: string; span: string }[]; digits?: string; outcome?: 'duplicate_blocked';
};
export type Dose = {
  status: DoseStatus; countTaken: number; countExpected: number; medicinesTaken: string[];
  source: string; by: string; at: string; attempts: number; evidence: Evidence[];
};
export type Member = {
  ownerUid?: string; uid?: string; userId?: string; nurseIds?: string[]; deviceIds?: string[];
  sharing?: { guardianId?: string; capacityNote?: string; counts?: boolean; nurseNotes?: boolean;
    risk?: boolean; perSupporter?: Record<string, { counts?: boolean; nurseNotes?: boolean; risk?: boolean }> };
};

export function memberPath(key: DoseKey): string {
  return `families/${key.familyId}/members/${key.memberId}`;
}

// Family membership and supporter/nurse assignment are checked by the authenticated wrapper.
export function hasFullAccess(member: Member, key: DoseKey, actor: Actor): boolean {
  return (actor.role === 'member' && actor.memberId === key.memberId &&
    (member.ownerUid === actor.uid || member.uid === actor.uid || member.userId === actor.uid || key.memberId === actor.uid)) ||
    (actor.role === 'guardian' && member.sharing?.guardianId === actor.uid && !!member.sharing.capacityNote);
}

export function assertActor(member: Member, key: DoseKey, actor: Actor): void {
  if (!actor.uid) throw new Error('Unauthenticated');
  if (actor.role === 'member' || actor.role === 'guardian') {
    if (!hasFullAccess(member, key, actor)) throw new Error('Permission denied');
  }
  if (actor.role === 'nurse' && !member.nurseIds?.includes(actor.uid)) throw new Error('Permission denied');
  if (actor.role === 'device' && (!actor.deviceId || !member.deviceIds?.includes(actor.deviceId))) {
    throw new Error('Permission denied');
  }
}

export function doseProjection(key: DoseKey, dose: Dose, member: Member, viewerUid: string) {
  const base = { date: key.date, slot: key.slot, status: dose.status };
  const counts = member.sharing?.perSupporter?.[viewerUid]?.counts ?? member.sharing?.counts ?? false;
  return counts ? { ...base, countTaken: dose.countTaken, countExpected: dose.countExpected, medicinesTaken: dose.medicinesTaken } : base;
}

export function decideDose(schedule: Schedule, raw: LogDoseInput, actor: Actor, at: string, existing?: Dose) {
  const input = logDoseSchema.parse(raw);
  if (input.by !== undefined && input.by !== actor.uid) throw new Error('Caller by does not match authenticated identity');
  if (input.source === 'photo') throw new Error('A photo observation cannot establish that medicine was taken');
  const entries = input.evidence ? Array.isArray(input.evidence) ? input.evidence : [input.evidence] : [{}];
  const evidence = entries.map(entry => {
    const result: Evidence = { type: input.source, by: actor.uid, at };
    if (entry.snippet) result.snippet = entry.snippet;
    if (entry.digits) result.digits = entry.digits;
    if (entry.spans) result.spans = entry.spans.filter(span => entry.snippet?.includes(span.span));
    return result;
  });
  if (existing && ['confirmed', 'reported', 'partial'].includes(existing.status)) {
    return { result: 'duplicate_blocked' as const,
      dose: { ...existing, evidence: [...(existing.evidence ?? []), ...evidence.map(entry => ({ ...entry, outcome: 'duplicate_blocked' as const }))] },
      medicines: schedule.medicines };
  }
  if (!schedule.medicines.length || schedule.medicines.some(m =>
    !m.id || !Number.isInteger(m.count) || m.count <= 0 ||
    (m.stock !== undefined && (!Number.isFinite(m.stock) || m.stock < 0)))) {
    throw new Error('Invalid confirmed schedule');
  }
  if (new Set(schedule.medicines.map(m => m.id)).size !== schedule.medicines.length) {
    throw new Error('Duplicate schedule medicine');
  }
  const expected = schedule.medicines.reduce((sum, medicine) => sum + medicine.count, 0);
  if (input.countTaken > expected) throw new Error('Count exceeds prescribed dose; ask for help');
  if (new Set(input.medicinesTaken).size !== input.medicinesTaken.length) throw new Error('Duplicate medicine');
  const ids = input.medicinesTaken.length ? input.medicinesTaken :
    input.countTaken === expected || schedule.medicines.length === 1 ? schedule.medicines.map(m => m.id) : [];
  if (!ids.length || ids.some(id => !schedule.medicines.some(m => m.id === id))) {
    throw new Error('Clarify which medicines were taken before updating stock');
  }
  const selected = schedule.medicines.filter(m => ids.includes(m.id));
  // shortcut: mixed-medicine partial quantities need clarification until the API accepts per-medicine amounts.
  const amounts = new Map(selected.map(m => [m.id, selected.length === 1 ? input.countTaken : m.count]));
  if (selected.some(m => amounts.get(m.id)! > m.count) || [...amounts.values()].reduce((sum, count) => sum + count, 0) !== input.countTaken) {
    throw new Error('Count does not match selected medicines; clarify amounts');
  }
  const status: DoseStatus = input.countTaken < expected ? 'partial' :
    actor.role === 'member' || actor.role === 'device' ? 'confirmed' : 'reported';
  const dose: Dose = {
    status, countTaken: input.countTaken, countExpected: expected, medicinesTaken: ids,
    source: input.source, by: actor.uid, at, attempts: existing?.attempts ?? 0,
    evidence: [...(existing?.evidence ?? []), ...evidence],
  };
  const medicines = schedule.medicines.map(m => {
    if (!ids.includes(m.id) || m.stock === undefined) return m;
    const taken = amounts.get(m.id)!;
    if (m.stock < taken) throw new Error('Insufficient recorded stock; reconcile stock first');
    return { ...m, stock: m.stock - taken };
  });
  return { result: status === 'partial' ? 'partial' as const : 'logged' as const, dose, medicines };
}
