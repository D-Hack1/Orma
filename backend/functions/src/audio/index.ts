import { createHash } from 'node:crypto';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../platform/firebase';
import { documentId, resolveMemberAccess } from '../platform/auth';
import { MAX_DOWNLOAD_BYTES, mediaBucket, privateMediaPath, readPrivateObject } from '../platform/media';

let client: TextToSpeechClient | undefined;
const inFlight = new Map<string, Promise<{ path: string }>>();
// Enrollment may play only this nonclinical consent prompt before consent exists.
const consentHashes = new Set([
  ['en-IN', 'Press 1 to agree to reminder calls. Press any other key to decline.'],
  ['ml-IN', 'മരുന്ന് ഓർമ്മിപ്പിക്കുന്ന വിളികൾ സ്വീകരിക്കാൻ സമ്മതമെങ്കിൽ 1 അമർത്തുക.'],
].map(([language, text]) => createHash('sha256').update(`${language}\0${text}`).digest('hex')));

function languageCode(language: string): string {
  if (language === 'ml') return 'ml-IN';
  if (language === 'en') return 'en-IN';
  if (typeof language !== 'string' || !/^[a-z]{2,3}-[A-Z]{2}$/.test(language)) throw new HttpsError('invalid-argument', 'Use a recipient language such as ml-IN.');
  return language;
}

function pathContext(path: string) {
  const parts = privateMediaPath(path).split('/');
  if (parts.length === 4 && parts[0] === 'audio' && parts[1] === 'prompts' && path.endsWith('.mp3')) return { type: 'prompt' as const };
  if (parts.length < 7 || parts[0] !== 'families' || parts[2] !== 'members' || !path.endsWith('.mp3')) throw new HttpsError('invalid-argument', 'Invalid private audio path.');
  const [, familyId, , memberId, type, id] = parts;
  [familyId, memberId, id].forEach(value => documentId(value, 'audio path identifier'));
  if (type === 'exports') return { type: 'export' as const, familyId, memberId, viewerUid: id };
  if (type === 'calls' && parts.length === 7) return { type: 'call' as const, familyId, memberId, callId: id };
  throw new HttpsError('invalid-argument', 'Invalid private audio path.');
}

async function activeCall(familyId: string, memberId: string, callId: string, contentHash?: string) {
  [familyId, memberId, callId].forEach(value => documentId(value, 'call identifier'));
  const call = (await db.doc(`calls/${callId}`).get()).data();
  const expires = call?.expiresAt?.toMillis?.();
  const enrollment = call?.kind === 'consent' && call?.state === 'consent' && consentHashes.has(contentHash ?? '');
  if (call?.familyId !== familyId || call?.memberId !== memberId || call?.status !== 'active' || (call?.consented !== true && !enrollment) ||
      typeof expires !== 'number' || expires <= Date.now()) throw new HttpsError('permission-denied', 'No active consented call.');
  return expires;
}

