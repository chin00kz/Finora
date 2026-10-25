/**
 * Personal dataset epoch — multi-device safety after Choice A.
 *
 * epoch = 0: legacy direct PostgREST sync (current production behavior).
 * epoch > 0: client must use upsert_personal_rows / delete_personal_rows RPCs.
 *
 * Pure helpers live here (Node-test safe). Network fetch is in datasetEpochFetch.ts.
 */

export const LOCAL_DATASET_EPOCH_KEY = 'finora-local-dataset-epoch';

export interface PersonalDatasetMeta {
  epoch: number;
  lastReplacedAt: string | null;
  lastCloudFingerprint: string | null;
  /** True when meta RPC/table is missing (pre-migration). */
  unavailable: boolean;
}

type EpochMap = Record<string, number>;

function readEpochMap(): EpochMap {
  try {
    const raw = localStorage.getItem(LOCAL_DATASET_EPOCH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EpochMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeEpochMap(map: EpochMap): void {
  localStorage.setItem(LOCAL_DATASET_EPOCH_KEY, JSON.stringify(map));
}

export function getLocalDatasetEpoch(userId: string): number {
  const n = readEpochMap()[userId];
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

export function setLocalDatasetEpoch(userId: string, epoch: number): void {
  const map = readEpochMap();
  map[userId] = Math.max(0, Math.floor(epoch));
  writeEpochMap(map);
}

export function clearLocalDatasetEpoch(userId: string): void {
  const map = readEpochMap();
  delete map[userId];
  writeEpochMap(map);
}

/** Pure: whether local and cloud epochs are compatible for push. */
export function evaluateEpochDrift(localEpoch: number, cloudEpoch: number): {
  ok: boolean;
  reason?: 'mismatch';
} {
  if (localEpoch === cloudEpoch) return { ok: true };
  return { ok: false, reason: 'mismatch' };
}

/** Whether this client must use RPC upsert/delete instead of direct PostgREST. */
export function shouldUseEpochGatedRpcSync(localEpoch: number): boolean {
  return localEpoch > 0;
}

export function isEpochMismatchError(message: string | undefined | null): boolean {
  if (!message) return false;
  return (
    message.includes('finora_dataset_epoch_mismatch') ||
    message.includes('finora_dataset_epoch_required')
  );
}
