import { z } from 'zod';
import { hasFullAccess, type Actor, type Dose, type DoseKey, type DoseStatus, type Evidence, type Member } from '../doses/core';

export type Fact = { id: string; kind: 'status' | 'count' | 'evidence'; textEn: string; textMl: string; evidence?: Evidence };
export type FactPack = { status: DoseStatus; facts: Fact[] };
export type Sentence = { text: string; cites: string[] };
export type Generator = (pack: FactPack, question?: string) => Promise<unknown>;

const statusWords: Record<DoseStatus, [string, string]> = {
  confirmed: ['A self-report records this dose as taken. Check before taking another dose.', 'ഈ ഡോസ് കഴിച്ചതായി സ്വന്തം രേഖയുണ്ട്. വീണ്ടും കഴിക്കുന്നതിന് മുമ്പ് പരിശോധിക്കുക.'],
  reported: ['A supporter or nurse reported this dose as taken. Check before taking another dose.', 'സഹായിയോ നഴ്സോ ഈ ഡോസ് കഴിച്ചതായി രേഖപ്പെടുത്തി. വീണ്ടും കഴിക്കുന്നതിന് മുമ്പ് പരിശോധിക്കുക.'],
  partial: ['Only part of this dose is recorded as taken. Check with your supporter before taking more.', 'ഈ ഡോസിന്റെ ഒരു ഭാഗം മാത്രം കഴിച്ചതായി രേഖയുണ്ട്. കൂടുതൽ കഴിക്കുന്നതിന് മുമ്പ് സഹായിയോട് ചോദിക്കുക.'],
  pending: ['This dose is recorded as pending, not taken. Check before taking another dose.', 'ഈ ഡോസ് കാത്തിരിക്കുന്നതായി രേഖയുണ്ട്; കഴിച്ചതായി രേഖയില്ല. വീണ്ടും കഴിക്കുന്നതിന് മുമ്പ് പരിശോധിക്കുക.'],
  unknown: ["I am not sure whether this dose was taken. Please wait before taking another and contact your supporter.", 'ഈ ഡോസ് കഴിച്ചോ എന്ന് ഉറപ്പില്ല. വീണ്ടും കഴിക്കുന്നതിന് മുമ്പ് കാത്തിരിക്കൂ, സഹായിയെ ബന്ധപ്പെടൂ.'],
};

export function buildFactPack(key: DoseKey, member: Member, viewer: Actor, dose?: Dose): FactPack {
  const status = dose?.status && statusWords[dose.status] ? dose.status : 'unknown';
  const [textEn, textMl] = statusWords[status];
  const id = `dose:${key.date}_${key.slot}`;
  // Absence is a lookup result, not an invented dose record.
  const facts: Fact[] = [{ id: dose ? id : `lookup:${key.date}_${key.slot}`, kind: 'status', textEn, textMl }];
  const full = hasFullAccess(member, key, viewer);
  const overrides = member.sharing?.perSupporter?.[viewer.uid];
  const counts = full || (overrides?.counts ?? member.sharing?.counts ?? false);
  if (dose && counts && Number.isFinite(dose.countTaken) && Number.isFinite(dose.countExpected)) {
    facts.push({ id: `${id}:count`, kind: 'count',
      textEn: `${dose.countTaken} of ${dose.countExpected} tablets are recorded as taken.`,
      textMl: `${dose.countExpected} ഗുളികയിൽ ${dose.countTaken} കഴിച്ചതായി രേഖയുണ്ട്.` });
  }
  if (dose && full) dose.evidence?.forEach((evidence, index) => {
    facts.push({ id: `${id}:evidence:${index}`, kind: 'evidence',
      textEn: `A ${evidence.type} ${evidence.outcome === 'duplicate_blocked' ? 'duplicate attempt' : 'record'} was logged at ${evidence.at} by ${evidence.by}.`,
      textMl: `${evidence.at}: ${evidence.by} രേഖപ്പെടുത്തിയ ${evidence.type} വിവരം.`, evidence });
  });
  return { status, facts };
}

const generatedSchema = z.object({
  insufficient: z.boolean().optional(),
  sentences: z.array(z.object({ text: z.string().min(1).max(2000), cites: z.array(z.string()).min(1).max(20) })).max(20).optional(),
});
const numbers = (text: string): string[] => text.match(/\d+(?:[.:]\d+)*/g) ?? [];

export function validateSentences(raw: unknown, pack: FactPack): Sentence[] {
  const parsed = generatedSchema.safeParse(raw);
  if (!parsed.success || parsed.data.insufficient) return [];
  return (parsed.data.sentences ?? []).filter(sentence => {
    const cited = sentence.cites.map(id => pack.facts.find(f => f.id === id));
    if (cited.some(fact => !fact)) return false;
    const texts = cited.flatMap(fact => [fact!.textEn, fact!.textMl]);
    if (numbers(sentence.text).some(number => !texts.some(text => numbers(text).includes(number)))) return false;
    // Citations and matching digits cannot prove a medical claim; only approved wording is safe.
    return texts.includes(sentence.text);
  });
}

export async function answerFromFacts(pack: FactPack, generator?: Generator, question?: string) {
  let sentences: Sentence[] = [];
  if (generator) {
    try { sentences = validateSentences(await generator(pack, question), pack); } catch { /* deterministic fallback */ }
  }
  const statusFact = pack.facts.find(fact => fact.kind === 'status')!;
  // A count/evidence-only answer must never suppress the unknown/partial safety instruction.
  const fallbackUsed = pack.status === 'unknown' || !sentences.some(sentence => sentence.cites.includes(statusFact.id) &&
    (sentence.text === statusFact.textEn || sentence.text === statusFact.textMl));
  if (fallbackUsed) sentences = [{ text: statusFact.textEn, cites: [statusFact.id] }];
  if (pack.status === 'unknown') sentences = [];
  return {
    status: pack.status, sentences, fallbackUsed,
    textEn: statusFact.textEn, textMl: statusFact.textMl,
  };
}
