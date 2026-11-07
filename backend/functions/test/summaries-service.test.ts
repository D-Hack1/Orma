import { beforeEach, expect, it, vi } from 'vitest';
import type { MemberAccess } from '../src/platform/auth';

const state = vi.hoisted(() => ({ version: 1, audioFails: false, revokeDuringAudio: false,
  persist: vi.fn(), notify: vi.fn(async () => []), delete: vi.fn(async () => undefined), metadata: vi.fn(async () => undefined) }));
vi.mock('../src/platform/firebase', () => ({ db: {} }));
vi.mock('../src/alerts', () => ({ routeNotification: state.notify }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ name: 'private-bucket', file: () => ({ bucket: { name: 'private-bucket' }, setMetadata: state.metadata, delete: state.delete }) }) }) }));
vi.mock('../src/audio', () => ({ synthesizePrivateAudio: async () => {
  if (state.revokeDuringAudio) state.version++;
  if (state.audioFails) throw Error('TTS unavailable');
  return { path: 'unused' };
} }));
vi.mock('../src/answers', () => ({ geminiAnswerGenerator: async () => { throw Error('offline'); }, sharingVersion: (c: MemberAccess) => c.sharing.version,
  reauthorize: async (c: MemberAccess) => { if (c.sharing.version !== state.version) throw Error('Sharing changed'); return c; },
  persistDerived: state.persist,
}));
vi.mock('../src/summaries/records', async importOriginal => {
  const original = await importOriginal<typeof import('../src/summaries/records')>();
  return { ...original, readSummaryRecords: async () => ({ schedules: [{ id: 'morning', data: {} }], doses: [] }) };
});

import { createDailyDigest } from '../src/summaries';
const context = { uid: 'anu', familyId: 'family', memberId: 'amma', sharing: { version: 1 } } as MemberAccess;
beforeEach(() => { state.version = 1; state.audioFails = false; state.revokeDuringAudio = false; vi.clearAllMocks(); });

it('saves a viewer-scoped private audio URL and sends a privacy-safe notification', async () => {
  const digest = await createDailyDigest(context, '2026-11-07', 'en');
  expect(digest.audioUrl).toMatch(/^gs:\/\/private-bucket\/families\/family\/members\/amma\/exports\/anu\/digest-/);
  expect(state.metadata.mock.calls[0][0]).toMatchObject({ metadata: { sharingVersion: '1', viewerUid: 'anu', kind: 'audio' } });
  expect(state.persist).toHaveBeenCalledWith(context, 'digests', '2026-11-07_anu_en', expect.objectContaining({ sentTo: [], language: 'en' }));
  expect(state.notify).toHaveBeenCalledWith({}, expect.objectContaining({ recipientIds: ['anu'], kind: 'report' }));
});

it('returns cited text when optional TTS fails', async () => {
  state.audioFails = true;
  const digest = await createDailyDigest(context, '2026-11-07', 'ml');
  expect(digest.audioUrl).toBeUndefined();
  expect(digest.sentences).toHaveLength(1);
  expect(state.persist).toHaveBeenCalledOnce();
});

it('deletes and rejects stale audio rather than tagging it with a newer sharing version', async () => {
  state.revokeDuringAudio = true;
  await expect(createDailyDigest(context, '2026-11-07', 'en')).rejects.toThrow('Sharing changed');
  expect(state.delete).toHaveBeenCalledOnce();
  expect(state.persist).not.toHaveBeenCalled();
  expect(state.metadata).not.toHaveBeenCalled();
  expect(state.notify).not.toHaveBeenCalled();
});
