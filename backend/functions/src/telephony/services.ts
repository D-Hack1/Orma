import OpenAI, { toFile } from 'openai';
import { createHash } from 'node:crypto';
import { geminiProvider, openaiProvider } from '../ai/providers';
import { verifyUnderstanding, type UnderstandInput, type UnderstandContext } from '../ai/core';

export async function transcribeRecording(audio: Buffer, signal: AbortSignal): Promise<string> {
  // Twilio produces WAV, whereas the app's public audio contract accepts AAC/OGG only.
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 2800 });
  const result = await client.audio.transcriptions.create({ model: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe', file: await toFile(audio, 'recording.wav', { type: 'audio/wav' }) }, { signal });
  if (!result.text.trim() || result.text.length > 2000) throw new Error('Invalid transcript');
  return result.text;
}
export async function understandRecording(audio: Buffer, input: Omit<UnderstandInput, 'transcript'>, context: UnderstandContext, signal: AbortSignal) {
  const request = { ...input, transcript: await transcribeRecording(audio, signal) };
  try { return verifyUnderstanding(await geminiProvider(request, context, signal), request); }
  catch (error) { if (signal.aborted) throw error; return verifyUnderstanding(await openaiProvider(request, context, signal), request); }
}

export async function promptAudio(text: string, language: string, context: { familyId: string; memberId: string; callId: string }) {
  const modulePath = '../audio/index';
  const audio = await import(modulePath);
  const key = createHash('sha256').update(`${language}\0${text}`).digest('hex');
  const result = await audio.synthesizePrivateAudio(text, { language, path: `families/${context.familyId}/members/${context.memberId}/calls/${context.callId}/${key}.mp3` });
  const url = await audio.createCallAudioUrl(result.path, context);
  if (typeof url !== 'string' || new URL(url).protocol !== 'https:') throw new Error('No playable audio');
  return url;
}
