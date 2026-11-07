export type Slot = 'morning' | 'noon' | 'night';
export type ReminderInput = { familyId: string; memberId: string; date: string; slot: Slot; attempt: number; generation?: number };
export type Session = ReminderInput & { providerSid: string; phone: string; deviceId: string; kind: 'reminder' | 'callback' | 'consent'; state: 'consent' | 'menu' | 'count' | 'turn' | 'message' | 'done'; step: number; unclearTurns: number; status: string; providerStatus: string; consented: boolean; expiresAt: { toMillis(): number }; language: string };
export const terminal = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled']);
export function nextStatus(current: string, incoming: string): string {
  if (terminal.has(current)) return current;
  if (terminal.has(incoming)) return incoming;
  const rank = ['reserved', 'queued', 'initiated', 'ringing', 'in-progress'];
  return rank.indexOf(incoming) > rank.indexOf(current) ? incoming : current;
}
export function localClock(now: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export function quietNow(minutes: number, quiet: unknown): boolean {
  if (!quiet || typeof quiet !== 'object') return true;
  const q = quiet as { start?: string; end?: string };
  if (![q.start, q.end].every(s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s))) return true;
  const n = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const a = n(q.start!), b = n(q.end!);
  return a === b || (a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b);
}
