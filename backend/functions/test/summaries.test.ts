import { describe, expect, it } from 'vitest';
import { composeSummary, datesInRange, memberLocalClock, rangeSchema } from '../src/summaries/core';
import { summaryFacts } from '../src/summaries/records';

describe('viewer-scoped summary facts', () => {
  it('includes absent scheduled doses as Unknown, never missed or taken', () => {
    const facts = summaryFacts({ schedules: [{ id: 'morning', data: { medicines: [{ name: 'SECRET', stock: 70 }] } }], doses: [] }, '2026-11-07', '2026-11-07');
    expect(facts).toHaveLength(1);
    expect(facts[0].textEn).toContain('Unknown');
    expect(JSON.stringify(facts)).not.toContain('SECRET');
    expect(JSON.stringify(facts)).not.toContain('70');
  });
  it('requires an audit before describing a missed outcome', () => {
    const records = { schedules: [], doses: [{ id: '2026-11-07_noon', data: { status: 'unknown', outcome: 'missed' } }] };
    expect(summaryFacts(records, '2026-11-07', '2026-11-07')[0].textEn).toContain('Unknown');
    records.doses[0].data = { ...records.doses[0].data, outcomeAudit: { by: 'nurse', reason: 'confirmed with member' } } as typeof records.doses[0]['data'];
    expect(summaryFacts(records, '2026-11-07', '2026-11-07')[0].textEn).toContain('documented missed');
  });
  it('retains every Unknown/partial outcome despite selective or malicious generation', async () => {
    const facts = summaryFacts({ schedules: [{ id: 'morning', data: {} }, { id: 'night', data: {} }], doses: [] }, '2026-11-07', '2026-11-07');
    const result = await composeSummary(facts, 'ml', async () => ({ sentences: [{ text: 'Take Warfarin at 09:00.', cites: [facts[0].id] }] }));
    expect(result.fallbackUsed).toBe(true);
    expect(result.sentences.map(s => s.text)).toEqual(facts.map(f => f.textMl));
    expect(result.sentences.every(s => s.cites.length === 1)).toBe(true);
  });
  it('handles empty data and provider outage safely', async () => {
    const facts = summaryFacts({ schedules: [], doses: [] }, '2026-11-07', '2026-11-07');
    const result = await composeSummary(facts, 'en', async () => { throw Error('offline'); });
    expect(result.textEn).toContain('Intake is Unknown');
    expect(result.sentences).toHaveLength(1);
  });
});

it('validates real inclusive dates and the 90-day bound', () => {
  expect(datesInRange('2026-11-07', '2026-11-07')).toEqual(['2026-11-07']);
  expect(rangeSchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
  expect(rangeSchema.safeParse({ from: '2026-11-08', to: '2026-11-07' }).success).toBe(false);
  expect(datesInRange('2026-01-01', '2026-03-31')).toHaveLength(90);
  expect(() => datesInRange('2026-01-01', '2026-04-01')).toThrow();
});

it('selects member-local 20:00, including quarter-hour zones and DST', () => {
  expect(memberLocalClock(new Date('2026-11-07T14:30:00Z'), 'Asia/Kolkata')).toEqual({ date: '2026-11-07', hour: '20', minute: '00' });
  expect(memberLocalClock(new Date('2026-11-07T14:15:00Z'), 'Asia/Kathmandu').hour).toBe('20');
  expect(memberLocalClock(new Date('2026-07-08T00:00:00Z'), 'America/New_York')).toEqual({ date: '2026-07-07', hour: '20', minute: '00' });
});
