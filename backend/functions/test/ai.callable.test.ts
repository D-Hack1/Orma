import { describe, it, expect, vi, beforeEach } from 'vitest';
const mock = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), device: vi.fn(), recipients: vi.fn(), schedule: vi.fn(), gemini: vi.fn(), openai: vi.fn(), options: {} as Record<string, unknown> }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (options: Record<string, unknown>, handler: unknown) => { mock.options = options; return handler; },
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock('../src/platform/firebase', () => ({ db: { doc: () => ({ get: mock.device }), collection: () => ({ where: () => ({ get: mock.recipients }) }) } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUser: async () => ({ displayName: 'Anu' }) }) }));
vi.mock('../src/platform/auth', () => ({ requireAuth: mock.auth, resolveMemberAccess: mock.access, sharingAllowed: () => true }));
vi.mock('../src/ai/providers', () => ({ geminiProvider: mock.gemini, openaiProvider: mock.openai }));
import { understand } from '../src/ai';
import { unclear } from '../src/ai/core';
const call = understand as unknown as (request: unknown) => Promise<ReturnType<typeof unclear>>;
const data = { familyId: 'f', deviceId: 'd', memberIds: ['amma'], transcript: 'Raavile kazhichu', clientTime: '2026-11-07T02:45:00Z', tz: 'Asia/Kolkata' };
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockReturnValue('uid');
  mock.device.mockResolvedValue({ data: () => ({ familyId: 'f', memberIds: ['amma', 'achan'] }) });
  mock.schedule.mockResolvedValue({ docs: [{ id: 'morning', data: () => ({ medicines: [{ id: 'bp', name: 'BP' }] }) }] });
  mock.recipients.mockResolvedValue({ docs: [{ id: 'anu', data: () => ({ name: 'Anu', roles: ['leadSupporter'] }) }] });
  mock.access.mockImplementation(async (_uid, _familyId, memberId) => ({ memberId, member: { name: memberId }, memberRef: { collection: () => ({ get: mock.schedule }) }, isOwner: true, isGuardian: false }));
  mock.gemini.mockResolvedValue({ ...unclear(data.transcript), intent: 'log', members: ['amma'], slot: 'morning', needsClarification: false, clarifyQuestion: null, evidence: [{ field: 'slot', span: 'Raavile' }, { field: 'intent', span: 'kazhichu' }] });
});
describe('authenticated understand callable', () => {
  it('exports a Mumbai callable with App Check and Secret Manager binding', () => {
    expect(mock.options).toMatchObject({ region: 'asia-south1', secrets: ['OPENAI_API_KEY'], timeoutSeconds: 30 });
  });
  it('requires authentication before validation or provider access', async () => {
    mock.auth.mockImplementation(() => { throw new Error('unauthenticated'); });
    await expect(call({ data })).rejects.toThrow('unauthenticated');
    expect(mock.device).not.toHaveBeenCalled(); expect(mock.gemini).not.toHaveBeenCalled();
  });
  it('rejects invalid payloads without a database read', async () => {
    await expect(call({ data: { ...data, role: 'owner' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mock.device).not.toHaveBeenCalled();
  });
  it('rejects cross-family and unbound member requests', async () => {
    await expect(call({ data: { ...data, familyId: 'elsewhere' } })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(call({ data: { ...data, memberIds: ['stranger'] } })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mock.gemini).not.toHaveBeenCalled();
  });
  it('authorizes every group member before sending anything to providers', async () => {
    mock.access.mockImplementation(async (_uid, _familyId, id) => { if (id === 'achan') throw new Error('denied'); return { memberId: id }; });
    await expect(call({ data: { ...data, memberIds: ['amma', 'achan'] } })).rejects.toThrow('denied');
    expect(mock.access).toHaveBeenCalledWith('uid', 'f', 'amma');
    expect(mock.access).toHaveBeenCalledWith('uid', 'f', 'achan');
    expect(mock.gemini).not.toHaveBeenCalled();
  });
  it('returns a validated proposal without writing records', async () => {
    expect(await call({ data })).toMatchObject({ intent: 'log', needsClarification: false });
    expect(mock.access).toHaveBeenCalledWith('uid', 'f', 'amma');
    expect(mock.gemini.mock.calls[0][1].members[0].schedules[0]).toEqual({ slot: 'morning', medicines: [{ id: 'bp', name: 'BP' }] });
  });
  it('rejects unknown recipients and medicines', async () => {
    mock.gemini.mockResolvedValue({ ...unclear(data.transcript), intent: 'message', messageTo: 'stranger', messageText: data.transcript });
    expect((await call({ data })).intent).toBe('unclear');
    mock.gemini.mockResolvedValue({ ...unclear(data.transcript), medicines: ['unknown'] });
    expect((await call({ data })).intent).toBe('unclear');
  });
  it('does not let a supporter authorize a sharing proposal', async () => {
    const access = await mock.access('uid', 'f', 'amma');
    mock.access.mockResolvedValue({ ...access, isOwner: false, isGuardian: false });
    mock.gemini.mockResolvedValue({ ...unclear(data.transcript), intent: 'setSharing', members: ['amma'], sharingChanges: { supporterId: 'anu', counts: false, messages: false, risk: false, askedTwice: false, nurseNotes: false } });
    expect((await call({ data })).intent).toBe('unclear');
  });
  it('allows an owner to propose sharing changes without changing settings', async () => {
    const transcript = 'Anu-ve kaanikkanda';
    mock.gemini.mockResolvedValue({ ...unclear(transcript), intent: 'setSharing', members: ['amma'], needsClarification: false, clarifyQuestion: null,
      sharingChanges: { supporterId: 'anu', counts: false, messages: false, risk: false, askedTwice: false, nurseNotes: false },
      evidence: [{ field: 'sharingChanges', span: 'kaanikkanda' }, { field: 'sharingChanges.supporterId', span: 'Anu-ve' }] });
    expect(await call({ data: { ...data, transcript } })).toMatchObject({ intent: 'setSharing', needsClarification: false, sharingChanges: { supporterId: 'anu', counts: false } });
  });
});
