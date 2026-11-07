import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import type { Dose } from './core';

const wireTime = (value: unknown): string => value instanceof Timestamp ? value.toDate().toISOString() : String(value);

export function readDose(data: DocumentData | undefined): Dose | undefined {
  if (!data) return undefined;
  return { ...data, at: wireTime(data.at), evidence: (data.evidence ?? []).map((entry: DocumentData) => ({ ...entry, at: wireTime(entry.at) })) } as Dose;
}

export function storedDose(dose: Dose) {
  return { ...dose, at: Timestamp.fromDate(new Date(dose.at)),
    evidence: dose.evidence.map(entry => ({ ...entry, at: Timestamp.fromDate(new Date(entry.at)) })) };
}
