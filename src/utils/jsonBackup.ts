import { db } from '../db/db';
import { format } from 'date-fns';
import { createId } from './createId';
import {
  clearRestoreIsolationInternal,
  enterRestoreIsolation,
  isRestoreIsolated,
} from '../sync/restoreIsolation';

export const FINORA_BACKUP_APP = 'Finora';
export const FINORA_BACKUP_SUPPORTED_VERSIONS = [1] as const;
export const REPLACE_CONFIRMATION_PHRASE = 'REPLACE';

/**
 * Personal-finance tables included in JSON backup / local replace-all.
 * These map to syncEngine ALL_TABLES (generic dirty sync).
 */
export const BACKUP_TABLE_KEYS = [
  'accounts',
  'categories',
  'transactions',
  'budgets',
  'tags',
  'people',
  'debts',
  'recurringTransactions',
  'savingsGoals',
  'creditCards',
  'cashOffsetSources',
  'fixedDeposits',
  'moneyMarketAccounts',
  'installmentPlans',
  'cardPromos',
  'floatGapHistory',
  'reimbursementLedgers',
  'reimbursementEntries',
] as const;

export type BackupTableKey = (typeof BACKUP_TABLE_KEYS)[number];

/**
 * Cloud-authoritative Dexie caches — NEVER cleared or overwritten by personal restore.
 * Shared IOUs / connections / notifications / profiles stay intact.
 */
export const CLOUD_AUTHORITATIVE_DEXIE_TABLES = [
  'cacheProfiles',
  'cacheConnections',
  'cacheSharedIous',
  'cacheSharedIouSettlements',
  'cacheNotifications',
] as const;

/** Local shared-IOU settlement intents — not part of personal replace-all. */
export const PRESERVED_LOCAL_NON_BACKUP_TABLES = [
  'pendingAccountOutbox',
  'statementCards',
  'parsedStatements',
  'localRestoreKits',
] as const;

export interface FinoraFullBackup {
  version: number;
  exportedAt: number;
  app: 'Finora';
  data: Record<BackupTableKey, unknown[]>;
}

export interface FinoraRecoveryKit {
  app: 'Finora';
  kind: 'recovery_kit';
  version: 1;
  createdAt: number;
  syncMetadata: {
    dirty: Record<string, string[]>;
    deleted: Record<string, string[]>;
  };
  data: Record<BackupTableKey, unknown[]>;
}

export interface BackupValidationResult {
  ok: boolean;
  error?: string;
  backup?: FinoraFullBackup;
  tableCounts: Partial<Record<BackupTableKey, number>>;
  totalItems: number;
}

export interface ReplaceAllRestorePlan {
  mode: 'replace_all';
  /** False when Option 1 local-only path is available for a valid backup */
  blocked: boolean;
  blockerReason?: string;
  confirmationPhrase: string;
  warnings: string[];
  tableCounts: Partial<Record<BackupTableKey, number>>;
  totalItems: number;
  exportedAt?: number;
  version?: number;
  preservesCloudAuthoritativeTables: string[];
}

export async function collectPersonalTableData(): Promise<Record<BackupTableKey, unknown[]>> {
  const [
    accounts,
    categories,
    transactions,
    budgets,
    tags,
    people,
    debts,
    recurringTransactions,
    savingsGoals,
    creditCards,
    cashOffsetSources,
    fixedDeposits,
    moneyMarketAccounts,
    installmentPlans,
    cardPromos,
    floatGapHistory,
    reimbursementLedgers,
    reimbursementEntries,
  ] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.tags.toArray(),
    db.people.toArray(),
    db.debts.toArray(),
    db.recurringTransactions.toArray(),
    db.savingsGoals.toArray(),
    db.creditCards.toArray(),
    db.cashOffsetSources.toArray(),
    db.fixedDeposits.toArray(),
    db.moneyMarketAccounts.toArray(),
    db.installmentPlans.toArray(),
    db.cardPromos.toArray(),
    db.floatGapHistory.toArray(),
    db.reimbursementLedgers.toArray(),
    db.reimbursementEntries.toArray(),
  ]);

  return {
    accounts,
    categories,
    transactions,
    budgets,
    tags,
    people,
    debts,
    recurringTransactions,
    savingsGoals,
    creditCards,
    cashOffsetSources,
    fixedDeposits,
    moneyMarketAccounts,
    installmentPlans,
    cardPromos,
    floatGapHistory,
    reimbursementLedgers,
    reimbursementEntries,
  };
}

