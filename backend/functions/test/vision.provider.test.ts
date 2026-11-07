import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ generate: vi.fn(), constructor: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  models = { generateContent: mock.generate };
  constructor(options: unknown) { mock.constructor(options); }
} }));
import { geminiVisionProvider } from '../src/vision/provider';
beforeEach(() => { vi.clearAllMocks(); mock.generate.mockResolvedValue({ text: '{"slotEmpty":"uncertain"}' }); });
describe('Vertex vision adapter', () => {
  it('uses Pro, inline authorized bytes, structured JSON and bounded abortable requests', async () => {
    const controller = new AbortController();
    expect(await geminiVisionProvider('pillbox', { bytes: Buffer.from('image'), mimeType: 'image/png' }, controller.signal)).toEqual({ slotEmpty: 'uncertain' });
    expect(mock.constructor).toHaveBeenCalledWith(expect.objectContaining({ vertexai: true }));
    const request = mock.generate.mock.calls[0][0];
    expect(request.model).toBe(process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-pro');
    expect(request.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: Buffer.from('image').toString('base64') } });
    expect(request.config).toMatchObject({ responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8192,
      abortSignal: controller.signal, httpOptions: { timeout: 11000 }, responseJsonSchema: { type: 'object' } });
    expect(request.config.systemInstruction).toContain('Never infer ingestion');
  });
  it('supplies schemas for all tasks without clinical identification prompts', async () => {
    for (const task of ['prescription', 'strip', 'pillbox'] as const) {
      await geminiVisionProvider(task, { bytes: Buffer.from('image'), mimeType: 'image/jpeg' }, new AbortController().signal);
    }
    expect(mock.generate.mock.calls[0][0].config.responseJsonSchema.properties.lines).toBeDefined();
    expect(mock.generate.mock.calls[1][0].config.systemInstruction).toContain('No identification from appearance, clinical knowledge');
    expect(mock.generate.mock.calls[1][0].config.responseJsonSchema.properties.confidence).toBeDefined();
  });
});
