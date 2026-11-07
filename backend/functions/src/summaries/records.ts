import { type DocumentData } from 'firebase-admin/firestore';
import { sharingAllowed, type MemberAccess } from '../platform/auth';
import { type Fact } from '../replies/core';
import { datesInRange, memberLocalClock } from './core';

export type SourceRecord = { id: string; data: DocumentData };
export type SummaryRecords = { schedules: SourceRecord[]; doses: SourceRecord[]; optionalFacts?: Fact[] };

export async function readSummaryRecords(context: MemberAccess, from: string, to: string): Promise<SummaryRecords> {
  const [schedules, doses] = await Promise.all([
    context.memberRef.collection('schedule').get(),
    context.memberRef.collection('doses').orderBy('__name__').startAt(`${from}_`).endAt(`${to}_\uf8ff`).get(),
  ]);
  const optionalFacts: Fact[] = [];
  const family = await context.memberRef.parent.parent!.get();
  const timeZone = context.member.timezone ?? family.data()?.timezone ?? 'Asia/Kolkata';
  for (const [collection, field] of [['messages', 'messages'], ['notes', 'nurseNotes']] as const) {
    if (!sharingAllowed(context, field)) continue;
    const sources = await context.memberRef.collection(collection).get();
    for (const source of sources.docs) {
      const data = source.data();
      const instant = typeof data.at === 'string' ? data.at : data.at?.toDate?.()?.toISOString();
      // Undated statements cannot be honestly placed in the requested clinical interval.
      if (!instant || !Number.isFinite(Date.parse(instant))) continue;
      const localDate = memberLocalClock(new Date(instant), timeZone).date;
      if (localDate < from || localDate > to || typeof data.text !== 'string' || !data.text.trim()) continue;
      const text = data.text.slice(0, 2000);
      optionalFacts.push({ id: `${collection}:${source.id}`, kind: 'evidence',
        textEn: `${instant}: ${collection === 'messages' ? 'Message' : 'Nurse note'} records the following unverified statement: ${JSON.stringify(text)}.`,
        textMl: `${instant}: ${collection === 'messages' ? 'സന്ദേശത്തിൽ' : 'നഴ്സിന്റെ കുറിപ്പിൽ'} രേഖപ്പെടുത്തിയ സ്ഥിരീകരിക്കാത്ത വിവരം: ${JSON.stringify(text)}.` });
    }
  }
  return { schedules: schedules.docs.map(d => ({ id: d.id, data: d.data() })), doses: doses.docs.map(d => ({ id: d.id, data: d.data() })), optionalFacts };
}

export function summaryFacts(records: SummaryRecords, from: string, to: string): Fact[] {
  const facts: Fact[] = [];
  const byId = new Map(records.doses.map(d => [d.id, d.data]));
  const keys = new Set(records.doses.map(d => d.id));
  for (const date of datesInRange(from, to)) for (const s of records.schedules) {
    if (['morning', 'noon', 'night'].includes(s.id)) keys.add(`${date}_${s.id}`);
  }
  const labels: Record<string, [string, string]> = {
    confirmed: ['self-reported taken', 'സ്വയം കഴിച്ചതായി രേഖപ്പെടുത്തി'], reported: ['reported taken by a helper', 'സഹായി കഴിച്ചതായി രേഖപ്പെടുത്തി'],
    partial: ['partially recorded as taken', 'ഒരു ഭാഗം കഴിച്ചതായി രേഖപ്പെടുത്തി'], pending: ['pending, not recorded as taken', 'കാത്തിരിക്കുന്നു; കഴിച്ചതായി രേഖയില്ല'],
    unknown: ['Unknown; not evidence of a missed dose', 'വ്യക്തമല്ല; ഒഴിവാക്കിയെന്നതിന് തെളിവല്ല'],
  };
  for (const key of [...keys].sort()) {
    if (!/^\d{4}-\d{2}-\d{2}_(morning|noon|night)$/.test(key) || key.slice(0, 10) < from || key.slice(0, 10) > to) continue;
    const dose = byId.get(key);
    const missed = dose?.outcome === 'missed' && typeof dose.outcomeAudit?.by === 'string' && !!dose.outcomeAudit.by && typeof dose.outcomeAudit?.reason === 'string' && !!dose.outcomeAudit.reason.trim();
    const label = missed ? ['explicitly documented missed', 'ഒഴിവാക്കിയതായി വ്യക്തമായ രേഖയുണ്ട്'] : labels[dose?.status] ?? labels.unknown;
    facts.push({ id: `outcome:${key}`, kind: 'status', textEn: `${key}: ${label[0]}.`, textMl: `${key}: ${label[1]}.` });
  }
  if (!facts.length) facts.push({ id: `lookup:${from}:${to}`, kind: 'status', textEn: 'No dose records or confirmed schedule opportunities are available for this range. Intake is Unknown; do not assume a dose was taken or missed.', textMl: 'ഈ കാലയളവിൽ ഡോസ് രേഖകളോ സ്ഥിരീകരിച്ച സമയപ്പട്ടികയോ ലഭ്യമല്ല. കഴിച്ചോ എന്നത് വ്യക്തമല്ല; കഴിച്ചെന്നോ ഒഴിവാക്കിയെന്നോ കരുതരുത്.' });
  facts.push(...(records.optionalFacts ?? []));
  return facts;
}

export function canReadMedicines(context: MemberAccess): boolean { return sharingAllowed(context, 'counts'); }