function downloadJsonFile(filename: string, payload: unknown): void {
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports all 18 personal IndexedDB tables into a single comprehensive JSON file.
 * Does not include cloud-authoritative Shared IOU / connection / notification caches.
 */
export async function exportFullBackupJSON(): Promise<void> {
  const data = await collectPersonalTableData();
  const backup: FinoraFullBackup = {
    version: 1,
    exportedAt: Date.now(),
    app: 'Finora',
    data,
  };
  downloadJsonFile(`finora_complete_backup_${format(new Date(), 'yyyyMMdd_HHmm')}.json`, backup);
}

/**
 * Validate backup structure and supported version. Does not modify data.
 */
export function validateFinoraBackup(jsonString: string): BackupValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return {
      ok: false,
      error: 'File is not valid JSON.',
      tableCounts: {},
      totalItems: 0,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Invalid backup file.', tableCounts: {}, totalItems: 0 };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.app !== FINORA_BACKUP_APP) {
    return {
      ok: false,
      error: 'Invalid backup file. Must be a Finora backup JSON (app: "Finora").',
      tableCounts: {},
      totalItems: 0,
    };
  }

  const version = Number(obj.version);
  if (!FINORA_BACKUP_SUPPORTED_VERSIONS.includes(version as 1)) {
    return {
      ok: false,
      error: `Unsupported backup version ${String(obj.version)}. Supported: ${FINORA_BACKUP_SUPPORTED_VERSIONS.join(', ')}.`,
      tableCounts: {},
      totalItems: 0,
    };
  }

  if (!obj.data || typeof obj.data !== 'object') {
    return {
      ok: false,
      error: 'Backup is missing the data object.',
      tableCounts: {},
      totalItems: 0,
    };
  }

  const data = obj.data as Record<string, unknown>;
  const tableCounts: Partial<Record<BackupTableKey, number>> = {};
  let totalItems = 0;
  let hasAnyArray = false;

  for (const key of BACKUP_TABLE_KEYS) {
    const arr = data[key];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) {
      return {
        ok: false,
        error: `Backup field data.${key} must be an array.`,
        tableCounts: {},
        totalItems: 0,
      };
    }
    hasAnyArray = true;
    tableCounts[key] = arr.length;
    totalItems += arr.length;
  }

  if (!hasAnyArray) {
    return {
      ok: false,
      error: 'Backup data contains no recognized tables.',
      tableCounts: {},
      totalItems: 0,
    };
  }

  // Reject backups that try to smuggle cloud-authoritative caches into personal restore
  for (const key of CLOUD_AUTHORITATIVE_DEXIE_TABLES) {
    if (key in data) {
      return {
        ok: false,
        error: `Backup must not include cloud-authoritative table "${key}". Shared IOU/connection caches are not part of personal restore.`,
        tableCounts: {},
        totalItems: 0,
      };
    }
  }

  const normalizedData = {} as Record<BackupTableKey, unknown[]>;
  for (const key of BACKUP_TABLE_KEYS) {
    normalizedData[key] = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
  }

  const backup: FinoraFullBackup = {
    version,
    exportedAt: Number(obj.exportedAt) || 0,
    app: 'Finora',
    data: normalizedData,
  };

  return { ok: true, backup, tableCounts, totalItems };
}

