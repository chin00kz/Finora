/**
 * Choice A — keep this device as cloud authority (transactional replace RPC).
 *
 * Feature flag remains false until DB migrations are applied and enablement
 * is explicitly approved. Client-side purge-and-repush must never be used.
 */
import { format } from 'date-fns';
import { db } from '../db/db';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { createId } from '../utils/createId';
import {
  BACKUP_TABLE_KEYS,
  collectPersonalTableData,
} from '../utils/jsonBackup';
import {
  fingerprintPersonalSnapshot,
  validatePersonalSnapshotIntegrity,
} from './cloudReconciliationCompare';
import {
  CHOICE_A_ENABLED,
  KEEP_DEVICE_CONFIRMATION_PHRASE,
  choiceAUnavailableReason,
  evaluateChoiceAConfirmation,
  evaluateChoiceAPayloadLimits,
} from './choiceAFlags';
import {
  clearRestoreIsolationInternal,
  isRestoreIsolated,
  setRestoreIsolationPhase,
} from './restoreIsolation';
import { quarantinePendingAccountOutbox } from './outboxQuarantine';
import { cancelPendingSyncTimer, clearSyncMetadataLocalOnly, snapshotSyncMetadata } from './syncEngine';
import { setLocalDatasetEpoch } from './datasetEpoch';
import { fetchPersonalDatasetMeta } from './datasetEpochFetch';

export {
  CHOICE_A_ENABLED,
  KEEP_DEVICE_CONFIRMATION_PHRASE,
  MAX_CHOICE_A_PAYLOAD_BYTES,
  MAX_CHOICE_A_ROWS,
  choiceAUnavailableReason,
  evaluateChoiceAConfirmation,
  evaluateChoiceAPayloadLimits,
  isChoiceAAvailable,
} from './choiceAFlags';

export const CHOICE_A_PENDING_OP_KEY = 'finora-choice-a-pending-op';

export interface ChoiceAPendingOp {
  clientOperationId: string;
  userId: string;
  expectedCloudFingerprint: string;
  localFingerprint: string;
  startedAt: number;
}

export interface ChoiceAReplaceResult {
  success: boolean;
  status?: 'committed' | 'aborted_stale' | 'disabled' | 'failed' | 'recovered';
  error?: string;
  epoch?: number;
  cloudFingerprintAfter?: string;
  idempotent?: boolean;
  restoredRows?: number;
}

