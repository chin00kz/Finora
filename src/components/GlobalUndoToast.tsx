import { useEffect, useState, useRef } from 'react';
import { useUIStore } from '../store/uiStore';
import { db } from '../db/db';
import { deleteFromCloud, triggerSync } from '../sync/syncEngine';
import { RotateCcw, X, CheckCircle2 } from 'lucide-react';

export default function GlobalUndoToast() {
  const { undoToast, dismissUndoToast } = useUIStore();
  const [progress, setProgress] = useState(100);
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoneSuccess, setUndoneSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!undoToast) {
      setProgress(100);
      setUndoneSuccess(false);
      return;
    }

    const duration = undoToast.durationMs || 6000;
    const startTime = Date.now();

    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const remainingPct = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remainingPct);

      if (elapsed < duration) {
        animFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animFrameRef.current = requestAnimationFrame(updateProgress);

    timerRef.current = setTimeout(() => {
      dismissUndoToast();
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [undoToast, dismissUndoToast]);

  if (!undoToast && !undoneSuccess) return null;

  const handleUndo = async () => {
    if (!undoToast || isUndoing) return;
    setIsUndoing(true);

    try {
      // 1. Delete the created transaction from Dexie
      await db.transactions.delete(undoToast.transactionId);

      // 2. Restore the account balance
      const acc = await db.accounts.get(undoToast.accountId);
      if (acc) {
        const balanceDelta =
          undoToast.type === 'expense' ? undoToast.amount : -undoToast.amount;
        await db.accounts.update(acc.id, {
          balance: acc.balance + balanceDelta,
          updatedAt: Date.now(),
        });
      }

      // 3. Prevent in-flight race condition:
      // Remove any pending insert for this transaction from localStorage pending queue
      try {
        const rawQueue = localStorage.getItem('finora-pending-sync');
        if (rawQueue) {
          const queue = JSON.parse(rawQueue);
          if (Array.isArray(queue)) {
            const filtered = queue.filter(
              (item: any) =>
                !(item.table === 'transactions' && item.id === undoToast.transactionId)
            );
            localStorage.setItem('finora-pending-sync', JSON.stringify(filtered));
          }
        }
      } catch (err) {
        console.warn('Could not update pending sync queue on undo:', err);
      }

      // 4. Issue cloud delete
      await deleteFromCloud('transactions', undoToast.transactionId);
      triggerSync();

      // Show brief success feedback
      setUndoneSuccess(true);
      setTimeout(() => {
        setUndoneSuccess(false);
        dismissUndoToast();
      }, 1500);
    } catch (err) {
      console.error('Error undoing transaction:', err);
      dismissUndoToast();
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <aside
      aria-label="Action feedback"
      className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-96 z-50 animate-in fade-in slide-in-from-bottom-5 duration-200 pointer-events-auto"
    >
      <div className="bg-card/95 backdrop-blur-md text-foreground border border-border rounded-2xl shadow-xl overflow-hidden p-3.5 flex items-center justify-between gap-3">
        {undoneSuccess ? (
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-500 py-1">
            <CheckCircle2 size={16} />
            <span>Transaction undone and balance restored</span>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground truncate">
                {undoToast?.message}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Tap undo to reverse
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleUndo}
                disabled={isUndoing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background font-semibold text-xs rounded-xl hover:opacity-90 active:scale-95 transition-all shadow-xs disabled:opacity-50"
              >
                <RotateCcw size={12} className={isUndoing ? 'animate-spin' : ''} />
                <span>{isUndoing ? 'Undoing…' : 'Undo'}</span>
              </button>

              <button
                onClick={dismissUndoToast}
                className="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Progress countdown indicator */}
      {!undoneSuccess && (
        <div className="h-0.5 w-full bg-muted/40 rounded-b-2xl overflow-hidden -mt-0.5">
          <div
            className="h-full bg-accent/80 transition-all ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </aside>
  );
}
