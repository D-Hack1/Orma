import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwilioProvider, recordingSidFromAction, type TelephonyConfig } from '../src/telephony/provider';

const accountSid = `AC${'a'.repeat(32)}`, callSid = `CA${'1'.repeat(32)}`, recordingSid = `RE${'2'.repeat(32)}`;
const config: TelephonyConfig = { accountSid, token: 'secret', from: '+15005550006', allowed: ['+919876543210'], voiceUrl: 'https://example.test/voice', smsUrl: 'https://example.test/sms' };
afterEach(() => { vi.unstubAllGlobals(); });
describe('Twilio media isolation', () => {
  it('derives the action SID only from the configured account canonical URL', () => {
    const RecordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}`;
    expect(recordingSidFromAction(config, { RecordingUrl })).toBe(recordingSid);
    expect(() => recordingSidFromAction(config, { RecordingUrl, RecordingSid: `RE${'3'.repeat(32)}` })).toThrow();
    for (const url of [RecordingUrl.replace(accountSid, `AC${'b'.repeat(32)}`), RecordingUrl.replace('api.twilio.com', 'api.twilio.com.evil.test'), `${RecordingUrl}?redirect=http://localhost`, RecordingUrl.replace('https://', 'http://'), `${RecordingUrl}/anything`]) expect(() => recordingSidFromAction(config, { RecordingUrl: url })).toThrow();
  });
  it('constructs authenticated allowlisted URLs and forbids redirects', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ call_sid: callSid }))).mockResolvedValueOnce(new Response('wav'));
    vi.stubGlobal('fetch', fetcher);
    const audio = await new TwilioProvider(config).recording(callSid, recordingSid, AbortSignal.timeout(1000));
    expect(audio.toString()).toBe('wav');
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toMatch(new RegExp(`^https://api\\.twilio\\.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}\\.(json|wav)$`));
      expect(options.redirect).toBe('error'); expect(options.headers.Authorization).toBe(`Basic ${Buffer.from(`${accountSid}:secret`).toString('base64')}`);
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it('rejects cross-call recordings before fetching audio', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ call_sid: 'other-call' })));
    vi.stubGlobal('fetch', fetcher);
    await expect(new TwilioProvider(config).recording(callSid, recordingSid, AbortSignal.timeout(1000))).rejects.toThrow('another call'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects URL-like recording identifiers before a network request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(new TwilioProvider(config).recording(callSid, 'https://evil.test/', AbortSignal.timeout(1000))).rejects.toThrow('Invalid recording'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects oversized recording streams', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ call_sid: callSid }))).mockResolvedValueOnce(new Response(new Uint8Array(1048577))));
    await expect(new TwilioProvider(config).recording(callSid, recordingSid, AbortSignal.timeout(1000))).rejects.toThrow('too large');
  });
  it('honors the caller deadline during provider access', async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => { if (options.signal.aborted) throw new Error('aborted'); throw new Error('unexpected'); }));
    await expect(new TwilioProvider(config).recording(callSid, recordingSid, controller.signal)).rejects.toThrow('aborted');
  });
  it('deletes pending recordings only after verifying the call binding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ call_sid: callSid }))));
    const provider = new TwilioProvider(config);
    const remove = vi.spyOn(provider, 'deleteRecording').mockResolvedValue(undefined);
    await provider.deleteBoundRecording(callSid, recordingSid, AbortSignal.timeout(1000));
    expect(remove).toHaveBeenCalledWith(recordingSid);
    remove.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ call_sid: 'different-call' }))));
    await expect(provider.deleteBoundRecording(callSid, recordingSid, AbortSignal.timeout(1000))).rejects.toThrow('another call');
    expect(remove).not.toHaveBeenCalled();
  });
  it('treats an already deleted recording as a successful cleanup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const provider = new TwilioProvider(config);
    const remove = vi.spyOn(provider, 'deleteRecording').mockResolvedValue(undefined);
    await provider.deleteBoundRecording(callSid, recordingSid, AbortSignal.timeout(1000));
    expect(remove).not.toHaveBeenCalled();
  });
});
