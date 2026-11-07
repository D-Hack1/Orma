import { z } from 'zod';
import { type Fact, type FactPack, type Generator, type Sentence, validateSentences } from '../replies/core';

export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const rangeSchema = z.object({ from: localDateSchema, to: localDateSchema }).refine(({ from, to }) => {
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  return days >= 0 && days < 90;
}, 'Range must be ordered and at most 90 inclusive days');

export function datesInRange(from: string, to: string): string[] {
  rangeSchema.parse({ from, to });
  const dates: string[] = [];
  for (let day = Date.parse(from); day <= Date.parse(to); day += 86400000) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}

export function memberLocalClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: get('hour'), minute: get('minute') };
}

export async function composeSummary(facts: Fact[], language: 'en' | 'ml', generator?: Generator) {
  const pack: FactPack = { status: 'unknown', facts };
  let sentences: Sentence[] = [];
  if (generator) try { sentences = validateSentences(await generator(pack, 'Summarize all supplied facts without omitting Unknown outcomes.'), pack); } catch { /* approved fallback */ }
  // Always retain all approved outcomes; selection must not conceal Unknown or partial records.
  const fallbackUsed = facts.some(f => !sentences.some(s => s.cites.includes(f.id) && s.text === (language === 'ml' ? f.textMl : f.textEn)));
  if (fallbackUsed) sentences = facts.map(f => ({ text: language === 'ml' ? f.textMl : f.textEn, cites: [f.id] }));
  return { sentences, fallbackUsed, textEn: facts.map(f => f.textEn).join(' '), textMl: facts.map(f => f.textMl).join(' '), sources: facts };
}
