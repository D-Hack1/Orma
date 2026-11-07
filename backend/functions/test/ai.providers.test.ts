import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), complete: vi.fn(), transcribe: vi.fn(), google: vi.fn(), openai: vi.fn(), toFile: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: mocks.generate }; constructor(options: unknown) { mocks.google(options); } } }));
vi.mock('openai', () => ({ default: class { audio = { transcriptions: { create: mocks.transcribe } }; chat = { completions: { create: mocks.complete } }; constructor(options: unknown) { mocks.openai(options); } }, toFile: mocks.toFile }));
import { geminiProvider, openaiProvider, providerSchema } from '../src/ai/providers';
import { unclear, type UnderstandInput } from '../src/ai/core';
const context = { members: [], recipients: [] };
const base: UnderstandInput = { familyId: 'f', deviceId: 'd', memberIds: ['amma'], clientTime: '2026-11-07T02:45:00Z', tz: 'Asia/Kolkata' };
beforeEach(() => { vi.clearAllMocks(); mocks.complete.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(unclear('kazhichu')) } }] }); });
describe('provider adapters without cloud calls', () => {
  it('uses Vertex inline audio with JSON schema and cancellation', async () => {
    mocks.generate.mockResolvedValue({ text: JSON.stringify(unclear('kazhichu')) });
    const signal = new AbortController().signal;
    await geminiProvider({ ...base, audioBase64: 'YQ==', mimeType: 'audio/aac' }, context, signal);
    expect(mocks.google).toHaveBeenCalledWith(expect.objectContaining({ vertexai: true }));
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ contents: [{ role: 'user', parts: expect.arrayContaining([{ inlineData: { data: 'YQ==', mimeType: 'audio/aac' } }]) }], config: expect.objectContaining({ responseJsonSchema: providerSchema, responseMimeType: 'application/json', abortSignal: signal, httpOptions: { timeout: 6000 } }) }));
  });
  it('sends transcripts without audio transcription and uses strict structured output', async () => {
    await openaiProvider({ ...base, transcript: 'kazhichu' }, context, new AbortController().signal);
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ response_format: { type: 'json_schema', json_schema: { name: 'orma_understanding', strict: true, schema: providerSchema } } }), expect.anything());
    expect(mocks.openai).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });
  it('transcribes in-memory audio before extracting intent with the same signal', async () => {
    const signal = new AbortController().signal;
    mocks.toFile.mockResolvedValue('audio-file'); mocks.transcribe.mockResolvedValue({ text: 'kazhichu' });
    await openaiProvider({ ...base, audioBase64: 'YQ==', mimeType: 'audio/ogg' }, context, signal);
    expect(mocks.toFile).toHaveBeenCalledWith(Buffer.from('a'), 'speech.ogg', { type: 'audio/ogg' });
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({ file: 'audio-file' }), { signal });
    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), { signal });
  });
  it('rejects rewritten transcription', async () => {
    await expect(openaiProvider({ ...base, transcript: 'different' }, context, new AbortController().signal)).rejects.toThrow('Transcript changed');
  });
});
