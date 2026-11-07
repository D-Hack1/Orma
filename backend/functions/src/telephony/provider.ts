import twilio from 'twilio';
import { timingSafeEqual } from 'node:crypto';

export type TelephonyConfig = { accountSid: string; token: string; from: string; voiceUrl: string; smsUrl: string; allowed: string[] };
export interface TelephonyProvider {
  call(to: string, start: string, status: string): Promise<string>;
  recording(callSid: string, recordingSid: string, signal: AbortSignal): Promise<Buffer>;
  deleteRecording(recordingSid: string): Promise<void>;
}
export function configuration(env = process.env): TelephonyConfig | undefined {
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from, VOICE_PUBLIC_URL: voiceUrl, SMS_PUBLIC_URL: smsUrl } = env;
  const allowed = (env.TWILIO_ALLOWED_NUMBERS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!accountSid || !/^AC[0-9a-f]{32}$/i.test(accountSid) || !token || !from || !voiceUrl || !smsUrl || !allowed.length) return;
  if (![from, ...allowed].every(n => /^\+[1-9]\d{7,14}$/.test(n))) return;
  if (![voiceUrl, smsUrl].every(u => { try { const p = new URL(u); return p.protocol === 'https:' && !p.username && !p.password && !p.search && !p.hash && !u.endsWith('/'); } catch { return false; } })) return;
  return { accountSid, token, from, voiceUrl, smsUrl, allowed };
}
export function validSignature(token: string, signature: string, url: string, form: Record<string, string>): boolean {
  const expected = Buffer.from(twilio.getExpectedTwilioSignature(token, url, form));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
/** Record action callbacks guarantee RecordingUrl, but do not guarantee RecordingSid. */
export function recordingSidFromAction(config: TelephonyConfig, form: Record<string, string>): string {
  const u = new URL(form.RecordingUrl);
  const prefix = `/2010-04-01/Accounts/${config.accountSid}/Recordings/`;
  if (u.protocol !== 'https:' || u.hostname !== 'api.twilio.com' || u.port || u.username || u.password || u.search || u.hash || !u.pathname.startsWith(prefix)) throw new Error('Invalid recording URL');
  const sid = u.pathname.slice(prefix.length);
  if (!/^RE[0-9a-f]{32}$/i.test(sid) || (form.RecordingSid !== undefined && form.RecordingSid !== sid)) throw new Error('Invalid recording SID');
  return sid;
}
export class TwilioProvider implements TelephonyProvider {
  private client;
  constructor(private config: TelephonyConfig) { this.client = twilio(config.accountSid, config.token, { autoRetry: false, timeout: 2500 }); }
  async call(to: string, url: string, statusCallback: string) {
    if (!this.config.allowed.includes(to)) throw new Error('Number not allowed');
    return (await this.client.calls.create({ to, from: this.config.from, url, method: 'POST', statusCallback, statusCallbackMethod: 'POST', statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'], timeout: 30 })).sid;
  }
  async recording(callSid: string, recordingSid: string, signal: AbortSignal) {
    await this.verifyRecording(callSid, recordingSid, signal);
    const root = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Recordings/${recordingSid}`;
    const headers = { Authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.token}`).toString('base64')}` };
    const media = await fetch(`${root}.wav`, { headers, signal, redirect: 'error' });
    if (!media.ok) throw new Error('Recording unavailable');
    return boundedBody(media, 1048576);
  }
  private async verifyRecording(callSid: string, recordingSid: string, signal: AbortSignal, allowMissing = false) {
    if (!/^CA[0-9a-f]{32}$/i.test(callSid) || !/^RE[0-9a-f]{32}$/i.test(recordingSid)) throw new Error('Invalid recording');
    const root = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Recordings/${recordingSid}`;
    const headers = { Authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.token}`).toString('base64')}` };
    // Never use RecordingUrl supplied by a webhook, and never follow provider redirects.
    const metadata = await fetch(`${root}.json`, { headers, signal, redirect: 'error' });
    if (allowMissing && metadata.status === 404) return false;
    if (!metadata.ok || Number(metadata.headers.get('content-length')) > 16384) throw new Error('Recording unavailable');
    const details = await boundedBody(metadata, 16384);
    if (JSON.parse(details.toString()).call_sid !== callSid) throw new Error('Recording belongs to another call');
    return true;
  }
  async deleteRecording(sid: string) { await this.client.recordings(sid).remove(); }
  async deleteBoundRecording(callSid: string, sid: string, signal: AbortSignal) {
    if (await this.verifyRecording(callSid, sid, signal, true)) await this.deleteRecording(sid);
  }
}
export async function boundedBody(response: Response, max: number): Promise<Buffer> {
  if (!response.body) throw new Error('Empty recording');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > max) throw new Error('Recording too large'); chunks.push(chunk.value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
