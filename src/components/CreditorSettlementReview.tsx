import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatMoney } from '../utils/formatters';
import { syncSharedIouSettlements, syncSharedIous } from '../sync/sharedIouSync';
import type { CacheSharedIouSettlement } from '../db/db';
import { db } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { createId } from '../utils/createId';
import { triggerSync } from '../sync/syncEngine';

interface Props {
  settlement: CacheSharedIouSettlement;
  currency: string;
  remainingAmount: number;
  personName: string;
}

export default function CreditorSettlementReview({ settlement, currency, remainingAmount, personName }: Props) {
  const [actioning, setActioning] = useState<'confirm' | 'reject' | null>(null);
  const [error, setError] = useState('');
  
  const [depositToAccount, setDepositToAccount] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [depositAmount, setDepositAmount] = useState(String(settlement.amount));
  const [isConfirmed, setIsConfirmed] = useState(false);

  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  const handleAction = async (action: 'confirm' | 'reject') => {
    setError('');
    
    let numDepositAmount = 0;
    if (action === 'confirm' && depositToAccount) {
      numDepositAmount = parseFloat(depositAmount);
      if (!accountId) {
        setError('Please select an account for the deposit.');
        return;
      }
      if (isNaN(numDepositAmount) || numDepositAmount <= 0) {
        setError('Deposit amount must be greater than 0.');
        return;
      }
      if (numDepositAmount > settlement.amount) {
        setError('Deposit amount cannot exceed the payment claim.');
        return;
      }
    }

    setActioning(action);
    try {
      const rpcName = action === 'confirm' ? 'confirm_iou_payment' : 'reject_iou_payment';
      const { error: rpcError } = await supabase.rpc(rpcName, { p_settlement_id: settlement.id });

      if (rpcError) {
        setError(rpcError.message || `Failed to ${action} payment.`);
        setActioning(null);
        // Fire a background refresh just in case it's a stale state error
        syncSharedIouSettlements().catch(console.error);
        syncSharedIous().catch(console.error);
        return;
      }

      // Success on RPC! Now handle local Dexie deposit if requested.
      let localError = '';
      if (action === 'confirm' && depositToAccount && numDepositAmount > 0) {
        try {
          const now = Date.now();
          const txnId = createId('txn');
          
          await db.transaction('rw', [db.accounts, db.transactions], async () => {
            const acc = await db.accounts.get(accountId);
            if (!acc) throw new Error('Account not found locally.');
            
            await db.accounts.update(accountId, {
              balance: acc.balance + numDepositAmount,
              updatedAt: now
            });
            
            await db.transactions.add({
              id: txnId,
              type: 'debt_settlement',
              amount: numDepositAmount,
              date: now,
              accountId,
              notes: `Settlement from ${personName}`,
              debtDirection: 'theyOweMe', // Meaning money came in
              updatedAt: now
            });
          });
          
          triggerSync('accounts', accountId);
          triggerSync('transactions', txnId);
        } catch (e: any) {
          console.error('Local deposit failed:', e);
          const selectedAccount = accounts.find(a => a.id === accountId);
          const accountName = selectedAccount ? selectedAccount.name : 'account';
          localError = `Payment confirmed, but could not record the deposit of ${formatMoney(numDepositAmount, currency)} to ${accountName}. Please add it manually.`;
        }
      }

      Promise.all([
        syncSharedIouSettlements(),
        syncSharedIous()
      ]).catch(console.error);
      
      if (localError) {
        setError(localError);
        setActioning(null);
        setIsConfirmed(true);
      }
      
    } catch (err: any) {
      setError(err.message || 'Network error.');
      setActioning(null);
    }
  };

  const isOverpayment = settlement.amount > remainingAmount;
  const excess = isOverpayment ? settlement.amount - remainingAmount : 0;

  return (
    <div className="bg-muted/10 border border-border/40 rounded-xl p-3 mt-1 space-y-3">
      <div className="space-y-1.5">
        {isOverpayment ? (
          <div className="text-xs space-y-1 bg-amber-500/10 text-amber-600 p-2.5 rounded-lg">
            <p className="font-semibold flex items-center justify-between"><span>Payment:</span> <span>{formatMoney(settlement.amount, currency)}</span></p>
            <p className="flex items-center justify-between opacity-90"><span>Settles what you were owed:</span> <span>{formatMoney(remainingAmount, currency)}</span></p>
            <p className="font-semibold flex items-center justify-between pt-1 border-t border-amber-500/20 mt-1"><span>You will owe {personName}:</span> <span>{formatMoney(excess, currency)}</span></p>
          </div>
        ) : (
          <span className="text-sm font-medium text-foreground block mb-1.5">
            Payment claimed - {formatMoney(settlement.amount, currency)}
          </span>
        )}
        {settlement.note && (
          <p className="text-xs text-muted-foreground italic">Note: {settlement.note}</p>
        )}
      </div>

      <div className="pt-2 border-t border-border/50">
        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-foreground w-max select-none">
          <input
            type="checkbox"
            checked={depositToAccount}
            onChange={(e) => setDepositToAccount(e.target.checked)}
            disabled={!!actioning}
            className="w-4 h-4 rounded border-border/60 text-accent focus:ring-accent/20 cursor-pointer"
          />
          Deposit to account
        </label>

        {depositToAccount && (
          <div className="mt-3 space-y-3 bg-background/50 p-3 rounded-xl border border-border/40">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground block">
                Account
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={!!actioning}
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
                  max={settlement.amount}
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  disabled={!!actioning}
                  className="w-full bg-background border border-border/60 rounded-lg pl-12 pr-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-500 bg-red-500/10 p-2 rounded-lg">{error}</p>}
      
      <div className="flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); handleAction('reject'); }}
          disabled={!!actioning || isConfirmed}
          className="flex-1 px-3 py-2 text-xs font-medium text-red-500 bg-red-500/10 hover:bg-red-500/20 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {actioning === 'reject' && (
            <div className="w-3 h-3 rounded-full border-2 border-red-500/30 border-t-red-500 animate-spin" />
          )}
          {actioning === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleAction('confirm'); }}
          disabled={!!actioning || isConfirmed}
          className="flex-1 px-3 py-2 text-xs font-medium text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {actioning === 'confirm' && (
            <div className="w-3 h-3 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" />
          )}
          {isConfirmed ? 'Confirmed' : (actioning === 'confirm' ? 'Confirming...' : 'Confirm')}
        </button>
      </div>
    </div>
  );
}
