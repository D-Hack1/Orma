import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn(), log: vi.fn(), status: vi.fn(), explain: vi.fn(), generator: vi.fn(), persist: vi.fn() }));
vi.mock('../src/answers', () => ({ geminiAnswerGenerator: mocks.generator, persistAnswer: mocks.persist }));
vi.mock('../src/platform/firebase', () => ({ db: {} }));
vi.mock('../src/platform/auth', async importOriginal => ({
  ...await importOriginal<object>(), resolveMemberAccess: mocks.access,
}));
vi.mock('../src/doses', async importOriginal => ({ ...await importOriginal<object>(), logDose: mocks.log }));
vi.mock('../src/replies', async importOriginal => ({ ...await importOriginal<object>(), askStatus: mocks.status }));
vi.mock('../src/explain', async importOriginal => ({ ...await importOriginal<object>(), explain: mocks.explain }));
import { askStatus, logDose } from '../src/api';

const key = { familyId: 'demo-family', memberId: 'achan', date: '2026-11-07', slot: 'morning' };
const request = (data: unknown, uid = 'achan-uid') => ({ data, auth: { uid, token: {} }, rawRequest: {} }) as any;
describe('callable safety boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({ uid: 'achan-uid', memberId: 'achan', isOwner: true });
    mocks.status.mockResolvedValue({ status: 'unknown', textEn: 'Please wait.', textMl: 'കാത്തിരിക്കൂ.' });
    mocks.persist.mockResolvedValue('answer-1');
  });
  it('requires authentication before reading any record', async () => {
    await expect(askStatus.run({ data: key } as any)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it('rejects malformed calendar dates', async () => {
    await expect(askStatus.run(request({ ...key, date: '2026-02-30' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it('does not trust a client supplied role', async () => {
    await askStatus.run(request({ ...key, role: 'guardian' }));
    expect(mocks.status).toHaveBeenCalledWith({}, expect.objectContaining(key), expect.objectContaining({ role: 'member', uid: 'achan-uid' }), mocks.generator);
  });
  it('asks for date and slot instead of guessing from an unresolved question', async () => {
    const result = await askStatus.run(request({ familyId: 'demo-family', memberId: 'achan', question: 'Did I take it?' }));
    expect(result).toMatchObject({ needsClarification: true, sentences: [] });
    expect(mocks.access).toHaveBeenCalledWith('achan-uid', 'demo-family', 'achan');
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it('returns a privacy-filtered deterministic reply after logging', async () => {
    mocks.log.mockResolvedValue({ result: 'logged', status: 'confirmed', reply: { textEn: 'Recorded safely.' } });
    const result = await logDose.run(request({ ...key, countTaken: 1, source: 'tap' }));
    expect(result).toMatchObject({ result: 'logged', reply: { textEn: 'Recorded safely.' } });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.access).toHaveBeenCalledWith('achan-uid', 'demo-family', 'achan');
  });
  it('does not leak internal errors', async () => {
    mocks.status.mockRejectedValue(new Error('private document path'));
    await expect(askStatus.run(request(key))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('does not return an answer when sharing changes before persistence', async () => {
    const { HttpsError } = await import('firebase-functions/v2/https');
    mocks.persist.mockRejectedValue(new HttpsError('permission-denied', 'Sharing changed.'));
    await expect(askStatus.run(request(key))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
