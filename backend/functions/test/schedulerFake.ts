import type { Firestore } from 'firebase-admin/firestore';

export function memoryDb(initial: Record<string, object>) {
  const records = new Map<string, any>(Object.entries(initial));
  let tail = Promise.resolve();
  const snapshot = (path: string): any => ({ id: path.split('/').at(-1), ref: doc(path), exists: records.has(path), data: () => records.get(path) });
  const collection = (path: string, filter?: [string, unknown]): any => ({
    queryPath: path,
    doc: (id: string) => doc(`${path}/${id}`),
    where: (field: string, _operator: string, value: unknown) => collection(path, [field, value]),
    get: async () => ({ docs: [...records.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 && (!filter || records.get(key)[filter[0]] === filter[1])).map(snapshot) }),
  });
  const doc = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path), collection: (name: string) => collection(`${path}/${name}`), set: async (value: object) => { records.set(path, value); } });
  const db = {
    doc, collection, getAll: async (...refs: any[]) => refs.map(ref => snapshot(ref.path)),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      let writing = false;
      const read = (ref: any) => { if (writing) throw new Error('Read after write'); return ref.queryPath ? ref.get() : snapshot(ref.path); };
      const set = (ref: any, value: object, options?: { merge: boolean }) => { writing = true; records.set(ref.path, options?.merge ? { ...records.get(ref.path), ...value } : value); };
      try {
        return await fn({ get: async (ref: any) => read(ref), getAll: async (...refs: any[]) => refs.map(read), set, update: (ref: any, value: object) => set(ref, value, { merge: true }), create: (ref: any, value: object) => { if (records.has(ref.path)) throw new Error('Duplicate create'); set(ref, value); } });
      } finally { release(); }
    },
  } as unknown as Firestore;
  return { db, records };
}

export const base = {
  'families/home': { timezone: 'Asia/Kolkata', roster: [{ memberId: 'anu', role: 'supporter', days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '00:00' }, { memberId: 'mini', role: 'nurse', days: [6], from: '09:00', to: '17:00' }] },
  'families/home/members/amma': { ownerUid: 'amma', mode: 'assisted', nurseIds: ['mini'] },
  'families/home/members/amma/settings/sharing': { counts: false, risk: false },
  'families/home/members/amma/schedule/morning': { time: '08:00', medicines: [{ id: 'bp', count: 1, stock: 30 }] },
  'families/home/access/amma': { active: true, roles: ['member'], memberIds: ['amma'] },
  'families/home/access/anu': { active: true, roles: ['supporter'], memberIds: ['amma'] },
  'families/home/access/mini': { active: true, roles: ['nurse'], memberIds: ['amma'] },
  'devices/amma': { active: true, familyId: 'home', memberIds: ['amma'], uid: 'amma', fcmToken: 'owner-token' },
  'devices/anu': { active: true, familyId: 'home', memberIds: ['amma'], uid: 'anu', fcmToken: 'supporter-token' },
  'devices/mini': { active: true, familyId: 'home', memberIds: ['amma'], uid: 'mini', fcmToken: 'nurse-token' },
};
