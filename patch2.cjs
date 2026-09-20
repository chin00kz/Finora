const fs = require('fs');
let file = fs.readFileSync('src/sync/syncEngine.ts', 'utf8');

const oldMerge = `    async function merge<T extends { id: string; updatedAt?: number }>(
      dexieTable: { bulkGet: (ids: string[]) => Promise<(T | undefined)[]>; bulkPut: (items: T[]) => Promise<unknown> },
      remoteRows: T[],
    ) {
      const localRows = await dexieTable.bulkGet(remoteRows.map(r => r.id));
      const toWrite = remoteRows.filter((remote, i) => {
        const local = localRows[i];
        return !local || (remote.updatedAt ?? 0) >= (local.updatedAt ?? 0);
      });
      if (toWrite.length) await dexieTable.bulkPut(toWrite);
    }`;

const newMerge = `    async function merge<T extends { id: string; updatedAt?: number }>(
      dexieTable: any,
      remoteRows: T[],
    ) {
      // 1. Upsert modified or new remote rows
      const localRows = await dexieTable.bulkGet(remoteRows.map(r => r.id));
      const toWrite = remoteRows.filter((remote, i) => {
        const local = localRows[i];
        return !local || (remote.updatedAt ?? 0) >= (local.updatedAt ?? 0);
      });
      if (toWrite.length) await dexieTable.bulkPut(toWrite);

      // 2. Delete local rows that no longer exist on remote
      // Only delete if it's NOT marked dirty (offline new rows shouldn't be deleted)
      const remoteIds = new Set(remoteRows.map(r => r.id));
      const dirtyIds = new Set(getDirty()[table] || []);
      const localIds = await dexieTable.toCollection().primaryKeys();
      const toDelete = localIds.filter(id => !remoteIds.has(id) && !dirtyIds.has(id));
      
      if (toDelete.length) {
        await dexieTable.bulkDelete(toDelete);
      }
    }`;

file = file.replace(oldMerge, newMerge);
fs.writeFileSync('src/sync/syncEngine.ts', file, 'utf8');
console.log('patched merge');
