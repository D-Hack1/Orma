import { describe, expect, it } from 'vitest';
import { adherenceFacts, englishPdfFacts, renderReportPdf } from '../src/reports/core';
import type { SummaryRecords } from '../src/summaries/records';

describe('clinically honest recording rates', () => {
  const records: SummaryRecords = { schedules: [{ id: 'morning', data: { medicines: [{ id: 'bp', name: 'Amlodipine', count: 1 }] } }], doses: [
    { id: '2026-11-01_morning', data: { status: 'confirmed', countTaken: 1, medicinesTaken: ['bp'] } },
    { id: '2026-11-02_morning', data: { status: 'unknown' } },
    { id: '2026-11-03_morning', data: { status: 'unknown', outcome: 'missed', outcomeAudit: { by: 'nurse', reason: 'reviewed' } } },
  ] };
  it('counts every scheduled opportunity, including absent records, without calling Unknown missed', () => {
    const [fact] = adherenceFacts(records, '2026-11-01', '2026-11-04');
    expect(fact.textEn).toContain('1/4');
    expect(fact.textEn).toContain('(25%)');
    expect(fact.textEn).toContain('1 documented missed, 2 Unknown');
    expect(fact.textEn).toContain('not verified ingestion');
  });
  it('does not guess that a partial quantity equals a full medicine', () => {
    const altered = { ...records, doses: [{ id: '2026-11-01_morning', data: { status: 'partial', countTaken: 0, medicinesTaken: ['bp'] } }] };
    expect(adherenceFacts(altered, '2026-11-01', '2026-11-01')[0].textEn).toContain('0/1');
    expect(adherenceFacts(altered, '2026-11-01', '2026-11-01')[0].textEn).toContain('1 partial');
  });
  it('never divides by zero or invents a medicine without a confirmed schedule', () => {
    expect(adherenceFacts({ schedules: [], doses: records.doses }, '2026-11-01', '2026-11-04')).toEqual([]);
  });
});

it('creates a real PDF buffer with a header and EOF', async () => {
  const text = 'A recorded dose is Unknown.';
  const bytes = await renderReportPdf([{ title: 'Dose records', sentences: [{ text, cites: ['D1'] }] }], [], { from: '2026-11-07', to: '2026-11-07' });
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.subarray(-20).toString()).toContain('%%EOF');
  expect(bytes.length).toBeGreaterThan(1000);
});

it('rejects Malayalam rather than silently exporting corrupt clinical text', async () => {
  await expect(renderReportPdf([{ title: 'Dose records', sentences: [{ text: 'ഈ ഡോസ് കഴിച്ചോ എന്ന് ഉറപ്പില്ല.', cites: ['D1'] }] }], [], { from: '2026-11-07', to: '2026-11-07' })).rejects.toThrow('Unsupported PDF script');
});

it('keeps an English report usable with explicit unsupported-name and note omissions', async () => {
  const facts = adherenceFacts({ schedules: [{ id: 'morning', data: { medicines: [{ id: 'bp', name: 'മരുന്ന്', count: 1 }] } }], doses: [] }, '2026-11-07', '2026-11-07');
  expect(facts[0].textEn).toContain('Medicine ID bp (name omitted');
  const prepared = englishPdfFacts([...facts, { id: 'note:1', kind: 'evidence', textEn: 'Record says: തലവേദന', textMl: 'തലവേദന' }]);
  expect(prepared[1].textEn).toContain('source is omitted');
  const bytes = await renderReportPdf([{ title: 'Records', sentences: prepared.map(f => ({ text: f.textEn, cites: [f.id] })) }], prepared, { from: '2026-11-07', to: '2026-11-07' });
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
});
