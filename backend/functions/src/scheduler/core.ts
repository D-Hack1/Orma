import { createHash } from 'node:crypto';
import type { DocumentData } from 'firebase-admin/firestore';
import { z } from 'zod';

const id = z.string().min(1).max(128).refine(value => !value.includes('/') && value !== '.' && value !== '..');
export const taskInput = z.object({
  familyId: id, memberId: id, date: z.iso.date(), slot: z.enum(['morning', 'noon', 'night']),
  attempt: z.number().int().min(1).max(4),
  generation: z.number().int().nonnegative().optional(),
}).strict();
export type ReminderInput = z.infer<typeof taskInput>;
export const recorded = (dose?: DocumentData) => ['confirmed', 'reported', 'partial'].includes(dose?.status);
export const eventKey = (...parts: (string | number)[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export function localClock(now: Date, zone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return { date, minute, day };
}

export function timeMinute(time: unknown): number | undefined {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

export function millis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis(): number }).toMillis();
  return value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : 0;
}

export function isDue(now: Date, family: DocumentData, member: DocumentData, schedule: DocumentData, dose?: DocumentData, snooze?: DocumentData) {
  const local = localClock(now, member.timezone ?? family.timezone);
  const due = timeMinute(schedule.time);
  return due !== undefined && local.minute >= due && !recorded(dose) && !(millis(snooze?.remindAt) > now.getTime()) && Array.isArray(schedule.medicines) && schedule.medicines.length > 0;
}

export function onShift(entry: DocumentData, now: Date, zone?: string): boolean {
  const { day, minute } = localClock(now, zone);
  const from = timeMinute(entry.from), to = timeMinute(entry.to);
  if (from === undefined || to === undefined || !Array.isArray(entry.days)) return false;
  if (from === to) return entry.days.includes(day);
  if (from < to) return entry.days.includes(day) && minute >= from && minute < to;
  return (minute >= from && entry.days.includes(day)) || (minute < to && entry.days.includes(day === 1 ? 7 : day - 1));
}

export function refillThresholds(schedules: DocumentData[]): number[] {
  const medicines = new Map<string, { daily: number; stock: number }>();
  for (const schedule of schedules) for (const medicine of schedule.medicines ?? []) {
    if (typeof medicine.id !== 'string' || !Number.isFinite(medicine.count) || medicine.count <= 0 || !Number.isFinite(medicine.stock) || medicine.stock < 0) continue;
    const prior = medicines.get(medicine.id);
    medicines.set(medicine.id, { daily: (prior?.daily ?? 0) + medicine.count, stock: Math.min(prior?.stock ?? Infinity, medicine.stock) });
  }
  const days = Math.min(...[...medicines.values()].map(medicine => medicine.stock / medicine.daily));
  const threshold = [2, 4, 7].find(value => days <= value);
  return threshold === undefined ? [] : [threshold];
}
