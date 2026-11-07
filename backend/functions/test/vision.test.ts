import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const records = new Map<string, Record<string, any>>();
  const writes: string[] = [];
  let nextId = 0;
  const doc = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshot(path) });
  const snapshot = (path: string) => ({ ...doc(path), exists: records.has(path), data: () => records.get(path) });
  const collection = (path: string): any => ({ path, doc: (id?: string) => doc(`${path}/${id ?? `rx${++nextId}`}`),
    get: async () => ({ docs: [...records.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(snapshot) }) });
  const db = { doc, collection, runTransaction: async (callback: any) => {
    const pending: (() => void)[] = [];
    const put = (ref: any, value: any, merge = false) => pending.push(() => { records.set(ref.path, { ...(merge ? records.get(ref.path) : {}), ...value }); writes.push(ref.path); });
    const result = await callback({ get: (ref: any) => ref.get(), create: put, set: put, update: (ref: any, value: any) => put(ref, value, true) });
    pending.forEach(write => write()); return result;
  } };
  return { records, writes, db, media: vi.fn(), provider: vi.fn(), access: vi.fn(), options: [] as any[] };
});
vi.mock('firebase-functions/v2/https', () => ({ onCall: (options: any, handler: any) => { mock.options.push(options); return handler; },
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock('../src/platform/firebase', () => ({ db: mock.db }));
vi.mock('../src/platform/media', () => ({ readAuthorizedMedia: mock.media }));
vi.mock('../src/vision/provider', () => ({ geminiVisionProvider: mock.provider }));
vi.mock('../src/platform/auth', () => ({
  requireAuth: (request: any) => { if (!request.auth) throw new Error('unauthenticated'); return request.auth.uid; },
  resolveMemberAccess: mock.access,
  sharingAllowed: (context: any) => context.isOwner || (context.sharing.perSupporter?.[context.uid]?.counts ?? context.sharing.counts) === true,
}));
import { parsePrescription, confirmPrescription, checkStrip, checkPillbox } from '../src/vision';
import { extract, matchStrip, validateExtraction } from '../src/vision/core';

const base = 'families/f/members/m';
const input = { familyId: 'f', memberId: 'm', photoUrl: 'gs://private/families/f/members/m/uploads/photo.jpg' };
const line = { lineId: 'l1', medicine: 'Example', strength: '5 mg', dose: '1 tablet', frequency: '1-0-0', food: 'after', duration: '30 days', confidence: 0.94, bbox: [0.1, 0.2, 0.8, 0.3] };
const accepted = { lineId: 'l1', accepted: true, medicine: 'Example', strength: '5 mg', dose: '1 tablet', frequency: '1-0-0', food: 'after', duration: '30 days', medicineId: 'new', count: 1, stock: 30, slots: [{ slot: 'morning', time: '08:00' }] };
const confirm = { familyId: 'f', memberId: 'm', prescriptionId: 'rx', lines: [accepted] };
const call = (fn: unknown, data: unknown, auth: any = { uid: 'u' }): Promise<any> => (fn as any)({ data, auth });
const schedule = (medicines: any[] = [{ id: 'old', name: 'Other', strength: '2 mg', count: 1, stock: 7 }]) => ({ time: '08:00', afterFood: true, medicines });

beforeEach(() => {
  vi.clearAllMocks(); mock.records.clear(); mock.writes.length = 0;
  mock.records.set(base, { ownerUid: 'u', mode: 'independent', nurseIds: ['n'] });
  mock.records.set('families/f/access/u', { active: true, memberIds: ['m'], roles: ['member'] });
  mock.records.set(`${base}/settings/sharing`, { counts: true });
  mock.records.set('families/f', { timezone: 'Asia/Kolkata' });
  mock.records.set(`${base}/prescriptions/rx`, { status: 'draft', extractedLines: [line] });
  mock.access.mockImplementation(async (uid, familyId, memberId) => {
    if (familyId !== 'f' || memberId !== 'm') throw new Error('denied');
    const access = mock.records.get(`families/f/access/${uid}`)!;
    const member = mock.records.get(base)!;
    if (!access?.active || !access.memberIds.includes(memberId)) throw new Error('denied');
    return { uid, familyId, memberId, member, memberRef: mock.db.doc(base), access, sharing: mock.records.get(`${base}/settings/sharing`),
      isOwner: member.ownerUid === uid, isNurse: access.roles.includes('nurse'), isSupporter: access.roles.includes('supporter') };
  });
  mock.media.mockResolvedValue({ bytes: Buffer.from('image'), mimeType: 'image/jpeg' });
  mock.provider.mockResolvedValue({ lines: [line] });
});
afterEach(() => vi.useRealTimers());

describe('vision extraction and authorization', () => {
  it('requires auth before media/model and rejects role spoofing, cross-family and HTTP URLs', async () => {
    await expect(call(parsePrescription, input, null)).rejects.toThrow('unauthenticated');
    await expect(call(parsePrescription, { ...input, role: 'supporter' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(parsePrescription, { ...input, familyId: 'other' })).rejects.toThrow('denied');
    for (const photoUrl of ['http://169.254.169.254/metadata', 'https://evil.test/a', 'gs://bucket/a?token=x']) {
      await expect(call(parsePrescription, { ...input, photoUrl })).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(mock.media).not.toHaveBeenCalled(); expect(mock.provider).not.toHaveBeenCalled();
  });
  it('requires authorized media even for syntactically valid gs URLs', async () => {
    mock.media.mockRejectedValue(new Error('unauthorized upload'));
    await expect(call(parsePrescription, input)).rejects.toThrow();
    expect(mock.provider).not.toHaveBeenCalled(); expect(mock.writes).toEqual([]);
  });
  it('checks counts sharing before reading supporter images', async () => {
    mock.records.set('families/f/access/u', { active: true, roles: ['supporter'], memberIds: ['m'] });
    mock.records.set(base, { mode: 'assisted' });
    mock.records.set(`${base}/settings/sharing`, { counts: false });
    await expect(call(parsePrescription, input)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(call(checkStrip, input)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mock.media).not.toHaveBeenCalled();
  });
  it('allows nurses to draft but not confirm, and assisted owners cannot confirm', async () => {
    mock.records.set('families/f/access/n', { active: true, roles: ['nurse'], memberIds: ['m'] });
    expect(await call(parsePrescription, input, { uid: 'n' })).toMatchObject({ lines: [{ needsReview: false }] });
    await expect(call(confirmPrescription, confirm, { uid: 'n' })).rejects.toMatchObject({ code: 'permission-denied' });
    mock.records.set(base, { ownerUid: 'u', mode: 'assisted' });
    await expect(call(confirmPrescription, confirm)).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('validates confidence, boxes, uniqueness and flags low confidence', () => {
    expect(validateExtraction({ lines: [{ ...line, confidence: 0.79 }] })[0].needsReview).toBe(true);
    for (const invalid of [{ ...line, confidence: 2 }, { ...line, bbox: [0.8, 0.2, 0.1, 0.3] }, { ...line, bbox: [0, 0, 1, 2] }]) {
      expect(() => validateExtraction({ lines: [invalid] })).toThrow();
    }
    expect(() => validateExtraction({ lines: [line, line] })).toThrow();
  });
  it('sanitizes provider failures and bounds even providers ignoring abort', async () => {
    mock.provider.mockRejectedValue(new Error('SECRET provider token'));
    await expect(call(parsePrescription, input)).rejects.toMatchObject({ code: 'unavailable', message: 'Image reading is unavailable. Please try again.' });
    vi.useFakeTimers();
    const provider = vi.fn(() => new Promise(() => {}));
    const pending = extract(provider, 'strip', { bytes: Buffer.from('i'), mimeType: 'image/jpeg' }, 10);
    const rejected = expect(pending).rejects.toThrow('Vision deadline');
    await vi.advanceTimersByTimeAsync(10); await rejected;
    expect(provider.mock.calls[0][2].aborted).toBe(true);
  });
});

describe('atomic human confirmation', () => {
  it('requires every draft line accepted/rejected and complete accepted timing/count/stock', async () => {
    for (const lines of [[], [accepted, accepted], [{ ...accepted, lineId: 'other' }], [{ ...accepted, stock: undefined }], [{ ...accepted, frequency: '0-1-0' }]]) {
      await expect(call(confirmPrescription, { ...confirm, lines })).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(mock.writes).toEqual([]);
    }
  });
  it('adds medicines preserving unrelated schedules/stock and makes retries idempotent', async () => {
    mock.records.set(`${base}/schedule/morning`, schedule());
    mock.records.set(`${base}/schedule/night`, { ...schedule(), time: '20:00' });
    const untouched = structuredClone(mock.records.get(`${base}/schedule/night`));
    expect(await call(confirmPrescription, confirm)).toMatchObject({ status: 'confirmed', scheduleSlots: ['morning'] });
    const stock = mock.records.get(`${base}/schedule/morning`)!.medicines;
    expect(stock.map((m: any) => [m.id, m.stock])).toEqual([['old', 7], ['new', 30]]);
    expect(mock.records.get(`${base}/schedule/night`)).toEqual(untouched);
    const writes = mock.writes.length;
    await call(confirmPrescription, confirm);
    expect(mock.writes).toHaveLength(writes);
    await expect(call(confirmPrescription, { ...confirm, lines: [{ ...accepted, stock: 100 }] })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mock.records.get(`${base}/prescriptions/rx`)!.confirmedBy).toBe('u');
  });
  it('rejects stock replacement and slot conflicts atomically', async () => {
    mock.records.set(`${base}/schedule/morning`, schedule());
    await expect(call(confirmPrescription, { ...confirm, lines: [{ ...accepted, medicineId: 'old' }] })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(call(confirmPrescription, { ...confirm, lines: [{ ...accepted, slots: [{ slot: 'morning', time: '09:00' }] }] })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mock.writes).toEqual([]); expect(mock.records.get(`${base}/schedule/morning`)).toEqual(schedule());
  });
  it('allows explicit rejection of all lines with no schedule mutation', async () => {
    const result = await call(confirmPrescription, { ...confirm, lines: [{ lineId: 'l1', accepted: false }] });
    expect(result.scheduleSlots).toEqual([]); expect(mock.writes).toEqual([`${base}/prescriptions/rx`]);
  });
  it('keeps a new multi-slot medicine stock consistent and omits private supporter projections', async () => {
    mock.records.set('families/f/access/helper', { active: true, memberIds: ['m'], roles: ['supporter'] });
    mock.records.set(`${base}/settings/sharing`, { counts: true, perSupporter: { helper: { counts: false } } });
    await call(confirmPrescription, { ...confirm, lines: [{ ...accepted, frequency: '1-0-1', slots: [
      { slot: 'morning', time: '08:00' }, { slot: 'night', time: '20:00' },
    ] }] });
    expect(mock.records.get(`${base}/schedule/morning`)!.medicines[0].stock).toBe(30);
    expect(mock.records.get(`${base}/schedule/night`)!.medicines[0].stock).toBe(30);
    expect(mock.records.has('families/f/views/helper/members/m/schedule/morning')).toBe(false);
    expect(mock.records.has('families/f/views/u/members/m/schedule/morning')).toBe(true);
  });
  it('rechecks revoked membership inside the write transaction', async () => {
    mock.provider.mockImplementation(async () => { mock.records.get('families/f/access/u')!.active = false; return { lines: [line] }; });
    await expect(call(parsePrescription, input)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mock.writes).toEqual([]);
  });
});

describe('schedule-only strip and photo observations', () => {
  it('matches printed name AND strength only with sufficient confidence and unique ID', async () => {
    mock.records.set(`${base}/schedule/morning`, schedule([{ id: 'new', name: 'Example', strength: '5 mg' }]));
    mock.provider.mockResolvedValue({ readName: 'EXAMPLE', readStrength: '5mg', confidence: 0.96 });
    expect(await call(checkStrip, input)).toMatchObject({ matchedMedicineId: 'new', sentences: [{ cites: ['S1'] }] });
    const medicines = [{ id: 'a', name: 'Example', strength: '5 mg' }];
    const read = { readName: 'Example', readStrength: '5 mg', confidence: 0.96 };
    expect(matchStrip({ ...read, confidence: 0.7 }, medicines)).toBeNull();
    expect(matchStrip({ ...read, readStrength: '10 mg' }, medicines)).toBeNull();
    expect(matchStrip({ ...read, readName: 'Exampl' }, medicines)).toBeNull();
    expect(matchStrip(read, [...medicines, { ...medicines[0], id: 'b' }])).toBeNull();
    expect(mock.writes).toEqual([]);
  });
  it('denies medicine replies if sharing is revoked while the provider reads the image', async () => {
    mock.records.set(base, { mode: 'assisted' });
    mock.records.set('families/f/access/u', { active: true, memberIds: ['m'], roles: ['supporter'] });
    mock.provider.mockImplementation(async () => {
      mock.records.set(`${base}/settings/sharing`, { counts: false });
      return { readName: 'Example', readStrength: '5 mg', confidence: 0.99 };
    });
    await expect(call(checkStrip, input)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mock.writes).toEqual([]);
  });
  it('never creates ingestion or stock from an empty photo; existing reports get evidence once', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T06:00:00Z'));
    mock.provider.mockResolvedValue({ slotEmpty: true });
    const data = { ...input, date: '2026-11-07', slot: 'morning' };
    expect(await call(checkPillbox, data)).toMatchObject({ slotEmpty: true, status: 'unknown', photoObserved: true });
    expect(mock.writes).toEqual([]);
    mock.records.set(`${base}/schedule/morning`, schedule());
    mock.records.set(`${base}/doses/2026-11-07_morning`, { status: 'reported', source: 'family', countTaken: 1, evidence: [{ type: 'family' }] });
    await call(checkPillbox, data); await call(checkPillbox, data);
    expect(mock.records.get(`${base}/doses/2026-11-07_morning`)).toMatchObject({ status: 'reported', countTaken: 1, evidence: [{ type: 'family' }, { type: 'photo', observationOnly: true }] });
    expect(mock.records.get(`${base}/schedule/morning`)).toEqual(schedule());
    expect(mock.writes).toEqual([`${base}/doses/2026-11-07_morning`]);
  });
  it('requires slot and actual current member-local date before provider access', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T20:00:00Z'));
    await expect(call(checkPillbox, { ...input, date: '2026-11-06', slot: 'morning' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(checkPillbox, { ...input, date: '2026-11-07' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mock.provider).not.toHaveBeenCalled();
  });
});
