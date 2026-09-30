import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { formatMoney } from '../utils/formatters';
import { supabase } from '../lib/supabase';
import { syncSharedIouSettlements, syncSharedIous } from '../sync/sharedIouSync';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuthStore } from '../store/authStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  iouId: string;
  personName: string;
  remainingAmount: number;
  availableToPropose: number;
  pendingTotal: number;
  currency: string;
}

export default function ProposePaymentModal({
  isOpen,
  onClose,
  iouId,
  personName,
  remainingAmount,
  availableToPropose,
  pendingTotal,
  currency
}: Props) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [payFromAccount, setPayFromAccount] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [isProposed, setIsProposed] = useState(false);

  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    if (isOpen) {
      setAmount(String(availableToPropose));
      setNote('');
      setError('');
      setIsSubmitting(false);
      setPayFromAccount(false);
      setAccountId('');
      setDepositAmount(String(availableToPropose));
      setIsProposed(false);
    }
  }, [isOpen, availableToPropose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const numAmount = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(numAmount) || numAmount <= 0) {
      setError('Please enter a valid finite amount greater than 0.');
      return;
    }
    
    let numDeposit = 0;
    if (payFromAccount) {
      numDeposit = Number(depositAmount);
      if (!accountId) {
        setError('Please select an account.');
        return;
      }
      if (depositAmount.trim() === '' || !Number.isFinite(numDeposit) || numDeposit <= 0) {
        setError('Please enter a valid deposit amount greater than 0.');
        return;
      }
      if (numDeposit > numAmount) {
        setError('Deposit amount cannot exceed the payment amount.');
        return;
      }
    }

    setIsSubmitting(true);

    const { createId } = await import('../utils/createId');
    const settlementId = createId('stl');
    let outboxWritten = false;

    if (payFromAccount && accountId && user) {
      try {
        await db.pendingAccountOutbox.put({
          id: settlementId,
          uid: user.id,
          accountId,
          amount: numDeposit,
          direction: 'debit',
          timestamp: Date.now()
        });
        outboxWritten = true;
      } catch (localErr: any) {
        console.error('Failed to write to local outbox:', localErr);
        setError("Failed to locally prepare the account deduction. Please check storage limits and try again.");
        setIsSubmitting(false);
        return;
      }
    }

    try {
      const { error: rpcError } = await supabase.rpc('propose_iou_payment', {
        p_iou_id: iouId,
        p_amount: numAmount,
        p_note: note.trim() || undefined,
        p_settlement_id: settlementId
      });

      if (rpcError) {
        // Did the server definitely NOT create the settlement?
        const definitelyFailed = ['invalid_iou_status', 'iou_already_settled', 'iou_not_found', 'not_authorized', 'invalid_amount', 'settlement_id_conflict'].some(e => rpcError.message?.includes(e));

        if (definitelyFailed) {
          if (outboxWritten) {
            await db.pendingAccountOutbox.delete(settlementId);
          }
          let humanMsg = rpcError.message || 'Payment proposal failed. Please ensure you are online.';
          if (rpcError.message?.includes('invalid_iou_status') || rpcError.message?.includes('iou_already_settled')) {
            humanMsg = 'This IOU has already been updated. Please close and check the current status.';
          } else if (rpcError.message?.includes('iou_not_found')) {
            humanMsg = 'This IOU could not be found. It may have been removed.';
          }
          setError(humanMsg);
          setIsSubmitting(false);
          Promise.all([syncSharedIouSettlements(), syncSharedIous()]).catch(console.error);
          return;
        }

        // For ambiguous errors (like network timeouts), DO NOT delete the outbox intent.
        throw new Error(rpcError.message);
      }

      Promise.all([syncSharedIouSettlements(), syncSharedIous()]).catch(console.error);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Network error. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose}>
      <div className="space-y-4 pt-2">
        <h2 className="text-xl font-medium text-foreground tracking-tight px-1">I paid {personName}</h2>
        <div className="bg-muted/30 p-3 rounded-lg text-sm space-y-1 text-center">
          <p className="text-muted-foreground">Remaining balance</p>
          <p className="text-lg font-medium text-foreground">{formatMoney(remainingAmount, currency)}</p>
          {pendingTotal > 0 && (
            <p className="text-xs text-amber-500 mt-1">
              (Pending confirmation: {formatMoney(pendingTotal, currency)})
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground block">
              Payment Amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                {currency}
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full bg-background border border-border/60 rounded-xl px-4 py-2.5 pl-12 
text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
                placeholder="0.00"
                required
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="pt-2 border-t border-border/50">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-foreground w-max select-none">
              <input
                type="checkbox"
                checked={payFromAccount}
                onChange={(e) => setPayFromAccount(e.target.checked)}
                disabled={isSubmitting}
                className="w-4 h-4 rounded border-border/60 text-accent focus:ring-accent/20 cursor-pointer"
              />
              Pay from account
            </label>

            {payFromAccount && (
              <div className="mt-3 space-y-3 bg-background/50 p-3 rounded-xl border border-border/40">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground block">
                    Account
                  </label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    disabled={isSubmitting}
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
                    Amount
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                      <span className="text-muted-foreground text-sm font-medium">{currency}</span>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={amount}
                      inputMode="decimal"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      disabled={isSubmitting}
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
              maxLength={255}
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full bg-background border border-border/60 rounded-xl px-4 py-2.5 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
              placeholder="e.g. Dinner, Groceries"
              disabled={isSubmitting}
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
              className="flex-1 px-4 py-2.5 bg-muted text-foreground rounded-xl text-sm font-medium 
hover:bg-muted/80 transition-colors disabled:opacity-50"
            >
              {isProposed ? 'Close' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isProposed}
              className="flex-1 px-4 py-2.5 bg-accent text-accent-foreground rounded-xl text-sm font-medium 
hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-accent-foreground/30 border-t-accent-foreground animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                isProposed ? 'Proposed' : 'Send for confirmation'
              )}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}





