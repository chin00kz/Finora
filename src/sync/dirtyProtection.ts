/**
 * Production sync gates used by syncEngine.ts.
 * Regression tests must import these functions — not reimplement the rules.
 */

/**
 * Apply dirty-clear policy after an upsert attempt.
 * Any error (including missing-table) retains dirty; success clears.
 */
export function applyUpsertDirtyResult(
  error: unknown | null | undefined,
  clearDirty: () => void,
): 'retained' | 'cleared' {
  if (error != null) return 'retained';
  clearDirty();
  return 'cleared';
}

/**
 * Pull tombstone: delete local row only when absent from cloud, not dirty,
 * and outside the recent-write grace window.
 */
export function shouldTombstoneLocalOnPull(params: {
  presentInRemote: boolean;
  isDirty: boolean;
  updatedAt: number;
  now: number;
  graceMs?: number;
}): boolean {
  if (params.presentInRemote) return false;
  if (params.isDirty) return false;
  const graceMs = params.graceMs ?? 60_000;
  if ((params.updatedAt ?? 0) > params.now - graceMs) return false;
  return true;
}

/**
 * Remote upsert gate: never revive a row that is queued for cloud deletion.
 * Without this, pull/realtime can recreate a locally deleted account while
 * deleteFromCloud is still draining offline.
 */
export function shouldApplyRemoteUpsert(params: {
  id: string;
  pendingDeleteIds: readonly string[];
  hasLocal: boolean;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}): boolean {
  if (params.pendingDeleteIds.includes(params.id)) return false;
  if (!params.hasLocal) return true;
  return (params.remoteUpdatedAt ?? 0) >= (params.localUpdatedAt ?? 0);
}
