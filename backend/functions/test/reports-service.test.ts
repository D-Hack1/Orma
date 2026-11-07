import { beforeEach, expect, it, vi } from 'vitest';
import type { MemberAccess } from '../src/platform/auth';

const state = vi.hoisted(() => ({ save: vi.fn(async () => undefined), persist: vi.fn(), notify: vi.fn(async () => []), reauthorize: vi.fn(async () => undefined) }));
vi.mock('../src/platform/firebase', () => ({ db: {} }));
vi.mock('../src/platform/media', () => ({ MAX_DOWNLOAD_BYTES: 6 * 1024 * 1024 }));
vi.mock('../src/alerts', () => ({ routeNotification: state.notify }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ file: () => ({ bucket: { name: 'private-bucket' }, save: state.save }) }) }) }));
vi.mock('../src/answers', () => ({ geminiAnswerGenerator: async () => { throw Error('offline'); }, sharingVersion: (c: MemberAccess) => c.sharing.version,
  reauthorize: state.reauthorize, persistDerived: state.persist }));
vi.mock('../src/summaries', () => ({ exportPath: (c: MemberAccess, name: string) => `families/${c.familyId}/members/${c.memberId}/exports/${c.uid}/${name}` }));
vi.mock('../src/summaries/records', async importOriginal => {
  const original = await importOriginal<typeof import('../src/summaries/records')>();
  return { ...original, readSummaryRecords: async () => ({ schedules: [{ id: 'morning', data: { medicines: [{ id: 'secret', name: 'PRIVATE MEDICINE', count: 2 }] } }], doses: [] }) };
});

import { createDoctorReport } from '../src/reports';
const context = { uid: 'anu', familyId: 'family', memberId: 'amma', isOwner: false, isSupporter: true, sharing: { version: 1, counts: false } } as MemberAccess;
beforeEach(() => { vi.clearAllMocks(); });

it('exports a real private PDF without unshared medicine details and notifies only its viewer', async () => {
  const report = await createDoctorReport(context, '2026-11-07', '2026-11-07', 'en');
  expect(report.pdfUrl).toMatch(/^gs:\/\/private-bucket\/families\/family\/members\/amma\/exports\/anu\/report-/);
  expect(JSON.stringify(report)).not.toContain('PRIVATE MEDICINE');
  const [bytes, options] = state.save.mock.calls[0] as unknown as [Buffer, Record<string, unknown>];
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(options).toMatchObject({ contentType: 'application/pdf', metadata: { cacheControl: 'private, no-store', metadata: { kind: 'pdf', viewerUid: 'anu', sharingVersion: '1' } } });
  expect(state.notify).toHaveBeenCalledWith({}, expect.objectContaining({ recipientIds: ['anu'], kind: 'report' }));
});

it('rejects unsupported Malayalam explicitly before generation or file writes', async () => {
  await expect(createDoctorReport(context, '2026-11-07', '2026-11-07', 'ml')).rejects.toThrow('Malayalam PDF rendering is not supported');
  expect(state.save).not.toHaveBeenCalled();
  expect(state.persist).not.toHaveBeenCalled();
});
