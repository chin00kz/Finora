/**
 * Detect personal dataset epoch drift before push.
 * On mismatch: preserve unsynced local data in a recovery kit and enter
 * existing reconciliation isolation (Choice B only while Choice A disabled).
 */
import { format } from 'date-fns';
import { db } from '../db/db';
import { createId } from '../utils/createId';
import { collectPersonalTableData } from '../utils/jsonBackup';
import { fingerprintPersonalSnapshot } from './cloudReconciliationCompare';
import {
  evaluateEpochDrift,
  getLocalDatasetEpoch,
  setLocalDatasetEpoch,
} from './datasetEpoch';
import { fetchPersonalDatasetMeta } from './datasetEpochFetch';
import {
  enterRestoreIsolation,
  isRestoreIsolated,
  setRestoreIsolationPhase,
  type RestoreIsolationReason,
} from './restoreIsolation';
import { cancelPendingSyncTimer, snapshotSyncMetadata } from './syncEngine';
import { quarantinePendingAccountOutbox } from './outboxQuarantine';

export type EpochPushGateResult = 'ok' | 'drift_isolated' | 'error';

function downloadJson(filename: string, payload: unknown): void {
  try {
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
  } catch {
    // optional in tests / SSR
  }
}

async function persistEpochDriftKit(params: {
  localEpoch: number;
  cloudEpoch: number;
}): Promise<string> {
  const id = createId('rkit');
  const createdAt = Date.now();
  const data = await collectPersonalTableData();
  const fingerprint = fingerprintPersonalSnapshot(data);
  const syncMeta = snapshotSyncMetadata();
  const payloadObj = {
    app: 'Finora',
    kind: 'epoch_drift_kit',
    version: 1,
    createdAt,
    localEpoch: params.localEpoch,
    cloudEpoch: params.cloudEpoch,
    fingerprint,
    syncMetadata: {
      dirty: (syncMeta.dirty || {}) as Record<string, string[]>,
      deleted: (syncMeta.deleted || {}) as Record<string, string[]>,
    },
    data,
  };
  await db.localRestoreKits.put({ id, createdAt, payload: JSON.stringify(payloadObj) });
  downloadJson(
    `finora_epoch_drift_${format(new Date(createdAt), 'yyyyMMdd_HHmmss')}.json`,
    payloadObj,
  );
  return id;
}

/**
 * Call before any personal finance push/delete drain.
 * Aligns local epoch when meta matches; on mismatch enters reconciling isolation.
 */
export async function ensureEpochCompatibleBeforePush(
  userId: string,
): Promise<EpochPushGateResult> {
  if (isRestoreIsolated()) {
    return 'ok'; // push already blocked by isolation gate upstream
  }

  const meta = await fetchPersonalDatasetMeta();
  if (meta.unavailable) {
    // Migrations not deployed — preserve legacy direct sync.
    return 'ok';
  }

  const localEpoch = getLocalDatasetEpoch(userId);
  const drift = evaluateEpochDrift(localEpoch, meta.epoch);
  if (drift.ok) {
    // Keep local epoch aligned (e.g. after Choice A on this device recovered).
    if (getLocalDatasetEpoch(userId) !== meta.epoch) {
      setLocalDatasetEpoch(userId, meta.epoch);
    }
    return 'ok';
  }

  try {
    cancelPendingSyncTimer();
    const kitId = await persistEpochDriftKit({
      localEpoch,
      cloudEpoch: meta.epoch,
    });
    await quarantinePendingAccountOutbox();

    const reason: RestoreIsolationReason = 'epoch_drift';
    if (!isRestoreIsolated()) {
      enterRestoreIsolation({ recoveryKitId: kitId, reason });
    }
    setRestoreIsolationPhase('reconciling');
    console.warn(
      `[epochDrift] Local epoch ${localEpoch} != cloud ${meta.epoch}. ` +
        `Preserved kit ${kitId}; entered reconciliation isolation (Choice B only).`,
    );
    return 'drift_isolated';
  } catch (err) {
    console.warn('[epochDrift] Failed to handle epoch drift:', err);
    return 'error';
  }
}
