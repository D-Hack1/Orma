import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runUnderstanding, unclear, understandInputSchema, understandingSchema, verifyUnderstanding, type UnderstandInput, type Understanding } from '../src/ai/core';

const phrases = JSON.parse(readFileSync(new URL('../../../contracts/phrases.json', import.meta.url), 'utf8'));
const input = (transcript = 'Raavile 3 gulika kazhichu', extra = {}): UnderstandInput => ({ familyId: 'demo-family', deviceId: 'home-phone', memberIds: ['amma'], transcript, clientTime: '2026-11-07T02:45:00Z', tz: 'Asia/Kolkata', ...extra });
const logged = (): Understanding => ({ ...unclear('Raavile 3 gulika kazhichu'), intent: 'log', members: ['amma'], slot: 'morning', count: 3, needsClarification: false, clarifyQuestion: null, evidence: [{ field: 'intent', span: 'kazhichu' }, { field: 'slot', span: 'Raavile' }, { field: 'count', span: '3' }] });
const context = { members: [], recipients: [] };
afterEach(() => vi.useRealTimers());

describe('contract phrases with mocked model proposals', () => {
  for (const phrase of phrases.cases) it(`accepts the safe interpretation of phrase ${phrase.id}`, async () => {
    const request = input(phrase.transcript, { memberIds: phrases.context.memberIds, ...phrase.context });
    const proposal = { ...unclear(phrase.transcript), needsClarification: false, clarifyQuestion: null, ...phrase.expected };
    if (proposal.intent === 'message' && !proposal.messageText) proposal.messageText = proposal.evidence.find((item: {field: string}) => item.field === 'messageText').span;
    const result = await runUnderstanding(request, context, [vi.fn().mockResolvedValue(proposal)]);
    expect(result).toMatchObject(phrase.expected);
    expect(understandingSchema.safeParse(result).success).toBe(true);
  });
});

describe('validation and evidence', () => {
  it('strictly validates shape, one input source, IDs and timezone', () => {
    expect(understandInputSchema.safeParse(input()).success).toBe(true);
    for (const extra of [{ role: 'owner' }, { familyId: '../family' }, { memberIds: ['amma', 'amma'] }, { tz: 'bad/zone' }, { audioBase64: 'YQ==', mimeType: 'audio/aac' }, { transcript: '' }]) expect(understandInputSchema.safeParse(input(undefined, extra)).success).toBe(false);
    expect(understandInputSchema.safeParse(input(undefined, { transcript: undefined, audioBase64: 'YQ==', mimeType: 'audio/aac', durationSeconds: 16 })).success).toBe(false);
    expect(understandInputSchema.safeParse(input(undefined, { transcript: undefined, audioBase64: 'YQ==' })).success).toBe(false);
    expect(understandInputSchema.safeParse(input(undefined, { transcript: undefined, audioBase64: 'YQ==', mimeType: 'audio/aac' })).success).toBe(true);
    expect(understandInputSchema.safeParse(input(undefined, { transcript: undefined, audioBase64: Buffer.alloc(1048577).toString('base64'), mimeType: 'audio/aac' })).success).toBe(false);
  });
  it('drops invented and wrong-case spans and requests clarification', () => {
    const proposal = logged();
    proposal.evidence = [{ field: 'intent', span: 'kazhichu' }, { field: 'count', span: 'three' }, { field: 'slot', span: 'raavile' }];
    const result = verifyUnderstanding(proposal, input());
    expect(result.evidence).toEqual([{ field: 'intent', span: 'kazhichu' }]);
    expect(result.needsClarification).toBe(true);
    expect(result.clarifyQuestion).toBeTruthy();
  });
  it('does not allow a provider to rewrite a supplied transcript', () => {
    expect(verifyUnderstanding(logged(), input('kazhichu')).intent).toBe('unclear');
  });
  it('clarifies missing factual identity/slot evidence but allows selected context', () => {
    const proposal = { ...logged(), count: null, slot: null, evidence: [{ field: 'intent', span: 'kazhichu' }] };
    expect(verifyUnderstanding(proposal, input()).needsClarification).toBe(true);
    expect(verifyUnderstanding(proposal, input(undefined, { slot: 'morning' })).needsClarification).toBe(false);
    expect(verifyUnderstanding({ ...proposal, members: ['amma', 'achan'] }, input(undefined, { slot: 'morning', memberIds: ['amma', 'achan'] })).needsClarification).toBe(true);
  });
  it('rejects members outside the authorized input', () => {
    expect(verifyUnderstanding({ ...logged(), members: ['stranger'] }, input()).intent).toBe('unclear');
  });
  it.each(['Did I take my medicine?', 'I have not taken it', "I haven't taken it", 'Njan gulika kazhicho', 'Kazhichittilla', 'കഴിച്ചില്ല', 'കഴിച്ചോ?', 'Maybe I took it', 'I will have taken it tomorrow', 'കഴിച്ചിട്ടുണ്ടോ'])("never logs question/negative: %s", transcript => {
    const proposal = { ...logged(), transcript, count: null, evidence: [{ field: 'intent', span: transcript }] };
    const result = verifyUnderstanding(proposal, input(transcript, { slot: 'morning' }));
    expect(result.intent === 'unclear' || result.needsClarification).toBe(true);
  });
  it('will not accept a false positive member action or count without its own evidence', () => {
    const transcript = 'Achan kazhichu, Amma kazhichilla';
    const proposal = { ...logged(), transcript, members: ['achan', 'amma'], count: null, memberActions: [{ memberId: 'achan', taken: true, count: 3, medicines: [] }, { memberId: 'amma', taken: true, count: null, medicines: [] }], evidence: [{ field: 'memberActions.0', span: 'Achan kazhichu' }, { field: 'memberActions.1', span: 'Amma kazhichilla' }] };
    expect(verifyUnderstanding(proposal, input(transcript, { memberIds: ['achan', 'amma'], slot: 'morning' })).needsClarification).toBe(true);
  });
  it('rejects unknown output fields', () => {
    expect(() => verifyUnderstanding({ ...logged(), mutate: true }, input())).toThrow();
  });
});

describe('fallback deadlines', () => {
  it('falls back on schema-invalid output', async () => {
    const fallback = vi.fn().mockResolvedValue(logged());
    expect((await runUnderstanding(input(), context, [vi.fn().mockResolvedValue({ intent: 'log' }), fallback])).intent).toBe('log');
    expect(fallback).toHaveBeenCalledOnce();
  });
  it('aborts Gemini after six seconds and uses fallback', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = runUnderstanding(input(), context, [async (_input, _context, abort) => { signal = abort; return new Promise(() => {}); }, vi.fn().mockResolvedValue(logged())]);
    await vi.advanceTimersByTimeAsync(6000);
    expect((await pending).intent).toBe('log');
    expect(signal?.aborted).toBe(true);
  });
  it('returns safe unclear after both providers time out', async () => {
    vi.useFakeTimers();
    const hung = vi.fn(() => new Promise(() => {}));
    const pending = runUnderstanding(input(), context, [hung, hung]);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await pending).toEqual(unclear(input().transcript!));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not retry unsafe evidence with another model', async () => {
    const fallback = vi.fn();
    const proposal = logged(); proposal.evidence = [];
    expect((await runUnderstanding(input(), context, [vi.fn().mockResolvedValue(proposal), fallback])).needsClarification).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
  });
});
