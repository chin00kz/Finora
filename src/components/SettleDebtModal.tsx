import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, RotateCcw, Wallet, Ban, Trash2, ArrowDownLeft, ArrowUpRight, History } from 'lucide-react';
import { db, type Debt } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { recordDebtSettlement, undoDebtSettlement, getDebtSettlementStatus } from '../utils/debtSettlementEngine';
import { deleteFromCloud, triggerSync } from '../sync/syncEngine';

interface Props {
  debt: Debt | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function SettleDebtModal({ debt, isOpen, onClose }: Props) {
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  // Live debt query so settlement history updates dynamically when undoing
  const liveDebt = useLiveQuery(
    () => (debt ? db.debts.get(debt.id) : undefined),
    [debt?.id]
  ) || debt;

  const { settledAmount, remainingAmount, isFullySettled, progressPercent } = liveDebt
    ? getDebtSettlementStatus(liveDebt)
    : { settledAmount: 0, remainingAmount: 0, isFullySettled: false, progressPercent: 0 };

  const [settleAmount, setSettleAmount] = useState('');
  const [method, setMethod] = useState<'account' | 'exclude'>('account');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'settle' | 'history'>('settle');

  useEffect(() => {
    if (liveDebt) {
      setSettleAmount(String(remainingAmount > 0 ? remainingAmount : ''));
      if (accounts.length > 0 && !accountId) {
        setAccountId(accounts[0].id);
      }
      setError('');
    }
  }, [liveDebt?.id, remainingAmount, accounts]);

  if (!isOpen || !liveDebt) return null;

  const isTheyOweMe = liveDebt.direction === 'theyOweMe';
  const accountMethodLabel = isTheyOweMe ? 'Add to Account' : 'Pay from Account';
  const settlements = liveDebt.settlements || [];

  const handleSettleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Number(settleAmount);

    if (!numAmount || numAmount <= 0 || isNaN(numAmount)) {
      setError('Please enter a valid settlement amount.');
      return;
    }

    if (numAmount > remainingAmount + 0.0001) {
      setError(`Amount cannot exceed remaining balance of LKR ${remainingAmount.toLocaleString()}`);
      return;
    }

    if (method === 'account' && !accountId) {
      setError('Please select an account.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const selectedDate = date ? new Date(date).getTime() : Date.now();
      const res = await recordDebtSettlement({
        debtId: liveDebt.id,
        amount: numAmount,
        method,
        accountId: method === 'account' ? accountId : undefined,
        date: selectedDate,
        note: note.trim() || undefined,
      });

      if (!res.success) {
        setError(res.error || 'Failed to record settlement.');
        setIsSubmitting(false);
        return;
      }

      setNote('');
      if (numAmount >= remainingAmount - 0.0001) {
        onClose();
      } else {
        // Switch to history tab or update settle amount for next partial settlement
        setSettleAmount(String(Math.max(0, remainingAmount - numAmount)));
      }
    } catch (err: any) {
      console.error('Settlement error', err);
      setError(err?.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUndo = async (settlementId: string) => {
    if (!confirm('Undo this settlement? Account balance will be restored.')) return;
    try {
      const res = await undoDebtSettlement(liveDebt.id, settlementId);
      if (!res.success) {
        setError(res.error || 'Failed to undo settlement.');
      }
    } catch (err: any) {
      console.error('Failed to undo settlement', err);
      setError(err?.message || 'Failed to undo settlement.');
    }
  };

  const handleDeleteDebt = async () => {
    if (!confirm('Delete this debt? Any account-linked settlements will be undone.')) return;
    try {
      // Undo settlements in reverse order
      const copySettlements = [...(liveDebt.settlements || [])].reverse();
      for (const s of copySettlements) {
        await undoDebtSettlement(liveDebt.id, s.id);
      }
      await db.debts.delete(liveDebt.id);
      await deleteFromCloud('debts', liveDebt.id);
      triggerSync();
      onClose();
    } catch (err: any) {
      console.error('Failed to delete debt', err);
      setError(err?.message || 'Failed to delete debt.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full duration-300">
        
        {/* Header */}
        <div className="p-5 border-b border-border flex justify-between items-start shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  isTheyOweMe
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}
              >
                {isTheyOweMe ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                {isTheyOweMe ? "They owe you" : "You owe them"}
              </span>
              {isFullySettled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                  <CheckCircle2 size={12} className="text-emerald-500" />
                  Fully Settled
                </span>
              )}
            </div>
            <h2 className="text-xl font-medium text-foreground">{liveDebt.personName}</h2>
            {liveDebt.note && (
              <p className="text-xs text-muted-foreground mt-0.5">{liveDebt.note}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-muted rounded-full text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
          >
            <X size={20} />
          </button>
        </div>

        {/* Debt Progress & Summary Card */}
        <div className="p-5 bg-muted/40 border-b border-border">
          <div className="flex justify-between items-end mb-2">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Remaining Balance</p>
              <p className="text-2xl font-semibold text-foreground">
                <span className="text-base font-normal text-muted-foreground mr-1">LKR</span>
                {remainingAmount.toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Original: LKR {liveDebt.amount.toLocaleString()}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                Settled: LKR {settledAmount.toLocaleString()} ({progressPercent}%)
              </p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isFullySettled ? 'bg-emerald-500' : isTheyOweMe ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Navigation Tabs if there is history */}
        {settlements.length > 0 && (
          <div className="flex border-b border-border bg-card px-5">
            <button
              onClick={() => setActiveTab('settle')}
              disabled={isFullySettled}
              className={`py-3 px-4 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'settle'
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              } ${isFullySettled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              Record Settlement
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`py-3 px-4 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'history'
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <History size={14} />
              <span>Settlement History ({settlements.length})</span>
            </button>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'settle' && !isFullySettled && (
            <form id="settle-form" onSubmit={handleSettleSubmit} className="space-y-5">
              {/* Amount to settle */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Settlement Amount
                  </label>
                  {remainingAmount > 0 && (
                    <button
                      type="button"
                      onClick={() => setSettleAmount(String(remainingAmount))}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      Pay full (LKR {remainingAmount.toLocaleString()})
                    </button>
                  )}
                </div>
                <div className="flex items-center text-3xl font-light">
                  <span className="text-lg text-muted-foreground mr-2 font-normal">LKR</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    required
                    min="0.01"
                    max={remainingAmount}
                    step="any"
                    value={settleAmount}
                    onChange={e => {
                      setSettleAmount(e.target.value);
                      if (error) setError('');
                    }}
                    placeholder="0"
                    className="w-full bg-transparent text-foreground outline-none font-light"
                  />
                </div>
              </div>

              {/* Settlement Method Selector */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Settlement Method
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-xl">
                  <button
                    type="button"
                    onClick={() => setMethod('account')}
                    className={`py-2.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                      method === 'account'
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Wallet size={15} />
                    <span>{accountMethodLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod('exclude')}
                    className={`py-2.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                      method === 'exclude'
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Ban size={15} />
                    <span>Without account</span>
                  </button>
                </div>
              </div>

              {/* Account Dropdown (if method === 'account') */}
              {method === 'account' ? (
                <div className="bg-muted/40 p-4 rounded-xl border border-border space-y-2 animate-in fade-in duration-200">
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {isTheyOweMe ? 'Deposit into Account' : 'Pay from Account'}
                  </label>
                  <select
                    value={accountId}
                    onChange={e => setAccountId(e.target.value)}
                    className="w-full p-3 bg-card border border-border rounded-xl text-sm font-medium text-foreground outline-none"
                  >
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} — LKR {acc.balance.toLocaleString()}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    ⚡ Budget-neutral: Updates your account balance without affecting your monthly budget pace.
                  </p>
                </div>
              ) : (
                <div className="bg-amber-500/10 p-4 rounded-xl border border-amber-500/20 text-xs text-muted-foreground animate-in fade-in duration-200">
                  <p className="font-medium text-foreground mb-0.5">Off-balance settlement</p>
                  Settles this debt in-kind (e.g. they bought you lunch, favor, or cash outside app). No accounts or budgets are modified.
                </div>
              )}

              {/* Date */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                  Settlement Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full p-3.5 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none"
                />
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                  Settlement Note (Optional)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="e.g. Bank transfer, Cash, Lunch offset"
                  className="w-full p-3.5 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs font-medium">
                  {error}
                </div>
              )}
            </form>
          )}

          {/* Fully settled state banner */}
          {isFullySettled && activeTab === 'settle' && (
            <div className="text-center py-8 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 size={24} />
              </div>
              <h3 className="font-medium text-foreground">This debt is fully settled!</h3>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                All LKR {liveDebt.amount.toLocaleString()} has been settled. You can review or undo settlement events in the History tab.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="px-4 py-2 bg-muted text-foreground text-xs font-medium rounded-xl hover:bg-muted/80"
              >
                View Settlement History
              </button>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Settlement Events ({settlements.length})
                </h4>
                {!isFullySettled && (
                  <button
                    onClick={() => setActiveTab('settle')}
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    + Record another
                  </button>
                )}
              </div>

              {settlements.map((s, idx) => {
                const acc = s.accountId ? accounts.find(a => a.id === s.accountId) : null;
                return (
                  <div
                    key={s.id || idx}
                    className="p-3.5 bg-background border border-border rounded-xl flex items-center justify-between shadow-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground text-sm">
                          LKR {s.amount.toLocaleString()}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${
                            s.method === 'account'
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {s.method === 'account' ? (acc ? acc.name : 'Account') : 'Without account'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(s.date).toLocaleDateString()}
                        {s.note ? ` · ${s.note}` : ''}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleUndo(s.id)}
                      className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg active:scale-95 transition-all"
                      title="Undo this settlement"
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>
                );
              })}

              {settlements.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No settlement history yet.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border flex items-center justify-between shrink-0 gap-3">
          <button
            type="button"
            onClick={handleDeleteDebt}
            className="p-3.5 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 active:scale-95 transition-colors"
            title="Delete Debt"
          >
            <Trash2 size={18} />
          </button>

          <div className="flex items-center gap-2 flex-1 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3.5 bg-muted text-muted-foreground rounded-xl text-sm font-medium hover:text-foreground active:scale-95 transition-transform"
            >
              Close
            </button>
            {activeTab === 'settle' && !isFullySettled && (
              <button
                type="submit"
                form="settle-form"
                disabled={isSubmitting || !settleAmount || Number(settleAmount) <= 0}
                className="flex-1 py-3.5 bg-accent text-accent-foreground rounded-xl text-sm font-medium shadow-sm active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {isSubmitting ? 'Saving…' : 'Record Settlement'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