export function planReplaceAllRestore(jsonString: string): ReplaceAllRestorePlan {
  const validation = validateFinoraBackup(jsonString);
  const warnings = [
    'This replaces personal-finance tables on this device only (accounts, transactions, budgets, etc.).',
    'Cloud-authoritative Shared IOUs, connections, notifications, and profiles are not modified.',
    'A recovery kit (current local data + dirty/deleted sync metadata) must be saved before replacement.',
    'The device will enter persistent Local-only restored isolation — cloud sync will not resume automatically.',
    'Unsynced changes not present in the chosen backup file will only be recoverable from the recovery kit.',
  ];

  if (!validation.ok || !validation.backup) {
    return {
      mode: 'replace_all',
      blocked: true,
      blockerReason: validation.error || 'Backup validation failed.',
      confirmationPhrase: REPLACE_CONFIRMATION_PHRASE,
      warnings,
      tableCounts: {},
      totalItems: 0,
      preservesCloudAuthoritativeTables: [...CLOUD_AUTHORITATIVE_DEXIE_TABLES],
    };
  }

  if (isRestoreIsolated()) {
    return {
      mode: 'replace_all',
      blocked: true,
      blockerReason:
        'This device is already in Local-only restored isolation. Finish or recover from the existing recovery kit before starting another replace-all.',
      confirmationPhrase: REPLACE_CONFIRMATION_PHRASE,
      warnings,
      tableCounts: validation.tableCounts,
      totalItems: validation.totalItems,
      exportedAt: validation.backup.exportedAt,
      version: validation.backup.version,
      preservesCloudAuthoritativeTables: [...CLOUD_AUTHORITATIVE_DEXIE_TABLES],
    };
  }

  return {
    mode: 'replace_all',
    blocked: false,
    confirmationPhrase: REPLACE_CONFIRMATION_PHRASE,
    warnings,
    tableCounts: validation.tableCounts,
    totalItems: validation.totalItems,
    exportedAt: validation.backup.exportedAt,
    version: validation.backup.version,
    preservesCloudAuthoritativeTables: [...CLOUD_AUTHORITATIVE_DEXIE_TABLES],
  };
}

/** Build + verify a recovery kit (in memory). Does not mutate personal tables. */
export async function buildRecoveryKit(): Promise<{
  kit: FinoraRecoveryKit;
  json: string;
  verified: boolean;
}> {
  const { snapshotSyncMetadata } = await import('../sync/syncEngine');
  const data = await collectPersonalTableData();
  const meta = snapshotSyncMetadata();
  const kit: FinoraRecoveryKit = {
    app: 'Finora',
    kind: 'recovery_kit',
    version: 1,
    createdAt: Date.now(),
    syncMetadata: {
      dirty: (meta.dirty || {}) as Record<string, string[]>,
      deleted: (meta.deleted || {}) as Record<string, string[]>,
    },
    data,
  };
  const json = JSON.stringify(kit);
  let verified = false;
  try {
    const roundTrip = JSON.parse(json) as FinoraRecoveryKit;
    verified =
      roundTrip.app === 'Finora' &&
      roundTrip.kind === 'recovery_kit' &&
      roundTrip.version === 1 &&
      !!roundTrip.syncMetadata &&
      !!roundTrip.data;
  } catch {
    verified = false;
  }
  return { kit, json, verified };
}

export function downloadRecoveryKit(kit: FinoraRecoveryKit): void {
  downloadJsonFile(
    `finora_recovery_kit_${format(new Date(kit.createdAt), 'yyyyMMdd_HHmmss')}.json`,
    kit,
  );
}

const PERSONAL_DEXIE_TABLES = [
  db.accounts,
  db.categories,
  db.transactions,
  db.budgets,
  db.tags,
  db.people,
  db.debts,
  db.recurringTransactions,
  db.savingsGoals,
  db.creditCards,
  db.cashOffsetSources,
  db.fixedDeposits,
  db.moneyMarketAccounts,
  db.installmentPlans,
  db.cardPromos,
  db.floatGapHistory,
  db.reimbursementLedgers,
  db.reimbursementEntries,
] as const;

