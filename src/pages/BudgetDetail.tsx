import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { differenceInDays } from 'date-fns';
import { ChevronLeft, Check, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../store/uiStore';

export default function BudgetDetail() {
  const navigate = useNavigate();
  const { setBudgetModalOpen } = useUIStore();

  const budgets = useLiveQuery(() => db.budgets.toArray()) || [];
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];

  const activeBudget = budgets.find(b => b.status === 'active');
  const pastBudgets = budgets
    .filter(b => b.status === 'ended')
    .sort((a, b) => b.endDate - a.endDate);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // ── Active budget calculations ──────────────────────────────────────────────
  let spentThisPeriod = 0;
  let remainingBudget = 0;
  let onTrackStatus = '🟢';
  let progressPercentage = 0;
  let daysLeft = 0;

  if (activeBudget) {
    const today = Date.now();
    const periodTxns = transactions.filter(
      t => t.type === 'expense' && t.date >= activeBudget.startDate && t.date <= activeBudget.endDate
    );
    spentThisPeriod = periodTxns.reduce((sum, t) => sum + (t.isShared && t.personalAmount ? t.personalAmount : t.amount), 0);
    remainingBudget = activeBudget.amount - spentThisPeriod;
    progressPercentage = Math.min(100, Math.max(0, (spentThisPeriod / activeBudget.amount) * 100));
    const totalDays = activeBudget.periodLength;
    const daysElapsed = Math.max(1, differenceInDays(today, activeBudget.startDate) + 1);
    daysLeft = Math.max(0, differenceInDays(activeBudget.endDate, today));
    const expectedRate = activeBudget.amount / totalDays;
    const actualRate = spentThisPeriod / daysElapsed;
    onTrackStatus = actualRate <= expectedRate ? '🟢' : actualRate <= expectedRate * 1.2 ? '🟡' : '🔴';
  }

  const startRename = () => {
    setRenameValue(activeBudget?.name || '');
    setIsRenaming(true);
  };

  const saveRename = async () => {
    if (renameValue.trim() && activeBudget) {
      await db.budgets.update(activeBudget.id, { name: renameValue.trim() });
    }
    setIsRenaming(false);
  };

  const endBudget = async () => {
    if (!activeBudget) return;
    if (confirm(`End "${activeBudget.name}" now? This freezes its final numbers.`)) {
      await db.budgets.update(activeBudget.id, { status: 'ended', endDate: Date.now() });
    }
  };

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="flex items-center p-4 pt-6 border-b border-border">
        <button onClick={() => navigate('/')} className="p-2 -ml-2 text-muted-foreground active:scale-95">
          <ChevronLeft size={24} />
        </button>
        <h2 className="text-xl font-medium text-foreground ml-1">Budget</h2>
      </div>

      <div className="p-6 space-y-6">
        {/* ── Active Budget ──────────────────────────────────────────────────── */}
        {activeBudget ? (
          <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-5">
              {/* Rename */}
              <div className="mb-4">
                {isRenaming ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setIsRenaming(false); }}
                      className="flex-1 text-lg font-medium bg-background border border-border rounded-xl px-3 py-2 outline-none focus:border-foreground text-foreground"
                      autoFocus
                    />
                    <button onClick={saveRename} className="p-2 bg-accent text-accent-foreground rounded-xl"><Check size={18} /></button>
                    <button onClick={() => setIsRenaming(false)} className="p-2 bg-muted text-muted-foreground rounded-xl"><X size={18} /></button>
                  </div>
                ) : (
                  <button onClick={startRename} className="text-left">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Active Budget</p>
                    <p className="text-xl font-medium text-foreground">{activeBudget.name} <span className="text-muted-foreground text-base">✏️</span></p>
                  </button>
                )}
              </div>

              {/* Stats */}
              <div className="flex justify-between items-center mb-3">
                <div>
                  <p className="text-3xl font-light text-foreground">LKR {remainingBudget.toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">of LKR {activeBudget.amount.toLocaleString()} remaining</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl">{onTrackStatus}</span>
                  <p className="text-xs text-muted-foreground mt-1">{daysLeft}d left</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${onTrackStatus === '🔴' ? 'bg-red-500' : onTrackStatus === '🟡' ? 'bg-yellow-400' : 'bg-foreground'}`}
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground font-medium">
                <span>Spent LKR {spentThisPeriod.toLocaleString()}</span>
                <span>
                  {new Date(activeBudget.startDate).toLocaleDateString()} –{' '}
                  {new Date(activeBudget.endDate).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="border-t border-border flex divide-x divide-border">
              <button
                onClick={endBudget}
                className="flex-1 py-3.5 text-sm font-medium text-red-500 hover:bg-red-500/10 active:bg-red-500/20 transition-colors"
              >
                End Budget
              </button>
              <button
                onClick={() => setBudgetModalOpen(true)}
                className="flex-1 py-3.5 text-sm font-medium text-foreground hover:bg-muted/50 active:bg-muted transition-colors"
              >
                + New Budget
              </button>
            </div>
          </section>
        ) : (
          <section className="bg-muted/50 rounded-2xl border border-dashed border-border p-8 flex flex-col items-center text-center">
            <div className="text-3xl mb-3">📅</div>
            <h3 className="font-medium text-foreground mb-1">No Active Budget</h3>
            <p className="text-sm text-muted-foreground mb-5">Start a new budget period to track your spending pace.</p>
            <button
              onClick={() => setBudgetModalOpen(true)}
              className="bg-accent text-accent-foreground px-6 py-3 rounded-xl text-sm font-medium active:scale-95 transition-transform"
            >
              + New Budget
            </button>
          </section>
        )}

        {/* ── Past Budgets ───────────────────────────────────────────────────── */}
        {pastBudgets.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Past Periods</h3>
            <div className="bg-card rounded-2xl border border-border shadow-sm divide-y divide-border overflow-hidden">
              {pastBudgets.map(budget => {
                const periodTxns = transactions.filter(
                  t => t.type === 'expense' && t.date >= budget.startDate && t.date <= budget.endDate
                );
                const spent = periodTxns.reduce(
                  (sum, t) => sum + (t.isShared && t.personalAmount ? t.personalAmount : t.amount),
                  0
                );
                const over = spent > budget.amount;
                const pct = Math.min(100, Math.round((spent / budget.amount) * 100));
                const icon = over ? '🔴' : spent > budget.amount * 0.9 ? '🟡' : '🟢';

                return (
                  <div key={budget.id} className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium text-foreground">{budget.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(budget.startDate).toLocaleDateString()} – {new Date(budget.endDate).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-base">{icon}</span>
                        <p className="text-sm font-medium text-foreground">
                          {pct}%
                        </p>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-muted-foreground'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                      <span>LKR {spent.toLocaleString()} spent</span>
                      <span>of LKR {budget.amount.toLocaleString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

