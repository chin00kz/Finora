import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import { syncSharedIous, syncSharedIouSettlements } from '../sync/sharedIouSync';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuthStore } from '../store/authStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  iouId: string;
  remainingAmount: number;
  currency: string;
}

export default function MarkPaidModal({ isOpen, onClose, iouId, remainingAmount, currency }: Props) {
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  const [depositToAccount, setDepositToAccount] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [isProposed, setIsProposed] = useState(false);

  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    if (isOpen) {
      setNote('');
      setError('');
      setIsSubmitting(false);
      setDepositToAccount(false);
      setAccountId('');
      setDepositAmount(String(remainingAmount));
      setIsProposed(false);
    }
  }, [isOpen, remainingAmount]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    let numDeposit = 0;
    if (depositToAccount) {
      numDeposit = parseFloat(depositAmount);
      if (!accountId) {
        setError('Please select an account for the deposit.');
        setIsSubmitting(false);
        return;
      }
      if (isNaN(numDeposit) || numDeposit <= 0) {
        setError('Deposit amount must be greater than 0.');
        setIsSubmitting(false);
        return;
      }
      if (numDeposit > remainingAmount) {
        setError('Deposit amount cannot exceed the remaining balance.');
        setIsSubmitting(false);
        return;
      }
    }
    const { createId } = await import('../utils/createId');
    const settlementId = createId('stl');
    let outboxWritten = false;

    // Persist durable intent BEFORE making the RPC call
    if (depositToAccount && accountId && numDeposit > 0 && user) {
      try {
        await db.pendingAccountOutbox.put({
          id: settlementId,
          uid: user.id,
          accountId,
          amount: numDeposit,
          direction: 'credit',
          timestamp: Date.now()
        });
        outboxWritten = true;
      } catch (localErr: any) {
        console.error('[MarkPaid] Failed to write deposit intent to outbox:', localErr);
        setError("Failed to locally prepare the account deposit. Please check storage limits and try again.");
        setIsSubmitting(false);
        return;
      }
    }

    try {
      const { error: rpcError } = await supabase.rpc('mark_iou_paid', {
        p_iou_id: iouId,
        p_note: note.trim() || null,
        p_settlement_id: settlementId
      });

      if (rpcError) {
        // Did the server definitely NOT create the settlement?
        // Validation errors and state conflicts mean it rolled back.
        const definitelyFailed = ['invalid_iou_status', 'iou_already_settled', 'iou_not_found', 'not_authorized', 'settlement_id_conflict'].some(e => rpcError.message?.includes(e));

        if (definitelyFailed) {
          // It's safe to clean up the local outbox intent since the cloud rejected the operation
          if (outboxWritten) {
            await db.pendingAccountOutbox.delete(settlementId);
          }
          setError('This IOU has already been updated or the action was invalid. The screen will refresh.');
          Promise.all([syncSharedIous(), syncSharedIouSettlements()]).catch(console.error);
          setIsSubmitting(false);
          return;
        }

        // For ambiguous errors (like network timeouts), we DO NOT delete the outbox intent.
        // It remains durable. If the RPC actually succeeded server-side, it will be recovered.
        throw new Error(rpcError.message);
      }

      // Immediately attempt to process the outbox
      Promise.all([
        syncSharedIouSettlements(),
        syncSharedIous()
      ]).catch(console.error);

      onClose();
    } catch (err: any) {
      setError(err.message || 'Network error. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose}>
      <div className="p-4 space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Mark as paid</h2>
          <p className="text-sm text-muted-foreground mt-1">
            This will mark the remaining {currency} {remainingAmount} as fully paid.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-muted/30 rounded-xl p-3 border border-border/40 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={depositToAccount}
                  onChange={(e) => setDepositToAccount(e.target.checked)}
                  disabled={isSubmitting || isProposed}
                  className="w-5 h-5 rounded border-border/60 text-accent focus:ring-accent/20 cursor-pointer"
                />
              </div>
              <span className="text-sm font-medium text-foreground group-hover:text-accent transition-colors">
                Deposit to account
              </span>
            </label>

            {depositToAccount && (
              <div className="pt-2 border-t border-border/40 space-y-3 pl-8">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground block">
                    Account
                  </label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    disabled={isSubmitting || isProposed}
                    className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
                  >
                    <option value="">Select account...</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name}</option>
                    ))}
                  </select>
                </div>
                
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground block">
                    Deposit Amount
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                      <span className="text-muted-foreground text-sm font-medium">{currency}</span>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={remainingAmount}
                      inputMode="decimal"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      disabled={isSubmitting || isProposed}
                      className="w-full bg-background border border-border/60 rounded-lg pl-12 pr-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground block">
              Optional Note
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={isSubmitting || isProposed}
              placeholder="e.g. Paid in cash"
              className="w-full bg-background border border-border/60 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 text-red-500 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-muted text-foreground rounded-xl text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50"
            >
              {isProposed ? 'Close' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isProposed}
              className="flex-1 px-4 py-2.5 bg-accent text-accent-foreground rounded-xl text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-accent-foreground/30 border-t-accent-foreground animate-spin" />
                  <span>Processing...</span>
                </>
              ) : isProposed ? (
                'Marked Paid'
              ) : (
                'Mark as paid'
              )}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
