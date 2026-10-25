import { AlertTriangle } from 'lucide-react';
import {
  getIsolatedEditWarning,
  getRestoreIsolationPhase,
  getRestoreIsolationState,
  isPersonalFinanceEditFrozen,
  isRestoreIsolated,
} from '../sync/restoreIsolation';

/**
 * Persistent warning while Option 1 local-only restore isolation is active.
 * Reconciliation reuses the same isolation flag (phase: reconciling).
 */
export default function RestoreIsolationBanner() {
  if (!isRestoreIsolated()) return null;
  const state = getRestoreIsolationState();
  const phase = getRestoreIsolationPhase();
  const frozen = isPersonalFinanceEditFrozen();
  const editWarning = getIsolatedEditWarning();

  return (
    <div
      role="status"
      className="sticky top-0 z-40 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2.5 text-amber-950 dark:text-amber-100"
    >
      <div className="max-w-5xl mx-auto flex items-start gap-2.5 text-xs leading-relaxed">
        <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="font-semibold">
            {frozen ? 'Cloud reconciliation in progress' : 'Local-only restored state'}
          </p>
          <p className="mt-0.5 opacity-90">
            {frozen ? (
              <>
                Personal finance edits are frozen. Cloud sync remains blocked. Finish Choice B (use
                cloud) in Settings, or cancel reconciliation to return to local-only isolated
                editing. Shared IOUs stay view-only. Pending settlement outbox entries are
                quarantined for manual review.
              </>
            ) : (
              <>
                Personal finance data on this device was replaced from a backup. Cloud sync (push,
                pull, realtime, and manual sync) is isolated. Shared IOUs were not modified. Open
                Settings → Reconcile with cloud to compare and optionally adopt the current cloud
                snapshot.
                {editWarning ? ` ${editWarning}` : ''}
              </>
            )}
            {state?.recoveryKitId ? ` Recovery kit id: ${state.recoveryKitId}.` : ''}
            {phase ? ` Phase: ${phase}.` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
