/**
 * Persistent restore-isolation mode for Option 1 (local-only offline snapshot).
 *
 * While active, cloud sync must not push, pull, drain deletes, or apply realtime
 * personal-finance rows. Leaving isolation requires the approved reconciliation
 * workflow (Choice B / later Choice A) — there is no silent resume-sync path.
 *
 * Reconciliation reuses this same flag (phase: reconciling). Do not invent a
 * second isolation mechanism.
 */

export const RESTORE_ISOLATION_STORAGE_KEY = 'finora-restore-isolation';

/** Dispatched whenever isolation is entered, patched, phased, or cleared. */
export const RESTORE_ISOLATION_CHANGED_EVENT = 'finora-restore-isolation-changed';

export type RestoreIsolationPhase = 'isolated' | 'reconciling';

/** Why isolation was entered. Older persisted state may only have local_only_replace_all. */
export type RestoreIsolationReason = 'local_only_replace_all' | 'epoch_drift';

function notifyRestoreIsolationChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(RESTORE_ISOLATION_CHANGED_EVENT));
    }
  } catch {
    // ignore (SSR / tests)
  }
}

export interface RestoreIsolationState {
  active: true;
  enteredAt: number;
  reason: RestoreIsolationReason;
  recoveryKitId: string;
  backupExportedAt?: number;
  /** Defaults to 'isolated' when missing (older persisted state). */
  phase?: RestoreIsolationPhase;
  /** Kit ids created during an active reconciliation preview/apply. */
  reconciliationLocalKitId?: string;
  reconciliationCloudKitId?: string;
}

function readState(): RestoreIsolationState | null {
  try {
    const raw = localStorage.getItem(RESTORE_ISOLATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RestoreIsolationState;
    if (parsed && parsed.active === true) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeState(state: RestoreIsolationState): void {
  localStorage.setItem(RESTORE_ISOLATION_STORAGE_KEY, JSON.stringify(state));
  notifyRestoreIsolationChanged();
}

export function isRestoreIsolated(): boolean {
  return readState() != null;
}

export function getRestoreIsolationState(): RestoreIsolationState | null {
  return readState();
}

export function getRestoreIsolationPhase(): RestoreIsolationPhase | null {
  const state = readState();
  if (!state) return null;
  return state.phase === 'reconciling' ? 'reconciling' : 'isolated';
}

/** True while a reconciliation preview/apply is in progress. */
export function isPersonalFinanceEditFrozen(): boolean {
  return getRestoreIsolationPhase() === 'reconciling';
}

export function getPersonalFinanceEditBlockError(): { message: string } | null {
  if (!isPersonalFinanceEditFrozen()) return null;
  return {
    message:
      'Personal finance edits are frozen while cloud reconciliation is in progress. Cancel reconciliation or finish Choice B first.',
  };
}

/** Warning for local-only edits while isolated but not reconciling. */
export function getIsolatedEditWarning(): string | null {
  if (!isRestoreIsolated()) return null;
  if (isPersonalFinanceEditFrozen()) return null;
  return (
    'Local-only restored isolation is active. Edits on this device stay local and are not synced. ' +
    'Use cloud reconciliation before sync can resume. Keep your recovery kit safe.'
  );
}

/** Enter isolation BEFORE any destructive local mutation. */
export function enterRestoreIsolation(meta: {
  recoveryKitId: string;
  backupExportedAt?: number;
  reason?: RestoreIsolationReason;
}): RestoreIsolationState {
  const state: RestoreIsolationState = {
    active: true,
    enteredAt: Date.now(),
    reason: meta.reason ?? 'local_only_replace_all',
    recoveryKitId: meta.recoveryKitId,
    backupExportedAt: meta.backupExportedAt,
    phase: 'isolated',
  };
  writeState(state);
  return state;
}

export function setRestoreIsolationPhase(phase: RestoreIsolationPhase): boolean {
  const state = readState();
  if (!state) return false;
  writeState({ ...state, phase });
  return true;
}

export function patchRestoreIsolationState(
  patch: Partial<
    Pick<
      RestoreIsolationState,
      'reconciliationLocalKitId' | 'reconciliationCloudKitId' | 'phase'
    >
  >,
): boolean {
  const state = readState();
  if (!state) return false;
  writeState({ ...state, ...patch });
  return true;
}

/**
 * Internal only: used when rolling back a failed replace, or after successful
 * reconciliation. Not a user-facing "resume sync" control by itself.
 */
export function clearRestoreIsolationInternal(): void {
  try {
    localStorage.removeItem(RESTORE_ISOLATION_STORAGE_KEY);
  } catch {
    // ignore
  }
  notifyRestoreIsolationChanged();
}

/** Gate for all cloud sync / realtime / drain paths. */
export function isCloudSyncBlocked(): boolean {
  return isRestoreIsolated();
}

export function cloudSyncBlockReason(): string {
  return (
    'Local-only restored state: cloud sync is isolated. ' +
    'A separate reconciliation workflow is required before sync can resume.'
  );
}

export const CLOUD_MUTATION_BLOCK_MESSAGE =
  'Local-only restored isolation is active. Shared IOU, settlement, and connection changes are disabled until reconciliation is approved. Cached Shared IOU data may be stale.';

/** Error object for mutation RPC wrappers when isolated (Supabase-error shaped). */
export function getCloudMutationBlockError(): { message: string } | null {
  if (!isRestoreIsolated()) return null;
  return { message: CLOUD_MUTATION_BLOCK_MESSAGE };
}

/** Pure helper for tests / call-site checks. */
export function shouldAllowCloudMutation(isolated: boolean): boolean {
  return !isolated;
}
