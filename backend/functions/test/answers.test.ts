import { beforeEach, expect, it, vi } from 'vitest';
import type { MemberAccess } from '../src/platform/auth';
import { answerFromFacts, type FactPack } from '../src/replies/core';

const state = vi.hoisted(() => ({ version: 3, active: true, assigned: true, calls: [] as unknown[], writes: [] as { path: string; value: unknown }[] }));
const ref = (path: string): any => ({ path, collection: (name: string) => ({ doc: (id = 'answer-id') => ref(`${path}/${name}/${id}`) }) });
const snapshot = (path: string) => ({ data: () => path.endsWith('/sharing') ? { version: state.version } : path.includes('/access/') ? { active: state.active, roles: ['nurse'], memberIds: ['amma'] } : { ownerUid: 'amma', nurseIds: state.assigned ? ['mini'] : [] } });
vi.mock('../src/platform/firebase', () => ({ db: {
  doc: (path: string) => ({ path }), collection: () => ({ doc: () => ({ id: 'answer-id' }) }),
  runTransaction: async (fn: any) => fn({ get: async (reference: { path: string }) => snapshot(reference.path), set: (reference: { path: string }, value: unknown) => state.writes.push({ path: reference.path, value }) }),
} }));
vi.mock('../src/platform/auth', () => ({ resolveMemberAccess: async () => {
  if (!state.active || !state.assigned) throw Error('revoked');
  return { sharing: { version: state.version } };
} }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: async (input: unknown) => { state.calls.push(input); return { text: JSON.stringify({ insufficient: false, sentences: [{ text: 'Invented at 09:15.', cites: ['fake'] }] }) }; } }; } }));

import { geminiAnswerGenerator, persistAnswer } from '../src/answers';

const context = { uid: 'mini', familyId: 'family', memberId: 'amma', memberRef: ref('families/family/members/amma'), sharing: { version: 3 }, isOwner: false } as MemberAccess;
beforeEach(() => { state.version = 3; state.active = true; state.assigned = true; state.calls = []; state.writes = []; });

it('passes only supplied approved facts to Gemini and rejects fabricated results', async () => {
  const pack: FactPack = { status: 'unknown', facts: [{ id: 'lookup:today', kind: 'status', textEn: 'Unknown. Please wait.', textMl: 'വ്യക്തമല്ല.' }] };
  const result = await answerFromFacts(pack, geminiAnswerGenerator);
  expect(result.fallbackUsed).toBe(true);
  expect(result.sentences).toEqual([]);
  expect(JSON.stringify(state.calls[0])).toContain('lookup:today');
  expect(JSON.stringify(state.calls[0])).not.toContain('medicinesTaken');
});

it('persists only the supplied viewer answer to canonical and viewer-version-gated paths', async () => {
  expect(await persistAnswer(context, { sentences: [], fallbackUsed: true }, 'Did I?')).toBe('answer-id');
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1].path).toBe('families/family/views/mini/members/amma/answers/answer-id');
  expect(state.writes[1].value).toMatchObject({ sharingVersion: 3, viewerUid: 'mini', question: 'Did I?' });
});

it.each(['version', 'membership', 'assignment'])('rejects %s revocation outside the generator fallback boundary', async kind => {
  if (kind === 'version') state.version = 4;
  if (kind === 'membership') state.active = false;
  if (kind === 'assignment') state.assigned = false;
  await expect(persistAnswer(context, { sentences: [] })).rejects.toThrow();
  expect(state.writes).toEqual([]);
});