export async function synthesizePrivateAudio(text: string, options: { language: string; path: string }): Promise<{ path: string }> {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 5000) throw new HttpsError('invalid-argument', 'Provide at most 5000 UTF-8 bytes of speech.');
  const language = languageCode(options.language);
  const path = privateMediaPath(options.path);
  const context = pathContext(path);
  const hash = createHash('sha256').update(`${language}\0${text}`).digest('hex');
  const key = `${path}:${hash}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const work = async () => {
    const tags: Record<string, string> = { kind: 'audio', language, contentHash: hash };
    if (context.type === 'export') {
      const access = await resolveMemberAccess(context.viewerUid, context.familyId, context.memberId);
      Object.assign(tags, { familyId: context.familyId, memberId: context.memberId, viewerUid: context.viewerUid, sharingVersion: String(access.sharing.version ?? 0) });
    } else if (context.type === 'call') {
      await activeCall(context.familyId, context.memberId, context.callId, hash);
      Object.assign(tags, { familyId: context.familyId, memberId: context.memberId, callId: context.callId });
    }
    const file = mediaBucket().file(path);
    let cached = false;
    try {
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.contentHash !== hash || metadata.metadata?.language !== language || metadata.contentType !== 'audio/mpeg' ||
          metadata.metadata?.firebaseStorageDownloadTokens || Object.entries(tags).some(([key, value]) => metadata.metadata?.[key] !== value) ||
          !(Number(metadata.size) > 0 && Number(metadata.size) <= MAX_DOWNLOAD_BYTES)) {
        throw new HttpsError('already-exists', 'Use a new path for different audio or sharing versions.');
      }
      cached = true;
    } catch (error) {
      if ((error as { code?: number }).code !== 404) throw error;
    }
    if (!cached) {
      let bytes: Buffer | undefined;
      if (context.type === 'call') {
        const promptPath = `audio/prompts/${language}/${hash}.mp3`;
        try {
          const result = await readPrivateObject(promptPath, 'audio', MAX_DOWNLOAD_BYTES);
          const prompt = result.metadata;
          if (prompt.metadata?.contentHash !== hash || prompt.metadata?.language !== language || prompt.contentType !== 'audio/mpeg') throw new HttpsError('failed-precondition', 'Invalid cached prompt.');
          bytes = result.bytes;
        } catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
      }
      if (!bytes) {
        client ??= new TextToSpeechClient();
        // Cached prompts avoid the live call budget; the SDK deadline is a target, not a latency guarantee.
        const [result] = await client.synthesizeSpeech({ input: { text }, voice: { languageCode: language }, audioConfig: { audioEncoding: 'MP3' } }, { timeout: 3500, retry: null });
        bytes = typeof result.audioContent === 'string' ? Buffer.from(result.audioContent, 'base64') : Buffer.from(result.audioContent ?? []);
      }
      if (!bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) throw new HttpsError('resource-exhausted', 'Invalid TTS output size.');
      await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'audio/mpeg', cacheControl: 'private, no-store', metadata: tags } });
    }
    if (context.type === 'export') {
      const fresh = await resolveMemberAccess(context.viewerUid, context.familyId, context.memberId);
      if (String(fresh.sharing.version ?? 0) !== tags.sharingVersion) throw new HttpsError('permission-denied', 'Sharing changed during audio generation.');
    } else if (context.type === 'call') await activeCall(context.familyId, context.memberId, context.callId, hash);
    return { path };
  };
  const pending = work();
  inFlight.set(key, pending);
  try { return await pending; } finally { inFlight.delete(key); }
}

export async function createCallAudioUrl(path: string, context: { familyId: string; memberId: string; callId: string }): Promise<string> {
  const audio = pathContext(path);
  if (audio.type === 'export' || (audio.type === 'call' && (audio.familyId !== context.familyId || audio.memberId !== context.memberId || audio.callId !== context.callId))) {
    throw new HttpsError('permission-denied', 'Audio is not bound to this call.');
  }
  const file = mediaBucket().file(path);
  const [metadata] = await file.getMetadata();
  const contentHash = metadata.metadata?.contentHash;
  if (typeof contentHash !== 'string') throw new HttpsError('failed-precondition', 'Missing audio content hash.');
  await activeCall(context.familyId, context.memberId, context.callId, contentHash);
  if (metadata.contentType !== 'audio/mpeg' || !metadata.generation || metadata.metadata?.firebaseStorageDownloadTokens ||
      !(Number(metadata.size) > 0 && Number(metadata.size) <= MAX_DOWNLOAD_BYTES) ||
      (audio.type === 'call' && (metadata.metadata?.familyId !== context.familyId || metadata.metadata?.memberId !== context.memberId || metadata.metadata?.callId !== context.callId))) {
    throw new HttpsError('failed-precondition', 'Invalid call audio metadata.');
  }
  const sessionExpiry = await activeCall(context.familyId, context.memberId, context.callId, contentHash);
  // shortcut: a signed URL remains usable after revocation for at most 30 seconds; use an authenticated proxy for immediate revocation.
  const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Math.min(Date.now() + 30_000, sessionExpiry), queryParams: { generation: String(metadata.generation) } });
  await activeCall(context.familyId, context.memberId, context.callId, contentHash);
  return url;
}
