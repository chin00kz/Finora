import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { formatMoney } from '../utils/formatters';
import { supabase } from '../lib/supabase';
import { syncSharedIouSettlements } from '../sync/sharedIouSync';

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAmount(String(availableToPropose));
      setError('');
      setIsSubmitting(false);
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

    if (numAmount > availableToPropose) {
      setError(`Amount cannot exceed the available capacity of ${formatMoney(availableToPropose, currency)}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('propose_iou_payment', {
        p_iou_id: iouId,
        p_amount: numAmount
      });

      if (rpcError) {
        setError(rpcError.message || 'Payment proposal failed. Please ensure you are online.');
        setIsSubmitting(false);
        // Trigger background reconciliation without closing the modal
        syncSharedIouSettlements().catch(console.error);
        return;
      }

      // Success, just fire the sync and close the modal.
      // If sync fails, the proposal is still safely in the cloud, so we don't alert failure.
      syncSharedIouSettlements().catch(console.error);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Network error.');
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
                max={availableToPropose}
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-accent text-accent-foreground rounded-xl text-sm font-medium 
hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-accent-foreground/30 border-t-accent-foreground animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                'Send for confirmation'
              )}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