function readPendingOp(): ChoiceAPendingOp | null {
  try {
    const raw = localStorage.getItem(CHOICE_A_PENDING_OP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChoiceAPendingOp;
    if (!parsed?.clientOperationId || !parsed?.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePendingOp(op: ChoiceAPendingOp): void {
  localStorage.setItem(CHOICE_A_PENDING_OP_KEY, JSON.stringify(op));
}

export function clearChoiceAPendingOp(): void {
  try {
    localStorage.removeItem(CHOICE_A_PENDING_OP_KEY);
  } catch {
    // ignore
  }
}

export function getChoiceAPendingOp(): ChoiceAPendingOp | null {
  return readPendingOp();
}

async function queryOperationStatus(clientOperationId: string): Promise<{
  found: boolean;
  status?: string;
  epochAfter?: number;
  cloudFingerprintAfter?: string;
}> {
  const { data, error } = await supabase.rpc('get_personal_dataset_operation', {
    p_client_operation_id: clientOperationId,
  });
  if (error || !data || typeof data !== 'object') {
    return { found: false };
  }
  const row = data as Record<string, unknown>;
  if (row.found !== true) return { found: false };
  return {
    found: true,
    status: row.status != null ? String(row.status) : undefined,
    epochAfter: row.epoch_after != null ? Number(row.epoch_after) : undefined,
    cloudFingerprintAfter:
      row.cloud_fingerprint_after != null ? String(row.cloud_fingerprint_after) : undefined,
  };
}

/**
 * Recover from lost HTTP response after Choice A: consult operation ledger.
 * Safe to call even when CHOICE_A_ENABLED is false (clears stale pending ops).
 */
export async function recoverInterruptedChoiceAOperation(
  userId: string,
): Promise<ChoiceAReplaceResult | null> {
  const pending = readPendingOp();
  if (!pending || pending.userId !== userId) return null;

  if (!isSupabaseConfigured) {
    return {
      success: false,
      status: 'failed',
      error: 'Cannot recover Choice A operation while offline.',
    };
  }

  const status = await queryOperationStatus(pending.clientOperationId);
  if (!status.found) {
    return {
      success: false,
      status: 'failed',
      error:
        'Choice A operation status unknown. Keep this device offline from sync until resolved, or retry when Choice A is enabled.',
    };
  }

  if (status.status === 'committed') {
    if (typeof status.epochAfter === 'number') {
      setLocalDatasetEpoch(userId, status.epochAfter);
    }
    clearChoiceAPendingOp();
    clearSyncMetadataLocalOnly();
    cancelPendingSyncTimer();
    clearRestoreIsolationInternal();
    return {
      success: true,
      status: 'recovered',
      epoch: status.epochAfter,
      cloudFingerprintAfter: status.cloudFingerprintAfter,
      idempotent: true,
    };
  }

  if (status.status === 'aborted_stale') {
    clearChoiceAPendingOp();
    return {
      success: false,
      status: 'aborted_stale',
      error: 'Choice A was aborted: cloud changed before replace. Refresh reconciliation preview.',
    };
  }

  return {
    success: false,
    status: 'failed',
    error: `Choice A operation status: ${status.status || 'unknown'}`,
  };
}

/**
 * Apply Choice A — gated by CHOICE_A_ENABLED.
 * When disabled, returns immediately without calling the replace RPC.
 */
export async function applyChoiceAKeepDevice(params: {
  userId: string;
  confirmationText: string;
  expectedCloudFingerprint: string;
}): Promise<ChoiceAReplaceResult> {
  if (!CHOICE_A_ENABLED) {
    return { success: false, status: 'disabled', error: choiceAUnavailableReason() };
  }
  if (!evaluateChoiceAConfirmation(params.confirmationText)) {
    return {
      success: false,
      status: 'failed',
      error: `Type ${KEEP_DEVICE_CONFIRMATION_PHRASE} to confirm.`,
    };
  }
  if (!isSupabaseConfigured) {
    return { success: false, status: 'failed', error: 'Supabase is not configured.' };
  }
  if (!isRestoreIsolated()) {
    return {
      success: false,
      status: 'failed',
      error: 'Choice A requires an active reconciliation isolation session.',
    };
  }

  const recovered = await recoverInterruptedChoiceAOperation(params.userId);
  if (recovered?.success) return recovered;

  setRestoreIsolationPhase('reconciling');
  cancelPendingSyncTimer();
  await quarantinePendingAccountOutbox();

  const localData = await collectPersonalTableData();
  const integrity = validatePersonalSnapshotIntegrity(localData);
  if (!integrity.ok) {
    return {
      success: false,
      status: 'failed',
      error: `Local dataset failed integrity checks: ${integrity.errors.join('; ')}`,
    };
  }

  const limits = evaluateChoiceAPayloadLimits(localData);
  if (!limits.ok) {
    return {
      success: false,
      status: 'failed',
      error:
        limits.reason === 'empty'
          ? 'Empty dataset replace is forbidden.'
          : limits.reason === 'too_many_rows'
            ? `Dataset exceeds ${50_000} rows.`
            : `Dataset exceeds ${2 * 1024 * 1024} bytes.`,
    };
  }

  const localFingerprint = fingerprintPersonalSnapshot(localData);
  const { data: serverFp, error: fpErr } = await supabase.rpc('get_my_personal_cloud_fingerprint');
  const expected =
    !fpErr && typeof serverFp === 'string' && serverFp.length > 0
      ? serverFp
      : params.expectedCloudFingerprint;

  if (expected !== params.expectedCloudFingerprint) {
    return {
      success: false,
      status: 'aborted_stale',
      error: 'Cloud fingerprint changed since preview. Cancel and re-run reconciliation.',
    };
  }

  const clientOperationId = createId('choa');
  writePendingOp({
    clientOperationId,
    userId: params.userId,
    expectedCloudFingerprint: expected,
    localFingerprint,
    startedAt: Date.now(),
  });

  const kitId = createId('rkit');
  const createdAt = Date.now();
  const syncMeta = snapshotSyncMetadata();
  const kitPayload = {
    app: 'Finora',
    kind: 'choice_a_pre_replace_kit',
    version: 1,
    createdAt,
    fingerprint: localFingerprint,
    syncMetadata: syncMeta,
    data: localData,
  };
  await db.localRestoreKits.put({
    id: kitId,
    createdAt,
    payload: JSON.stringify(kitPayload),
  });
  try {
    const blob = new Blob([JSON.stringify(kitPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finora_choice_a_pre_${format(new Date(createdAt), 'yyyyMMdd_HHmmss')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch {
    // download optional
  }

  const payload: Record<string, unknown[]> = {};
  for (const key of BACKUP_TABLE_KEYS) {
    payload[key] = localData[key] || [];
  }

  const { data, error } = await supabase.rpc('replace_personal_finance_dataset', {
    p_client_operation_id: clientOperationId,
    p_expected_cloud_fingerprint: expected,
    p_local_fingerprint: localFingerprint,
    p_payload: payload,
  });

  if (error) {
    const recoveredAfter = await recoverInterruptedChoiceAOperation(params.userId);
    if (recoveredAfter?.success) return recoveredAfter;
    return {
      success: false,
      status: 'failed',
      error: error.message || 'replace_personal_finance_dataset failed',
    };
  }

  const result = (data || {}) as Record<string, unknown>;
  const status = String(result.status || '');

  if (status === 'aborted_stale') {
    clearChoiceAPendingOp();
    return {
      success: false,
      status: 'aborted_stale',
      error: 'Cloud fingerprint mismatch — nothing was replaced. Refresh preview.',
    };
  }

  if (status !== 'committed') {
    return {
      success: false,
      status: 'failed',
      error: `Unexpected replace status: ${status || 'unknown'}`,
    };
  }

  const epoch = Number(result.epoch) || 0;
  const cloudFingerprintAfter =
    result.cloud_fingerprint_after != null ? String(result.cloud_fingerprint_after) : undefined;

  const meta = await fetchPersonalDatasetMeta();
  if (!meta.unavailable && meta.epoch !== epoch) {
    return {
      success: false,
      status: 'failed',
      error: 'Post-replace epoch verification failed. Contact support with your recovery kit.',
    };
  }
  if (
    cloudFingerprintAfter &&
    meta.lastCloudFingerprint &&
    meta.lastCloudFingerprint !== cloudFingerprintAfter
  ) {
    return {
      success: false,
      status: 'failed',
      error: 'Post-replace fingerprint verification failed.',
    };
  }

  setLocalDatasetEpoch(params.userId, epoch);
  clearChoiceAPendingOp();
  clearSyncMetadataLocalOnly();
  cancelPendingSyncTimer();
  clearRestoreIsolationInternal();

  return {
    success: true,
    status: 'committed',
    epoch,
    cloudFingerprintAfter,
    idempotent: Boolean(result.idempotent),
    restoredRows: result.restored_rows != null ? Number(result.restored_rows) : limits.totalRows,
  };
}