export async function applyPersonalDataReplace(data: Record<BackupTableKey, unknown[]>): Promise<number> {
  let totalItems = 0;
  await db.transaction('rw', [...PERSONAL_DEXIE_TABLES], async () => {
    // True replace-all: clear then put (missing backup arrays already normalized to [])
    await db.accounts.clear();
    await db.categories.clear();
    await db.transactions.clear();
    await db.budgets.clear();
    await db.tags.clear();
    await db.people.clear();
    await db.debts.clear();
    await db.recurringTransactions.clear();
    await db.savingsGoals.clear();
    await db.creditCards.clear();
    await db.cashOffsetSources.clear();
    await db.fixedDeposits.clear();
    await db.moneyMarketAccounts.clear();
    await db.installmentPlans.clear();
    await db.cardPromos.clear();
    await db.floatGapHistory.clear();
    await db.reimbursementLedgers.clear();
    await db.reimbursementEntries.clear();

    const load = async (key: BackupTableKey, bulkPut: (rows: any[]) => Promise<unknown>) => {
      const rows = data[key] || [];
      if (rows.length) {
        await bulkPut(rows);
        totalItems += rows.length;
      }
    };
    await load('accounts', rows => db.accounts.bulkPut(rows));
    await load('categories', rows => db.categories.bulkPut(rows));
    await load('transactions', rows => db.transactions.bulkPut(rows));
    await load('budgets', rows => db.budgets.bulkPut(rows));
    await load('tags', rows => db.tags.bulkPut(rows));
    await load('people', rows => db.people.bulkPut(rows));
    await load('debts', rows => db.debts.bulkPut(rows));
    await load('recurringTransactions', rows => db.recurringTransactions.bulkPut(rows));
    await load('savingsGoals', rows => db.savingsGoals.bulkPut(rows));
    await load('creditCards', rows => db.creditCards.bulkPut(rows));
    await load('cashOffsetSources', rows => db.cashOffsetSources.bulkPut(rows));
    await load('fixedDeposits', rows => db.fixedDeposits.bulkPut(rows));
    await load('moneyMarketAccounts', rows => db.moneyMarketAccounts.bulkPut(rows));
    await load('installmentPlans', rows => db.installmentPlans.bulkPut(rows));
    await load('cardPromos', rows => db.cardPromos.bulkPut(rows));
    await load('floatGapHistory', rows => db.floatGapHistory.bulkPut(rows));
    await load('reimbursementLedgers', rows => db.reimbursementLedgers.bulkPut(rows));
    await load('reimbursementEntries', rows => db.reimbursementEntries.bulkPut(rows));
  });
  return totalItems;
}

export interface ExecuteReplaceAllOptions {
  confirmationPhrase: string;
  /** User acknowledges they saved the recovery kit download */
  recoveryKitSavedAcknowledged: boolean;
}

/**
 * Option 1: Local-only offline snapshot replace-all.
 *
 * Failure policy:
 * - Before isolation: no personal-table mutation.
 * - After isolation + failed replace: rollback tables + sync metadata from kit, then clear isolation.
 * - After successful replace: remain isolated; no sync resume action is provided.
 */
export async function executeReplaceAllLocalOnly(
  backupJson: string,
  options: ExecuteReplaceAllOptions,
): Promise<{
  success: boolean;
  error?: string;
  restoredCount: number;
  recoveryKitId?: string;
  isolated?: boolean;
  rolledBack?: boolean;
}> {
  if (isRestoreIsolated()) {
    return {
      success: false,
      error: 'Already in Local-only restored isolation.',
      restoredCount: 0,
    };
  }

  const validation = validateFinoraBackup(backupJson);
  if (!validation.ok || !validation.backup) {
    return { success: false, error: validation.error, restoredCount: 0 };
  }

  if (options.confirmationPhrase.trim() !== REPLACE_CONFIRMATION_PHRASE) {
    return {
      success: false,
      error: `Type ${REPLACE_CONFIRMATION_PHRASE} to confirm.`,
      restoredCount: 0,
    };
  }

  if (!options.recoveryKitSavedAcknowledged) {
    return {
      success: false,
      error: 'Acknowledge that you saved the recovery kit before replacing local data.',
      restoredCount: 0,
    };
  }

  // 1) Build + verify recovery kit BEFORE isolation / mutation
  const { kit, json: kitJson, verified } = await buildRecoveryKit();
  if (!verified) {
    return {
      success: false,
      error: 'Failed to verify recovery kit structure. Nothing was changed.',
      restoredCount: 0,
    };
  }

  const {
    cancelPendingSyncTimer,
    clearSyncMetadataLocalOnly,
    restoreSyncMetadataLocalOnly,
  } = await import('../sync/syncEngine');

  // 2) Persist kit on-device + download for the user
  const recoveryKitId = createId('rkit');
  await db.localRestoreKits.put({
    id: recoveryKitId,
    createdAt: kit.createdAt,
    payload: kitJson,
  });
  downloadRecoveryKit(kit);

  // 3) Enter isolation BEFORE mutation; cancel any queued push timer
  cancelPendingSyncTimer();
  enterRestoreIsolation({
    recoveryKitId,
    backupExportedAt: validation.backup.exportedAt,
  });

  // 4) Freeze live dirty/deleted into kit only — clear live maps without cloud I/O
  clearSyncMetadataLocalOnly();

  try {
    const restoredCount = await applyPersonalDataReplace(validation.backup.data);
    // Success: stay isolated. Do not triggerSync / deleteFromCloud.
    return {
      success: true,
      restoredCount,
      recoveryKitId,
      isolated: true,
    };
  } catch (err) {
    // Failure after isolation: roll back personal tables + sync metadata, then leave isolation
    let rolledBack = false;
    try {
      await applyPersonalDataReplace(kit.data);
      restoreSyncMetadataLocalOnly(kit.syncMetadata);
      rolledBack = true;
      clearRestoreIsolationInternal();
    } catch (rollbackErr) {
      console.error('[restore] Rollback failed after replace error:', rollbackErr);
      // Stay isolated — partial state is unsafe for sync
    }
    return {
      success: false,
      error:
        (err instanceof Error ? err.message : 'Replace failed') +
        (rolledBack
          ? ' Local data was rolled back from the recovery kit and isolation was cleared.'
          : ' Rollback failed — device remains isolated. Use the downloaded recovery kit manually.'),
      restoredCount: 0,
      recoveryKitId,
      isolated: !rolledBack,
      rolledBack,
    };
  }
}

