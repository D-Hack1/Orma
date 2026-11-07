import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ synthesize: vi.fn(), metadata: vi.fn(), save: vi.fn(), sign: vi.fn(), file: vi.fn(), getCall: vi.fn(), access: vi.fn(), constructed: vi.fn(), read: vi.fn() }));
vi.mock('@google-cloud/text-to-speech', () => ({ TextToSpeechClient: class { constructor() { mocks.constructed(); } synthesizeSpeech = mocks.synthesize; } }));
vi.mock('../src/platform/firebase', () => ({ db: { doc: () => ({ get: mocks.getCall }) } }));
vi.mock('../src/platform/auth', () => ({
  documentId: (value: string) => { if (!value || /[/%\\]/.test(value)) throw new Error('invalid identifier'); return value; },
  resolveMemberAccess: mocks.access,
}));
vi.mock('../src/platform/media', () => ({
  MAX_DOWNLOAD_BYTES: 6 * 1024 * 1024,
  mediaBucket: () => ({ file: mocks.file }),
  readPrivateObject: mocks.read,
  privateMediaPath: (value: string) => { if (!value || /[\\%?#\s]/.test(value) || value.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('invalid path'); return value; },
}));
import { createCallAudioUrl, synthesizePrivateAudio } from '../src/audio';
import { promptManifest } from '../src/audio/prompts';

let objects: Map<string, Record<string, unknown>>;
let call: Record<string, unknown>;
let version: number;
beforeEach(() => {
  vi.clearAllMocks();
  objects = new Map(); version = 2;
  call = { familyId: 'f', memberId: 'm', consented: true, status: 'active', expiresAt: { toMillis: () => Date.now() + 60_000 } };
  mocks.access.mockImplementation(async () => ({ sharing: { version } }));
  mocks.getCall.mockImplementation(async () => ({ data: () => call }));
  mocks.synthesize.mockResolvedValue([{ audioContent: Buffer.from('mp3') }]);
  mocks.sign.mockResolvedValue(['https://storage.example/short-lived']);
  mocks.read.mockImplementation(async (path: string) => {
    const metadata = objects.get(path);
    if (!metadata) throw { code: 404 };
    return { bytes: Buffer.from('mp3'), metadata };
  });
  mocks.file.mockImplementation((path: string) => ({
    getMetadata: () => {
      mocks.metadata(path);
      const metadata = objects.get(path);
      if (!metadata) return Promise.reject({ code: 404 });
      return Promise.resolve([metadata]);
    },
    save: async (bytes: Buffer, options: { metadata: Record<string, unknown> }) => {
      mocks.save(bytes, options);
      objects.set(path, { ...options.metadata, generation: '7', size: bytes.length });
    },
    getSignedUrl: mocks.sign,
  }));
});

describe('private Cloud TTS', () => {
  const path = 'families/f/members/m/exports/u/digest.mp3';
  it('requests Malayalam MP3 with a bounded SDK deadline and immutable private metadata', async () => {
    expect(await synthesizePrivateAudio('നമസ്കാരം', { language: 'ml', path })).toEqual({ path });
    expect(mocks.synthesize).toHaveBeenCalledWith({ input: { text: 'നമസ്കാരം' }, voice: { languageCode: 'ml-IN' }, audioConfig: { audioEncoding: 'MP3' } }, { timeout: 3500, retry: null });
    expect(mocks.save).toHaveBeenCalledWith(Buffer.from('mp3'), expect.objectContaining({ preconditionOpts: { ifGenerationMatch: 0 }, metadata: expect.objectContaining({ cacheControl: 'private, no-store', metadata: expect.objectContaining({ familyId: 'f', memberId: 'm', viewerUid: 'u', sharingVersion: '2', kind: 'audio' }) }) }));
  });
  it('caches exact text/language/path and coalesces simultaneous generation', async () => {
    await Promise.all([synthesizePrivateAudio('Hello', { language: 'en', path }), synthesizePrivateAudio('Hello', { language: 'en', path })]);
    await synthesizePrivateAudio('Hello', { language: 'en', path });
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    await expect(synthesizePrivateAudio('Different', { language: 'en', path })).rejects.toThrow('new path');
  });
  it('uses the requested recipient language and rejects unresolved paths/empty or oversized text', async () => {
    await synthesizePrivateAudio('வணக்கம்', { language: 'ta-IN', path });
    expect(mocks.synthesize.mock.calls[0][0].voice.languageCode).toBe('ta-IN');
    for (const text of ['', ' ', 'അ'.repeat(2000)]) await expect(synthesizePrivateAudio(text, { language: 'ml', path })).rejects.toThrow();
    await expect(synthesizePrivateAudio('hi', { language: 'ml', path: 'https://evil/audio.mp3' })).rejects.toThrow();
    await expect(synthesizePrivateAudio('hi', { language: 'ml', path: 'families/f/members/m/uploads/x.mp3' })).rejects.toThrow();
  });
  it('does not mark a stale cached export as newly authorized', async () => {
    await synthesizePrivateAudio('Hello', { language: 'en', path });
    version = 3;
    await expect(synthesizePrivateAudio('Hello', { language: 'en', path })).rejects.toThrow('new path');
  });
  it('fails if sharing changes while generating, or the SDK returns empty/large audio', async () => {
    mocks.synthesize.mockImplementationOnce(async () => { version++; return [{ audioContent: Buffer.from('mp3') }]; });
    await expect(synthesizePrivateAudio('Hello', { language: 'en', path })).rejects.toThrow('Sharing changed');
    mocks.synthesize.mockResolvedValueOnce([{ audioContent: Buffer.alloc(0) }]);
    await expect(synthesizePrivateAudio('Hello', { language: 'en', path: path.replace('digest', 'empty') })).rejects.toThrow('output size');
    mocks.synthesize.mockResolvedValueOnce([{ audioContent: Buffer.alloc(6 * 1024 * 1024 + 1) }]);
    await expect(synthesizePrivateAudio('Hello', { language: 'en', path: path.replace('digest', 'large') })).rejects.toThrow('output size');
  });
});

describe('temporary call URLs', () => {
  const context = { familyId: 'f', memberId: 'm', callId: 'c' };
  const path = 'families/f/members/m/calls/c/reply.mp3';
  it('reuses pregenerated generic prompts without a live SDK request', async () => {
    const manifest = promptManifest(resolve(__dirname, '../../../contracts/replies.json'));
    const prompt = manifest.prompts.find(prompt => prompt.id === 'call_menu' && prompt.language === 'ml')!;
    await synthesizePrivateAudio(prompt.text, { language: 'ml', path: prompt.path });
    mocks.synthesize.mockClear();
    await synthesizePrivateAudio(prompt.text, { language: 'ml', path });
    expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(objects.get(path)?.metadata).toMatchObject({ familyId: 'f', memberId: 'm', callId: 'c' });
  });
  it('issues only short-lived generation-bound V4 read URLs for active consented matching calls', async () => {
    await synthesizePrivateAudio('Hello', { language: 'en', path });
    const start = Date.now();
    await expect(createCallAudioUrl(path, context)).resolves.toBe('https://storage.example/short-lived');
    const options = mocks.sign.mock.calls[0][0];
    expect(options).toMatchObject({ version: 'v4', action: 'read', queryParams: { generation: '7' } });
    expect(options.expires).toBeLessThanOrEqual(Date.now() + 30_000);
    expect(options.expires).toBeGreaterThanOrEqual(start);
    await expect(createCallAudioUrl(path, { ...context, callId: 'other' })).rejects.toThrow('not bound');
    call.consented = false;
    await expect(createCallAudioUrl(path, context)).rejects.toThrow('active consented');
  });
  it('allows generic cached prompts but not exports or expired/stopped sessions', async () => {
    const prompt = 'audio/prompts/ml/call_menu.mp3';
    await synthesizePrivateAudio('Menu', { language: 'ml', path: prompt });
    await expect(createCallAudioUrl(prompt, context)).resolves.toBeTypeOf('string');
    await expect(createCallAudioUrl('families/f/members/m/exports/u/digest.mp3', context)).rejects.toThrow('not bound');
    call.status = 'completed';
    await expect(createCallAudioUrl(prompt, context)).rejects.toThrow();
    call.status = 'active'; call.expiresAt = { toMillis: () => Date.now() - 1 };
    await expect(createCallAudioUrl(prompt, context)).rejects.toThrow();
  });
  it('permits only the nonclinical Malayalam consent prompt before enrollment consent', async () => {
    Object.assign(call, { kind: 'consent', state: 'consent', consented: false });
    const text = 'മരുന്ന് ഓർമ്മിപ്പിക്കുന്ന വിളികൾ സ്വീകരിക്കാൻ സമ്മതമെങ്കിൽ 1 അമർത്തുക.';
    await synthesizePrivateAudio(text, { language: 'ml', path });
    await expect(createCallAudioUrl(path, context)).resolves.toBeTypeOf('string');
    await expect(synthesizePrivateAudio('Private medicine information', { language: 'en', path: path.replace('reply', 'private') })).rejects.toThrow('active consented');
    call.kind = 'reminder';
    await expect(createCallAudioUrl(path, context)).rejects.toThrow('active consented');
  });
});

it('builds bilingual prompt metadata without cloud requests or false native-review claims', () => {
  const manifest = promptManifest(resolve(__dirname, '../../../contracts/replies.json'));
  expect(manifest.review).toMatch(/review required/);
  expect(manifest.prompts.filter(prompt => prompt.id.startsWith('call_')).every(prompt => !prompt.runtimeOnly)).toBe(true);
  expect(manifest.prompts.find(prompt => prompt.id === 'confirmed')?.runtimeOnly).toBe(true);
  expect(mocks.synthesize).not.toHaveBeenCalled();
});
