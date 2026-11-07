import PDFDocument from 'pdfkit';
import { type Fact, type Sentence } from '../replies/core';
import { datesInRange } from '../summaries/core';
import { type SummaryRecords } from '../summaries/records';

export type ReportSection = { title: string; sentences: Sentence[] };

/** A current schedule is not a historical prescription: label this denominator explicitly. */
export function adherenceFacts(records: SummaryRecords, from: string, to: string): Fact[] {
  const days = datesInRange(from, to);
  const facts: Fact[] = [];
  const medicines = new Map<string, { name: string; opportunities: number; full: number; partial: number; missed: number; unknown: number }>();
  const doses = new Map(records.doses.map(d => [d.id, d.data]));
  for (const schedule of records.schedules) {
    if (!['morning', 'noon', 'night'].includes(schedule.id)) continue;
    const entries = Array.isArray(schedule.data.medicines) ? schedule.data.medicines : [];
    for (const medicine of entries) {
      if (typeof medicine.id !== 'string' || typeof medicine.name !== 'string' || !Number.isInteger(medicine.count) || medicine.count <= 0) continue;
      const name = /[^\x20-\x7e]/.test(medicine.name) ? `Medicine ID ${medicine.id} (name omitted: unsupported PDF script)` : medicine.name;
      const stats = medicines.get(medicine.id) ?? { name, opportunities: 0, full: 0, partial: 0, missed: 0, unknown: 0 };
      medicines.set(medicine.id, stats);
      for (const date of days) {
        if ((schedule.data.effectiveFrom && date < schedule.data.effectiveFrom) || (schedule.data.effectiveTo && date > schedule.data.effectiveTo)) continue;
        stats.opportunities++;
        const dose = doses.get(`${date}_${schedule.id}`);
        const selected = entries.filter(m => dose?.medicinesTaken?.includes(m.id));
        const selectedCount = selected.reduce((total, m) => total + m.count, 0);
        const full = dose && ['confirmed', 'reported', 'partial'].includes(dose.status) && dose.medicinesTaken?.includes(medicine.id) && dose.countTaken === selectedCount;
        if (full) stats.full++;
        else if (dose?.status === 'partial' && dose.medicinesTaken?.includes(medicine.id)) stats.partial++;
        else if (dose?.outcome === 'missed' && dose.outcomeAudit?.by && typeof dose.outcomeAudit.reason === 'string' && dose.outcomeAudit.reason.trim()) stats.missed++;
        else stats.unknown++;
      }
    }
  }
  for (const [id, s] of medicines) {
    if (!s.opportunities) continue;
    const percent = Math.round(100 * s.full / s.opportunities);
    facts.push({ id: `adherence:${id}`, kind: 'count',
      textEn: `${s.name}: ${s.full}/${s.opportunities} current-schedule opportunities have a full-quantity report (${percent}%); ${s.partial} partial, ${s.missed} documented missed, ${s.unknown} Unknown or unresolved. This is a recording rate using the current schedule, not verified ingestion or reconstructed historical prescribing.`,
      textMl: `${s.name}: നിലവിലെ സമയപ്പട്ടികയിലെ ${s.opportunities} അവസരങ്ങളിൽ ${s.full} പൂർണ്ണ അളവ് രേഖപ്പെടുത്തി (${percent}%); ${s.partial} ഭാഗികം, ${s.missed} ഒഴിവാക്കിയതായി രേഖ, ${s.unknown} വ്യക്തമല്ല. ഇത് നിലവിലെ സമയപ്പട്ടിക അടിസ്ഥാനമാക്കിയ രേഖാനിരക്കാണ്; കഴിച്ചതിന്റെ തെളിവോ പഴയ ചികിത്സാപട്ടികയുടെ പുനർനിർമ്മാണമോ അല്ല.` });
  }
  return facts;
}

export function englishPdfFacts(facts: Fact[]): Fact[] {
  return facts.map(fact => /[^\x20-\x7e\n\r]/.test(fact.textEn) ? { ...fact,
    textEn: 'An authorized source is omitted from this English PDF because its script is unsupported. Read the original in Orma.',
  } : fact);
}

export async function renderReportPdf(sections: ReportSection[], sources: Fact[], range: { from: string; to: string }): Promise<Buffer> {
  // shortcut: PDFKit/fontkit crashes shaping Malayalam; reject Unicode until a tested shaper is available.
  if (/[^\x20-\x7e\n\r]/.test(JSON.stringify({ sections, sources: sources.map(s => ({ id: s.id, text: s.textEn })) }))) throw new Error('Unsupported PDF script; use an English ASCII report.');
  return await new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 45, bufferPages: true, info: { Title: 'Orma doctor-visit record summary' } });
    const chunks: Buffer[] = [];
    pdf.on('data', chunk => chunks.push(Buffer.from(chunk)));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      pdf.font('Helvetica');
      pdf.fontSize(17).text('Orma - doctor-visit record summary');
      pdf.fontSize(10).text(`${range.from} to ${range.to} (inclusive)`);
      pdf.text('Reports are not proof of ingestion. Unknown is not missed. No diagnosis or treatment advice.');
      for (const section of sections) {
        pdf.moveDown().fontSize(12).text(section.title);
        for (const sentence of section.sentences) pdf.fontSize(9).text(`${sentence.text} [${sentence.cites.join(', ')}]`);
      }
      pdf.moveDown().fontSize(12).text('Source/provenance index');
      // Only include the authorized approved excerpts, never canonical database paths.
      for (const source of sources) pdf.fontSize(8).text(`${source.id}: ${source.textEn}`);
      pdf.end();
    } catch (error) { reject(error); }
  });
}
