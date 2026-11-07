import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { app } from './firebase';
import { requireAuth, resolveMemberAccess, sharingAllowed, type MemberAccess } from './auth';

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 6 * 1024 * 1024; // Base64 stays below the callable's 10 MiB response limit.
const mimeTypes = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg'],
  pdf: ['application/pdf'],
};

/** Reject encoded separators, dot segments and URL query/token forms before touching Storage. */
export function privateMediaPath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\%?#\s\u0000-\u001f]/u.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new HttpsError('invalid-argument', 'Invalid private media path.');
  }
  return value;
}

export function mediaBucket() { return getStorage(app).bucket(); }

export function privateGsPath(url: string): string {
  const bucket = mediaBucket();
  if (typeof url !== 'string' || !url.startsWith(`gs://${bucket.name}/`)) {
    throw new HttpsError('invalid-argument', 'Only the configured private Storage bucket is allowed.');
  }
  return privateMediaPath(url.slice(`gs://${bucket.name}/`.length));
}

async function current(context: MemberAccess, kind: 'image' | 'audio') {
  const fresh = await resolveMemberAccess(context.uid, context.familyId, context.memberId);
  if (!sharingAllowed(fresh, kind === 'image' ? 'counts' : 'messages')) {
    throw new HttpsError('permission-denied', 'This media is not currently shared.');
  }
  return fresh;
}

/** Generation pinning prevents a metadata/download race; stream bounds apply even to dishonest metadata. */
export async function readPrivateObject(path: string, kind: keyof typeof mimeTypes, maxBytes = MAX_MEDIA_BYTES) {
  const bucket = mediaBucket();
  const [metadata] = await bucket.file(path).getMetadata();
  const size = Number(metadata.size);
  const mimeType = metadata.contentType ?? '';
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes ||
      !(mimeTypes[kind] as readonly string[]).includes(mimeType) || !metadata.generation ||
      metadata.metadata?.firebaseStorageDownloadTokens) {
    throw new HttpsError('failed-precondition', 'Invalid private media size, MIME type or metadata.');
  }
  const stream = bucket.file(path, { generation: metadata.generation }).createReadStream({ decompress: false });
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > maxBytes || length > size) {
      stream.destroy();
      throw new HttpsError('resource-exhausted', 'Media is too large.');
    }
    chunks.push(bytes);
  }
  if (length !== size) throw new HttpsError('data-loss', 'Incomplete private media.');
  return { bytes: Buffer.concat(chunks), mimeType, metadata };
}

export async function readAuthorizedMedia(context: MemberAccess, gsUrl: string, kind: 'image' | 'audio'): Promise<{ bytes: Buffer; mimeType: string }> {
  const path = privateGsPath(gsUrl);
  const parts = path.split('/');
  if (parts.length !== 6 || parts[0] !== 'families' || parts[1] !== context.familyId ||
      parts[2] !== 'members' || parts[3] !== context.memberId || parts[4] !== 'uploads') {
    throw new HttpsError('permission-denied', 'Media must be this member’s immutable upload.');
  }
  await current(context, kind);
  const { bytes, mimeType } = await readPrivateObject(path, kind);
  await current(context, kind);
  return { bytes, mimeType };
}

export async function readDerivedMedia(uid: string, gsUrl: string) {
  const path = privateGsPath(gsUrl);
  const parts = path.split('/');
  if (parts.length < 7 || parts[0] !== 'families' || parts[2] !== 'members' || parts[4] !== 'exports' || parts[5] !== uid) {
    throw new HttpsError('permission-denied', 'Export does not belong to this viewer.');
  }
  const [before] = await mediaBucket().file(path).getMetadata();
  const kind = before.metadata?.kind;
  if (kind !== 'audio' && kind !== 'pdf' && kind !== 'image') throw new HttpsError('failed-precondition', 'Invalid export kind.');
  const check = async (metadata: typeof before) => {
    const context = await resolveMemberAccess(uid, parts[1], parts[3]);
    const tags = metadata.metadata;
    if (tags?.familyId !== parts[1] || tags?.memberId !== parts[3] || tags?.viewerUid !== uid ||
        tags?.kind !== kind || String(tags?.sharingVersion) !== String(context.sharing.version ?? 0)) {
      throw new HttpsError('permission-denied', 'Export sharing has changed. Generate a new export.');
    }
  };
  await check(before);
  const result = await readPrivateObject(path, kind, MAX_DOWNLOAD_BYTES);
  await check(result.metadata);
  // No bearer URL: each download rechecks current membership and sharing immediately before returning bytes.
  return { bytes: result.bytes, mimeType: result.mimeType };
}

export const downloadMedia = onCall({ region: 'asia-south1', enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' }, async request => {
  const uid = requireAuth(request);
  if (!request.data || typeof request.data.gsUrl !== 'string' || Object.keys(request.data).some(key => key !== 'gsUrl')) {
    throw new HttpsError('invalid-argument', 'Provide a private gsUrl.');
  }
  const { bytes, mimeType } = await readDerivedMedia(uid, request.data.gsUrl);
  return { bytesBase64: bytes.toString('base64'), mimeType };
});
