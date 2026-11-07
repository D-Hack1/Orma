import { expect, test } from 'vitest';
import * as handlers from '../src';

test('the deployable entry point exposes every independently built endpoint without provider credentials', () => {
  expect(Object.keys(handlers).sort()).toEqual([
    'setSharing', 'logDose', 'askStatus', 'answer', 'explain', 'understand',
    'parsePrescription', 'confirmPrescription', 'checkStrip', 'checkPillbox',
    'voice', 'sms', 'doseSweep', 'retryCall', 'escalate', 'ackAlert', 'alertCreated',
    'sendMessage', 'snooze', 'explainMedicine', 'dailyDigest', 'dailyDigestScheduled',
    'doctorReport', 'downloadMedia', 'flSubmit', 'flAggregate',
  ].sort());
  for (const handler of Object.values(handlers)) {
    expect(typeof handler).toBe('function');
    expect((handler as any).__endpoint.region).toEqual(['asia-south1']);
  }
});

test('every caller of the Twilio delivery adapter binds its Secret Manager token', () => {
  for (const name of ['voice', 'sms', 'retryCall', 'escalate', 'sendMessage', 'dailyDigest', 'dailyDigestScheduled', 'doctorReport'] as const) {
    expect((handlers[name] as any).__endpoint.secretEnvironmentVariables).toContainEqual({ key: 'TWILIO_AUTH_TOKEN' });
  }
});

test('task handlers stay private and trusted aggregation helpers are not public endpoints', () => {
  for (const name of ['retryCall', 'escalate'] as const) expect((handlers[name] as any).__endpoint.taskQueueTrigger.invoker).toEqual(['private']);
  expect(handlers).not.toHaveProperty('aggregateRound');
  expect(handlers).not.toHaveProperty('submitSimulatedUpdate');
  expect(handlers).not.toHaveProperty('sendCallMessageService');
});
