/**
 * Cloud reconciliation after local-only restore (Phase 1).
 *
 * - Read-only cloud fetch + structured diff (no timestamp merge)
 * - Choice B: discard restored local personal data, adopt cloud snapshot
 * - Choice A: implemented in choiceA.ts but gated by CHOICE_A_ENABLED (false)
 *
 * Reuses restoreIsolation — does not introduce a second isolation system.
 * Never writes to Supabase. Never touches Shared IOU caches.
 *
 * Multi-device races (accepted client limits — no new infra):
 * - Other devices may mutate cloud between paginated pages of a single fetch,
 *   or between preview fingerprint and confirm re-fetch. Incomplete count
 *   mismatch and fingerprint mismatch both abort safely without applying.
 * - A change that preserves fingerprint is theoretically possible only if
 *   payloads normalize equal; whole-record compare makes silent drift unlikely.
 * - True cross-device atomicity would require a server-side snapshot/RPC.
 */
import { format } from 'date-fns';
import { db } from '../db/db';
import { createId } from '../utils/createId';
import {
  applyPersonalDataReplace,
  BACKUP_TABLE_KEYS,
  collectPersonalTableData,
  type BackupTableKey,
} from '../utils/jsonBackup';
import {
  clearRestoreIsolationInternal,
  isRestoreIsolated,
  patchRestoreIsolationState,
  setRestoreIsolationPhase,
} from './restoreIsolation';
import {
  ALL_TABLES,
  cancelPendingSyncTimer,
  clearSyncMetadataLocalOnly,
  fetchCloudTableRowsPaginatedReadOnly,
  snapshotSyncMetadata,
  type TableName,
} from './syncEngine';
import { withPersonalFinanceSystemWrite } from './personalFinanceWriteGate';
import {
  OUTBOX_QUARANTINE_REASON,
  quarantinePendingAccountOutbox,
  shouldAutoApplyOutboxEntry,
} from './outboxQuarantine';

export { OUTBOX_QUARANTINE_REASON, shouldAutoApplyOutboxEntry, quarantinePendingAccountOutbox };

/** Backup key ↔ sync engine table name */
export const BACKUP_KEY_TO_TABLE: Record<BackupTableKey, TableName> = {
  accounts: 'accounts',
  categories: 'categories',
  transactions: 'transactions',
  budgets: 'budgets',
  tags: 'tags',
  people: 'people',
  debts: 'debts',
  recurringTransactions: 'recurring_transactions',
  savingsGoals: 'savings_goals',
  creditCards: 'credit_cards',
  cashOffsetSources: 'cash_offset_sources',
  fixedDeposits: 'fixed_deposits',
  moneyMarketAccounts: 'money_market_accounts',
  installmentPlans: 'installment_plans',
  cardPromos: 'card_promos',
  floatGapHistory: 'float_gap_history',
  reimbursementLedgers: 'reimbursement_ledgers',
  reimbursementEntries: 'reimbursement_entries',
};

export const TABLE_TO_BACKUP_KEY: Record<TableName, BackupTableKey> = Object.fromEntries(
  Object.entries(BACKUP_KEY_TO_TABLE).map(([k, v]) => [v, k]),
) as Record<TableName, BackupTableKey>;

export {
  buildAccountTxnConsistencyWarnings,
  diffPersonalSnapshots,
  fingerprintPersonalSnapshot,
  isPaginatedFetchComplete,
  normalizeRecordForCompare,
  evaluateChoiceBCloudFreshness,
  USE_CLOUD_CONFIRMATION_PHRASE,
  validatePersonalSnapshotIntegrity,
  type AccountTxnConsistencyWarning,
  type TableDiffSummary,
} from './cloudReconciliationCompare';

import {
  buildAccountTxnConsistencyWarnings,
  diffPersonalSnapshots,
  evaluateChoiceBCloudFreshness,
  fingerprintPersonalSnapshot,
  USE_CLOUD_CONFIRMATION_PHRASE,
  validatePersonalSnapshotIntegrity,
  type AccountTxnConsistencyWarning,
  type TableDiffSummary,
} from './cloudReconciliationCompare';

export interface ReconciliationPreview {
  ok: true;
  createdAt: number;
  fingerprint: string;
  tableDiffs: TableDiffSummary[];
  warnings: AccountTxnConsistencyWarning[];
  validationErrors: string[];
  localCounts: Record<BackupTableKey, number>;
  cloudCounts: Record<BackupTableKey, number>;
  localKitId: string;
  cloudKitId: string;
  outboxQuarantinedCount: number;
  /** In-memory cloud snapshot used for apply after re-check */
  cloudData: Record<BackupTableKey, unknown[]>;
  localData: Record<BackupTableKey, unknown[]>;
}

