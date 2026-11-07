import { z } from 'zod';
import { doseKeySchema, slotSchema } from '../doses/core';

const text = z.string().trim().min(1).max(200);
const id = z.string().regex(/^[\w-]{1,128}$/);
export const imageInputSchema = z.object({ familyId: id, memberId: id,
  photoUrl: z.string().max(1024).regex(/^gs:\/\/[^/?#]+\/[^?#]+$/) }).strict();
export const lineSchema = z.object({
  lineId: id, medicine: text, strength: text, dose: text,
  frequency: z.string().regex(/^\d{1,2}-\d{1,2}-\d{1,2}$/),
  food: z.enum(['before', 'after', 'any']), duration: text,
  confidence: z.number().min(0).max(1),
  bbox: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
}).strict();
export const extractionSchema = z.object({ lines: z.array(lineSchema).max(30) }).strict();
export const stripSchema = z.object({ readName: z.string().max(200), readStrength: z.string().max(200),
  confidence: z.number().min(0).max(1) }).strict();
export const pillboxSchema = z.object({ slotEmpty: z.union([z.boolean(), z.literal('uncertain')]) }).strict();
export const pillboxInputSchema = imageInputSchema.extend({ date: doseKeySchema.shape.date, slot: slotSchema }).strict();
const acceptedLine = z.object({ lineId: id, accepted: z.literal(true), medicine: text, strength: text, dose: text,
  frequency: lineSchema.shape.frequency, food: lineSchema.shape.food, duration: text, medicineId: id,
  count: z.number().int().positive().max(100), stock: z.number().int().min(0).max(100000),
  slots: z.array(z.object({ slot: slotSchema, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict()).min(1).max(3),
}).strict();
export const confirmSchema = z.object({ familyId: id, memberId: id, prescriptionId: id,
  lines: z.array(z.discriminatedUnion('accepted', [acceptedLine, z.object({ lineId: id, accepted: z.literal(false) }).strict()])).max(30),
}).strict();
export type ConfirmInput = z.infer<typeof confirmSchema>;
export type ConfirmedLine = z.infer<typeof acceptedLine>;
export type VisionTask = 'prescription' | 'strip' | 'pillbox';
export type VisionProvider = (task: VisionTask, image: { bytes: Buffer; mimeType: string }, signal: AbortSignal) => Promise<unknown>;

export function validateExtraction(value: unknown) {
  const result = extractionSchema.parse(value);
  if (new Set(result.lines.map(line => line.lineId)).size !== result.lines.length || result.lines.some(line =>
    line.bbox[0] >= line.bbox[2] || line.bbox[1] >= line.bbox[3])) throw new Error('Invalid extraction');
  return result.lines.map(line => ({ ...line, needsReview: line.confidence < 0.8 }));
}

// Deliberately no fuzzy/clinical aliases: a near spelling can be a different drug.
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '').trim();
export function matchStrip(read: z.infer<typeof stripSchema>, medicines: { id: string; name: string; strength?: string }[]) {
  if (read.confidence < 0.8 || !read.readName.trim() || !read.readStrength.trim()) return null;
  const matches = medicines.filter(m => normalized(m.name) === normalized(read.readName) &&
    normalized(m.strength ?? '') === normalized(read.readStrength));
  const ids = new Set(matches.map(m => m.id));
  return ids.size === 1 ? matches[0] : null;
}

export async function extract(provider: VisionProvider, task: VisionTask, image: { bytes: Buffer; mimeType: string }, timeoutMs = 12000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([provider(task, image, controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Vision deadline')); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); controller.abort(); }
}
