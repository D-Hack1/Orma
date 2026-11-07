import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), get: vi.fn(), set: vi.fn(), txget: vi.fn() }));
vi.mock('../src/platform/firebase', () => ({ db: {
  doc: () => ({ get: mocks.get }),
  runTransaction: (fn: (tx: unknown) => unknown) => fn({ get: mocks.txget, set: mocks.set }),
} }));
vi.mock('../src/platform/auth', () => ({ resolveMemberAccess: mocks.access, requireAuth: () => 'owner', sharingAllowed: (context: { allowed: boolean }) => context.allowed }));
import { localInstant, planSnooze, explainEnteredMedicine, snoozeService, explainMedicineService } from '../src/doses/support';
const schedule = { time: '08:00', afterFood: true, medicines: [{ id: 'bp', name: 'Amlodipine', purpose: 'family entered purpose', aliases: ['BP'] }] };
const request = { familyId: 'f', memberId: 'amma', date: '2026-11-07', slot: 'morning' as const, reason: 'not_eaten' as const };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ allowed: true, memberRef: { collection: () => ({ doc: () => ({}), get: async () => ({ docs: [{ data: () => schedule }] }) }) } });
  mocks.get.mockResolvedValue({ data: () => ({ timezone: 'Asia/Kolkata' }) });
});
describe('member-local snoozes', () => {
  it('converts confirmed due times for India and DST zones', () => {
    expect(localInstant('2026-11-07', '08:00', 'Asia/Kolkata').toISOString()).toBe('2026-11-07T02:30:00.000Z');
    expect(localInstant('2026-07-07', '08:00', 'America/New_York').toISOString()).toBe('2026-07-07T12:00:00.000Z');
    expect(localInstant('2026-11-07', '08:00', 'America/New_York').toISOString()).toBe('2026-11-07T13:00:00.000Z');
  });
  it('rejects DST gaps and repeated local minutes', () => {
    expect(() => localInstant('2026-03-08', '02:30', 'America/New_York')).toThrow('ambiguous or unavailable');
    expect(() => localInstant('2026-11-01', '01:30', 'America/New_York')).toThrow('ambiguous or unavailable');
  });
  it('uses future usual meal time; missing/passed meal falls back 30 minutes', () => {
    const now = new Date('2026-11-07T02:45:00Z');
    expect(planSnooze(request, schedule, { breakfast: '09:00' }, 'Asia/Kolkata', now)).toMatchObject({ remindAt: '2026-11-07T03:30:00.000Z' });
    for (const meals of [{}, { breakfast: '08:00' }]) expect(planSnooze(request, schedule, meals, 'Asia/Kolkata', now)).toMatchObject({ remindAt: '2026-11-07T03:15:00.000Z' });
  });
  it('never suggests postponing time-critical medicines or snoozing another local date', () => {
    expect(planSnooze(request, { ...schedule, timeCritical: true }, {}, 'Asia/Kolkata', new Date('2026-11-07T02:45:00Z'))).toMatchObject({ allowed: false });
    expect(() => planSnooze(request, schedule, {}, 'Asia/Kolkata', new Date('2026-11-08T02:45:00Z'))).toThrow('today');
  });
  it.each(['confirmed', 'reported', 'partial'])('does not snooze a %s dose', async status => {
    mocks.txget.mockResolvedValue({ exists: true, data: () => ({ status }) });
    await expect(snoozeService('owner', request)).rejects.toThrow('already recorded');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('writes only a reminder, never a dose or stock', async () => {
    mocks.txget.mockResolvedValueOnce({ data: () => undefined }).mockResolvedValueOnce({ exists: true, data: () => schedule }).mockResolvedValueOnce({ data: () => ({}) });
    expect(await snoozeService('owner', request, new Date('2026-11-07T02:45:00Z'))).toMatchObject({ allowed: true });
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.set.mock.calls[0][1]).toMatchObject({ reason: 'not_eaten', by: 'owner' });
    expect(mocks.set.mock.calls[0][1]).not.toHaveProperty('status');
  });
});
describe('confirmed entered medicine purposes only', () => {
  it('uses exact entered aliases and never medical knowledge', () => {
    expect(explainEnteredMedicine([schedule], 'BP')).toMatchObject({ found: true, reply: { vars: { purpose: 'family entered purpose' } } });
    expect(explainEnteredMedicine([schedule], 'pressure')).toMatchObject({ found: false });
    expect(explainEnteredMedicine([{ medicines: [{ id: 'x', name: 'Metformin' }] }], 'Metformin')).toMatchObject({ found: false });
  });
  it('clarifies ambiguous names and conflicting duplicated purposes', () => {
    expect(explainEnteredMedicine([schedule, { medicines: [{ id: 'other', name: 'Amlodipine', purpose: 'different' }] }], 'Amlodipine')).toMatchObject({ found: false, needsClarification: true });
    expect(explainEnteredMedicine([schedule, { medicines: [{ ...schedule.medicines[0], purpose: 'different' }] }], 'BP')).toMatchObject({ found: false, needsClarification: true });
  });
  it('requires authorized medicine-detail access', async () => {
    mocks.access.mockRejectedValueOnce(new Error('denied'));
    await expect(explainMedicineService('outsider', { familyId: 'f', memberId: 'amma', medicineHint: 'BP' })).rejects.toThrow('denied');
    mocks.access.mockResolvedValueOnce({ allowed: false });
    await expect(explainMedicineService('helper', { familyId: 'f', memberId: 'amma', medicineHint: 'BP' })).rejects.toThrow('not shared');
  });
});
