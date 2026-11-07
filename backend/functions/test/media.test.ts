import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAll: vi.fn(), metadata: vi.fn(), stream: vi.fn(), file: vi.fn() }));
vi.mock('../src/platform/firebase', () => ({ app: {}, db: {
  getAll: mocks.getAll,
  doc: (path: string) => ({ path, collection: (name: string) => ({ doc: (id: string) => ({ path: `${path}/${name}/${id}` }) }) }),
} }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ name: 'private-bucket', file: mocks.file }) }) }));
import { resolveMemberAccess } from '../src/platform/auth';
import { MAX_DOWNLOAD_BYTES, readAuthorizedMedia, readDerivedMedia } from '../src/platform/media';

const gs = 'gs://private-bucket/families/f/members/m/uploads/photo.jpg';
const exportGs = 'gs://private-bucket/families/f/members/m/exports/u/report.pdf';
let access: Record<string, unknown>;
let member: Record<string, unknown>;
let sharing: Record<string, unknown>;
let metadata: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  access = { active: true, memberIds: ['m'], roles: ['supporter'] };
  member = { ownerUid: 'owner', nurseIds: [] };
  sharing = { version: 2, counts: true, messages: false };
  mocks.getAll.mockImplementation(async () => [access, member, sharing].map(data => ({ exists: true, data: () => ({ ...data }) })));
  metadata = { size: '3', contentType: 'image/jpeg', generation: '123' };
  mocks.metadata.mockImplementation(async () => [metadata]);
  mocks.stream.mockImplementation(() => Readable.from([Buffer.from('abc')]));
  mocks.file.mockImplementation(() => ({ getMetadata: mocks.metadata, createReadStream: mocks.stream }));
});

describe('authorized immutable member uploads', () => {
  it('pins the configured bucket generation and returns bounded bytes', async () => {
    const context = await resolveMemberAccess('u', 'f', 'm');
    expect(await readAuthorizedMedia(context, gs, 'image')).toEqual({ bytes: Buffer.from('abc'), mimeType: 'image/jpeg' });
    expect(mocks.file).toHaveBeenCalledWith('families/f/members/m/uploads/photo.jpg', { generation: '123' });
    expect(mocks.getAll).toHaveBeenCalledTimes(3);
  });

  it.each([
    'https://storage.googleapis.com/private-bucket/families/f/members/m/uploads/photo.jpg',
    'gs://evil/families/f/members/m/uploads/photo.jpg',
    'gs://private-bucket/families/other/members/m/uploads/photo.jpg',
    'gs://private-bucket/families/f/members/other/uploads/photo.jpg',
    'gs://private-bucket/families/f/members/m/uploads/../x',
    'gs://private-bucket/families/f/members/m/uploads/%2e%2e',
    'gs://private-bucket/families/f/members/m/uploads/photo.jpg?token=public',
    'gs://private-bucket/families/f/members/m/uploads/a/b.jpg',
    'gs://private-bucket/families/f/members/m/exports/u/x.jpg',
  ])('rejects malicious or cross-member input %s', async url => {
    const context = await resolveMemberAccess('u', 'f', 'm');
    await expect(readAuthorizedMedia(context, url, 'image')).rejects.toThrow();
    expect(mocks.metadata).not.toHaveBeenCalled();
  });

  it.each([{ size: '10485761' }, { size: 'NaN' }, { size: '0' }, { contentType: 'image/svg+xml' }, { contentType: 'application/pdf' }, { metadata: { firebaseStorageDownloadTokens: 'token' } }])('rejects invalid size/MIME/token metadata %j', async invalid => {
    Object.assign(metadata, invalid);
    await expect(readAuthorizedMedia(await resolveMemberAccess('u', 'f', 'm'), gs, 'image')).rejects.toThrow();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('bounds bytes even if object size is dishonest', async () => {
    mocks.stream.mockImplementation(() => Readable.from([Buffer.from('abcd')]));
    await expect(readAuthorizedMedia(await resolveMemberAccess('u', 'f', 'm'), gs, 'image')).rejects.toThrow('Media is too large');
  });

  it('does not let a guardian bypass image or audio sharing', async () => {
    access.roles = [];
    sharing = { version: 2, guardianId: 'u', capacityNote: 'Recorded', counts: false, messages: false };
    const context = await resolveMemberAccess('u', 'f', 'm');
    expect(context.isGuardian).toBe(true);
    await expect(readAuthorizedMedia(context, gs, 'image')).rejects.toThrow('not currently shared');
    await expect(readAuthorizedMedia(context, gs, 'audio')).rejects.toThrow('not currently shared');
  });

  it('requires messages sharing for assigned nurses, but permits the owner', async () => {
    access.roles = ['nurse']; member.nurseIds = ['u']; metadata.contentType = 'audio/mpeg';
    await expect(readAuthorizedMedia(await resolveMemberAccess('u', 'f', 'm'), gs, 'audio')).rejects.toThrow();
    sharing.messages = true;
    expect((await readAuthorizedMedia(await resolveMemberAccess('u', 'f', 'm'), gs, 'audio')).mimeType).toBe('audio/mpeg');
    member.ownerUid = 'u'; sharing.messages = false;
    expect((await readAuthorizedMedia(await resolveMemberAccess('u', 'f', 'm'), gs, 'audio')).bytes.length).toBe(3);
  });

  it('rechecks revocation after downloading instead of trusting the supplied context', async () => {
    const context = await resolveMemberAccess('u', 'f', 'm');
    mocks.stream.mockImplementation(() => { access.active = false; return Readable.from([Buffer.from('abc')]); });
    await expect(readAuthorizedMedia(context, gs, 'image')).rejects.toThrow('not allowed');
  });
});

describe('revocable viewer downloads', () => {
  beforeEach(() => { metadata.contentType = 'application/pdf'; metadata.metadata = { familyId: 'f', memberId: 'm', viewerUid: 'u', sharingVersion: '2', kind: 'pdf' }; });
  it('returns bytes only for a current matching viewer and version', async () => {
    expect((await readDerivedMedia('u', exportGs)).mimeType).toBe('application/pdf');
    await expect(readDerivedMedia('other', exportGs)).rejects.toThrow('does not belong');
  });
  it.each(['familyId', 'memberId', 'viewerUid', 'sharingVersion', 'kind'])('rejects mismatched %s metadata', async field => {
    (metadata.metadata as Record<string, string>)[field] = 'wrong';
    await expect(readDerivedMedia('u', exportGs)).rejects.toThrow();
  });
  it('rejects too-large base64 callable responses before reading', async () => {
    metadata.size = MAX_DOWNLOAD_BYTES + 1;
    await expect(readDerivedMedia('u', exportGs)).rejects.toThrow('size');
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(Math.ceil(MAX_DOWNLOAD_BYTES / 3) * 4 + 1024).toBeLessThan(10 * 1024 * 1024);
  });
  it('blocks owner downloads too when the export version was revoked mid-read', async () => {
    member.ownerUid = 'u';
    mocks.stream.mockImplementation(() => { sharing.version = 3; return Readable.from([Buffer.from('abc')]); });
    await expect(readDerivedMedia('u', exportGs)).rejects.toThrow('sharing has changed');
  });
});