export interface ReconciliationPreviewFailure {
  ok: false;
  error: string;
}

export async function fetchAllPersonalCloudDataReadOnly(userId: string): Promise<{
  ok: boolean;
  error?: string;
  data?: Record<BackupTableKey, unknown[]>;
  counts?: Record<BackupTableKey, number>;
}> {
  const data = {} as Record<BackupTableKey, unknown[]>;
  const counts = {} as Record<BackupTableKey, number>;

  for (const table of ALL_TABLES) {
    const result = await fetchCloudTableRowsPaginatedReadOnly(table, userId);
    if (!result.complete || result.error) {
      return {
        ok: false,
        error: result.error || `Incomplete fetch for ${table}.`,
      };
    }
    const key = TABLE_TO_BACKUP_KEY[table];
    data[key] = result.rows;
    counts[key] = result.rows.length;
  }

  // Ensure every backup key exists
  for (const key of BACKUP_TABLE_KEYS) {
    if (!data[key]) data[key] = [];
    if (counts[key] == null) counts[key] = 0;
  }

  return { ok: true, data, counts };
}

function downloadJson(filename: string, payload: unknown): void {
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

async function persistReconciliationKit(meta: {
  side: 'local' | 'cloud';
  data: Record<BackupTableKey, unknown[]>;
  fingerprint: string;
}): Promise<string> {
  const id = createId('rkit');
  const createdAt = Date.now();
  // Local kits capture live dirty/deleted; cloud kits record empty maps (cloud has no dirty queue).
  const syncMeta =
    meta.side === 'local'
      ? snapshotSyncMetadata()
      : { dirty: {}, deleted: {} };
  const payloadObj = {
    app: 'Finora',
    kind: 'reconciliation_kit',
    version: 1,
    side: meta.side,
    createdAt,
    fingerprint: meta.fingerprint,
    syncMetadata: {
      dirty: (syncMeta.dirty || {}) as Record<string, string[]>,
      deleted: (syncMeta.deleted || {}) as Record<string, string[]>,
    },
    data: meta.data,
  };
  const payload = JSON.stringify(payloadObj);
  await db.localRestoreKits.put({ id, createdAt, payload });
  downloadJson(
    `finora_reconciliation_${meta.side}_${format(new Date(createdAt), 'yyyyMMdd_HHmmss')}.json`,
    payloadObj,
  );
  return id;
}

/**
 * Enter reconciling phase, quarantine outbox, snapshot both sides, build preview.
 * On fetch/validation failure: leave phase as isolated (or revert), stay restore-isolated.
 */
export async function buildReconciliationPreview(
  userId: string,
): Promise<ReconciliationPreview | ReconciliationPreviewFailure> {
  if (!isRestoreIsolated()) {
    return { ok: false, error: 'Device is not in Local-only restored isolation.' };
  }

  cancelPendingSyncTimer();
  if (!setRestoreIsolationPhase('reconciling')) {
    return { ok: false, error: 'Failed to enter reconciliation phase.' };
  }

  try {
    const outboxQuarantinedCount = await quarantinePendingAccountOutbox();
    const localData = await collectPersonalTableData();
    const cloudFetch = await fetchAllPersonalCloudDataReadOnly(userId);
    if (!cloudFetch.ok || !cloudFetch.data) {
      setRestoreIsolationPhase('isolated');
      return {
        ok: false,
        error: cloudFetch.error || 'Failed to fetch cloud personal data.',
      };
    }

    const cloudData = cloudFetch.data;
    const cloudIntegrity = validatePersonalSnapshotIntegrity(cloudData);
    if (!cloudIntegrity.ok) {
      setRestoreIsolationPhase('isolated');
      return {
        ok: false,
        error:
          'Cloud snapshot failed integrity validation: ' +
          cloudIntegrity.errors.slice(0, 3).join(' '),
      };
    }

    const fingerprint = fingerprintPersonalSnapshot(cloudData);
    const localFp = fingerprintPersonalSnapshot(localData);
    const localKitId = await persistReconciliationKit({
      side: 'local',
      data: localData,
      fingerprint: localFp,
    });
    const cloudKitId = await persistReconciliationKit({
      side: 'cloud',
      data: cloudData,
      fingerprint,
    });

    patchRestoreIsolationState({
      phase: 'reconciling',
      reconciliationLocalKitId: localKitId,
      reconciliationCloudKitId: cloudKitId,
    });

    const tableDiffs = diffPersonalSnapshots(localData, cloudData);
    const warnings = [
      ...buildAccountTxnConsistencyWarnings(localData, cloudData),
      ...cloudIntegrity.warnings,
    ];

    const localCounts = {} as Record<BackupTableKey, number>;
    const cloudCounts = {} as Record<BackupTableKey, number>;
    for (const key of BACKUP_TABLE_KEYS) {
      localCounts[key] = (localData[key] || []).length;
      cloudCounts[key] = (cloudData[key] || []).length;
    }

    return {
      ok: true,
      createdAt: Date.now(),
      fingerprint,
      tableDiffs,
      warnings,
      validationErrors: [],
      localCounts,
      cloudCounts,
      localKitId,
      cloudKitId,
      outboxQuarantinedCount,
      cloudData,
      localData,
    };
  } catch (err) {
    setRestoreIsolationPhase('isolated');
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to build reconciliation preview.',
    };
  }
}

