import {
  BACKUP_TABLE_KEYS,
  CLOUD_AUTHORITATIVE_DEXIE_TABLES,
  executeReplaceAllLocalOnly,
  planReplaceAllRestore,
  PRESERVED_LOCAL_NON_BACKUP_TABLES,
  REPLACE_CONFIRMATION_PHRASE,
  validateFinoraBackup,
} from '../jsonBackup';
import {
  clearRestoreIsolationInternal,
  enterRestoreIsolation,
  isRestoreIsolated,
} from '../../sync/restoreIsolation';

function installLocalStoragePolyfill() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

async function runTests() {
  console.log('Running JSON backup validation / replace-all plan tests...');
  installLocalStoragePolyfill();
  clearRestoreIsolationInternal();

  assertEqual(
    PRESERVED_LOCAL_NON_BACKUP_TABLES.includes('localRestoreKits'),
    true,
    'Recovery kits table is preserved outside personal replace-all',
  );
  assertEqual(
    (BACKUP_TABLE_KEYS as readonly string[]).includes('localRestoreKits'),
    false,
    'Recovery kits are not part of personal backup replace keys',
  );
  assertEqual(
    (BACKUP_TABLE_KEYS as readonly string[]).includes('cacheSharedIous'),
    false,
    'Shared IOU cache is not part of personal replace keys',
  );

  const bad = validateFinoraBackup('{ "app": "Other" }');
  assertEqual(bad.ok, false, 'Non-Finora app rejected');

  const badVer = validateFinoraBackup(
    JSON.stringify({ app: 'Finora', version: 99, data: { accounts: [] } }),
  );
  assertEqual(badVer.ok, false, 'Unsupported version rejected');

  const ok = validateFinoraBackup(
    JSON.stringify({
      app: 'Finora',
      version: 1,
      exportedAt: 123,
      data: {
        accounts: [{ id: 'a1' }],
        transactions: [{ id: 't1' }, { id: 't2' }],
      },
    }),
  );
  assertEqual(ok.ok, true, 'Valid v1 backup accepted');
  assertEqual(ok.totalItems, 3, 'Counts accounts + transactions');
  assertEqual(ok.tableCounts.accounts, 1, 'Account count');
  assertEqual(ok.tableCounts.transactions, 2, 'Transaction count');

  // Missing tables normalize to empty arrays for true replace-all
  assertEqual(ok.backup?.data.budgets.length, 0, 'Missing budgets becomes empty array');

  const plan = planReplaceAllRestore(
    JSON.stringify({
      app: 'Finora',
      version: 1,
      exportedAt: 123,
      data: { accounts: [{ id: 'a1' }], transactions: [] },
    }),
  );
  assertEqual(plan.blocked, false, 'Option 1 plan is executable when valid');
  assertEqual(plan.confirmationPhrase, REPLACE_CONFIRMATION_PHRASE, 'Confirmation phrase defined');
  assertEqual(plan.totalItems, 1, 'Plan surfaces validated counts');
  assertEqual(
    plan.preservesCloudAuthoritativeTables.includes('cacheSharedIous'),
    true,
    'Plan preserves Shared IOUs',
  );
  assertEqual(
    CLOUD_AUTHORITATIVE_DEXIE_TABLES.includes('cacheSharedIouSettlements'),
    true,
    'Settlements cache is cloud-authoritative',
  );

  const planInvalid = planReplaceAllRestore('not-json');
  assertEqual(planInvalid.blocked, true, 'Invalid file yields blocked plan');
  assertEqual(!!planInvalid.blockerReason, true, 'Invalid plan has blocker reason');

  // Already-isolated device: cannot silently start another replace / resume sync path
  enterRestoreIsolation({ recoveryKitId: 'rkit-existing', backupExportedAt: 99 });
  const planWhileIsolated = planReplaceAllRestore(
    JSON.stringify({
      app: 'Finora',
      version: 1,
      exportedAt: 1,
      data: { accounts: [{ id: 'a1' }] },
    }),
  );
  assertEqual(planWhileIsolated.blocked, true, 'Plan blocked while already isolated');
  assert(
    !!planWhileIsolated.blockerReason?.includes('already'),
    'Blocker mentions existing isolation',
  );

  const executeWhileIsolated = await executeReplaceAllLocalOnly(
    JSON.stringify({
      app: 'Finora',
      version: 1,
      exportedAt: 1,
      data: { accounts: [{ id: 'a1' }] },
    }),
    {
      confirmationPhrase: REPLACE_CONFIRMATION_PHRASE,
      recoveryKitSavedAcknowledged: true,
    },
  );
  assertEqual(executeWhileIsolated.success, false, 'Execute refused while already isolated');
  assertEqual(isRestoreIsolated(), true, 'Failed/blocked execute leaves isolation intact');
  assertEqual(
    executeWhileIsolated.error?.includes('Already'),
    true,
    'Execute error names existing isolation',
  );

  clearRestoreIsolationInternal();
  console.log('All JSON backup tests passed.');
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

runTests().catch(err => {
  console.error(err);
  throw err;
});
