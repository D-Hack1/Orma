import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(), aggregate: vi.fn(), latest: vi.fn(),
  db: { doc: vi.fn() },
}));
vi.mock('../src/platform/firebase', () => ({ db: mocks.db }));
vi.mock('../src/platform/auth', () => ({ requireAuth: (request: any) => {
  if (!request.auth) throw new Error('unauthenticated');
  return request.auth.uid;
} }));
vi.mock('../src/fl/core', () => ({ submitUpdate: mocks.submit, aggregateRound: mocks.aggregate, submitSimulatedUpdate: vi.fn() }));
vi.mock('firebase-functions/params', () => ({ defineSecret: (name: string) => ({ name, value: () => 'secret-manager-value' }) }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (options: unknown, handler: unknown) => ({ options, handler }) }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (options: unknown, handler: unknown) => ({ options, handler }) }));

import { flSubmit, flAggregate } from '../src/fl';

it('binds the server secret, enforces App Check outside emulator and uses only Auth UID', async () => {
  const callable = flSubmit as unknown as { options: any; handler: (request: any) => Promise<any> };
  expect(callable.options.secrets[0].name).toBe('FL_PSEUDONYM_KEY');
  expect(callable.options.enforceAppCheck).toBe(process.env.FUNCTIONS_EMULATOR !== 'true');
  const data = { deviceId: 'phone', uid: 'attacker' };
  await callable.handler({ auth: { uid: 'verified-owner' }, data });
  expect(mocks.submit).toHaveBeenCalledWith(mocks.db, 'verified-owner', data, 'secret-manager-value');
  expect(() => callable.handler({ data })).toThrow('unauthenticated');
});

it('registers aggregation only as a schedule, derives next round from latest model', async () => {
  const scheduled = flAggregate as unknown as { options: any; handler: () => Promise<void> };
  expect(scheduled.options.schedule).toBe('every 5 minutes');
  mocks.db.doc.mockReturnValue({ get: mocks.latest });
  mocks.latest.mockResolvedValue({ data: () => ({ version: 'opaque-string', round: 37 }) });
  await scheduled.handler();
  expect(mocks.db.doc).toHaveBeenCalledWith('flModels/latest');
  expect(mocks.aggregate).toHaveBeenCalledWith(mocks.db, 38);
});