/** Cancel an in-progress reconciliation UI session; remain restore-isolated. */
export function cancelReconciliationPreview(): void {
  if (!isRestoreIsolated()) return;
  setRestoreIsolationPhase('isolated');
}

export async function executeChoiceBUseCloud(options: {
  userId: string;
  preview: ReconciliationPreview;
  confirmationPhrase: string;
}): Promise<{ success: boolean; error?: string; restoredCount?: number }> {
  if (!isRestoreIsolated()) {
    return { success: false, error: 'Device is not isolated.' };
  }
  if (options.confirmationPhrase.trim() !== USE_CLOUD_CONFIRMATION_PHRASE) {
    return {
      success: false,
      error: `Type ${USE_CLOUD_CONFIRMATION_PHRASE} to confirm.`,
    };
  }

  cancelPendingSyncTimer();
  setRestoreIsolationPhase('reconciling');

  // Ensure outbox stays quarantined (idempotent)
  await quarantinePendingAccountOutbox();

  const fresh = await fetchAllPersonalCloudDataReadOnly(options.userId);
  const freshFingerprint =
    fresh.ok && fresh.data ? fingerprintPersonalSnapshot(fresh.data) : '';
  const integrity =
    fresh.ok && fresh.data
      ? validatePersonalSnapshotIntegrity(fresh.data)
      : { ok: false, errors: [fresh.error || 'fetch failed'], warnings: [] };

  const freshness = evaluateChoiceBCloudFreshness({
    previewFingerprint: options.preview.fingerprint,
    freshFingerprint,
    freshFetchOk: !!(fresh.ok && fresh.data),
    freshIntegrityOk: integrity.ok,
  });
  if (!freshness.ok || !fresh.data) {
    const detail =
      freshness.ok === false && freshness.reason === 'stale_preview'
        ? 'Cloud personal data changed since the preview. Isolation preserved — refresh the preview and review again.'
        : freshness.ok === false && freshness.reason === 'integrity_failed'
          ? 'Cloud snapshot failed validation before apply: ' +
            integrity.errors.slice(0, 3).join(' ')
          : (fresh.error || 'Cloud re-fetch failed.') +
            ' Isolation preserved; refresh the preview.';
    return { success: false, error: detail };
  }

  // Preserve another on-device copy of the about-to-be-replaced local dataset (+ sync metadata)
  try {
    const localNow = await collectPersonalTableData();
    await persistReconciliationKit({
      side: 'local',
      data: localNow,
      fingerprint: fingerprintPersonalSnapshot(localNow),
    });
  } catch (err) {
    return {
      success: false,
      error:
        'Failed to preserve a local reconciliation kit before apply. Nothing was changed. ' +
        (err instanceof Error ? err.message : ''),
    };
  }

  try {
    // System write bypasses reconciling Dexie gate; does not call triggerSync.
    const restoredCount = await withPersonalFinanceSystemWrite(() =>
      applyPersonalDataReplace(fresh.data!),
    );
    // Empty dirty/deleted BEFORE clearing isolation so resumed sync cannot
    // reupload restore-era rows or drain stale cloud deletes.
    cancelPendingSyncTimer();
    clearSyncMetadataLocalOnly();
    clearRestoreIsolationInternal();
    // Outbox remains quarantined — settlement sync must not auto-apply.
    return { success: true, restoredCount };
  } catch (err) {
    // applyPersonalDataReplace is one Dexie transaction — failure means no partial write
    setRestoreIsolationPhase('reconciling');
    return {
      success: false,
      error:
        (err instanceof Error ? err.message : 'Replace failed') +
        ' Local restored dataset and isolation were preserved.',
    };
  }
}

export {
  CHOICE_A_ENABLED,
  KEEP_DEVICE_CONFIRMATION_PHRASE,
  choiceAUnavailableReason,
  evaluateChoiceAConfirmation,
  evaluateChoiceAPayloadLimits,
  isChoiceAAvailable,
} from './choiceAFlags';

export {
  applyChoiceAKeepDevice,
  recoverInterruptedChoiceAOperation,
} from './choiceA';
