import { expect, test, vi } from 'vitest';
import { cleanupRecordings } from '../src/telephony/cleanup';

test('recording cleanup retains provider failures and ignores mismatched server bindings', async () => {
  const sid = `CA${'1'.repeat(32)}`;
  const updates = [vi.fn(), vi.fn(), vi.fn()];
  const docs = updates.map((update, index) => ({ id: `RE${String(index).repeat(32)}`,
    ref: { path: `calls/c${index}/recordings/RE${String(index).repeat(32)}`, update }, data: () => ({ providerSid: sid }) }));
  const db = { collectionGroup: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs }) }) }) }),
    doc: (path: string) => ({ get: async () => ({ data: () => ({ providerSid: path.endsWith('c2') ? 'other' : sid }) }) }) } as any;
  const remove = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
  expect(await cleanupRecordings(db, { deleteBoundRecording: remove })).toEqual({ deleted: 1 });
  expect(updates[0]).toHaveBeenCalledWith({ cleanupPending: false, bindingUnverified: false });
  expect(updates[1]).not.toHaveBeenCalled();
  expect(updates[2]).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(2);
});