/**
 * Merge-restore (upsert) into IndexedDB — not replace-all.
 * Blocked while restore-isolated. Does not touch Shared IOU caches.
 */
export async function restoreFullBackupJSON(
  jsonString: string,
): Promise<{ success: boolean; error?: string; restoredCount: number; syncNote?: string }> {
  if (isRestoreIsolated()) {
    return {
      success: false,
      error: 'Merge restore is disabled while Local-only restored isolation is active.',
      restoredCount: 0,
    };
  }

  const validation = validateFinoraBackup(jsonString);
  if (!validation.ok || !validation.backup) {
    return { success: false, error: validation.error, restoredCount: 0 };
  }

  const { data } = validation.backup;
  let totalItems = 0;

  try {
    await db.transaction('rw', [...PERSONAL_DEXIE_TABLES], async () => {
      const load = async (key: BackupTableKey, bulkPut: (rows: any[]) => Promise<unknown>) => {
        const rows = data[key];
        if (Array.isArray(rows) && rows.length) {
          await bulkPut(rows);
          totalItems += rows.length;
        }
      };
      await load('accounts', rows => db.accounts.bulkPut(rows));
      await load('categories', rows => db.categories.bulkPut(rows));
      await load('transactions', rows => db.transactions.bulkPut(rows));
      await load('budgets', rows => db.budgets.bulkPut(rows));
      await load('tags', rows => db.tags.bulkPut(rows));
      await load('people', rows => db.people.bulkPut(rows));
      await load('debts', rows => db.debts.bulkPut(rows));
      await load('recurringTransactions', rows => db.recurringTransactions.bulkPut(rows));
      await load('savingsGoals', rows => db.savingsGoals.bulkPut(rows));
      await load('creditCards', rows => db.creditCards.bulkPut(rows));
      await load('cashOffsetSources', rows => db.cashOffsetSources.bulkPut(rows));
      await load('fixedDeposits', rows => db.fixedDeposits.bulkPut(rows));
      await load('moneyMarketAccounts', rows => db.moneyMarketAccounts.bulkPut(rows));
      await load('installmentPlans', rows => db.installmentPlans.bulkPut(rows));
      await load('cardPromos', rows => db.cardPromos.bulkPut(rows));
      await load('floatGapHistory', rows => db.floatGapHistory.bulkPut(rows));
      await load('reimbursementLedgers', rows => db.reimbursementLedgers.bulkPut(rows));
      await load('reimbursementEntries', rows => db.reimbursementEntries.bulkPut(rows));
    });

    return {
      success: true,
      restoredCount: totalItems,
      syncNote:
        'Local merge restore completed without cloud sync. Rows were not marked dirty and nothing was deleted from Supabase.',
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown restore error',
      restoredCount: 0,
    };
  }
}
