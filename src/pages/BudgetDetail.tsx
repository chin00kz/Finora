import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Budget, Transaction } from '../db/db';
import { differenceInDays, format } from 'date-fns';
import { ChevronLeft, Check, X, Download, Pencil, Trash2, RotateCcw, ArchiveRestore } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../store/uiStore';
import { triggerSync } from '../sync/syncEngine';
import { getBudgetStatus } from '../utils/budgetUtils';
import {
  canContinueBudget,
  canRestoreArchivedBudget,
  patchForArchivingBudget,
  patchForEndingBudget,
  patchForRestoringArchivedBudget,
  resolveActiveBudget,
} from '../utils/budgetLifecycle';
import { healMultipleActiveBudgets } from '../utils/budgetHeal';
import {
  expensePersonalSpendAmount,
  listBudgetCountedExpenses,
  sumBudgetSpending,
} from '../utils/spendingAmount';
import ExportReportModal from '../components/ExportReportModal';
import { useConfirm } from '../components/ConfirmDialog';
import MaskedAmount from '../components/MaskedAmount';
import NotificationBell from '../components/NotificationBell';

function BudgetPeriodActivity({
  transactions,
  range,
  categoryName,
}: {
  transactions: Transaction[];
  range: { startDate: number; endDate: number };
  categoryName: (id?: string) => string;
}) {
  const periodTxns = listBudgetCountedExpenses(transactions, range);

  return (
    <section>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
        Activity in this period
      </h3>
      {periodTxns.length === 0 ? (
        <p className="text-sm text-muted-foreground bg-muted/40 rounded-xl p-4">
          No budget-counted expenses in this window.
        </p>
      ) : (
        <div className="bg-card rounded-2xl border border-border shadow-sm divide-y divide-border overflow-hidden">
          {periodTxns.map(t => (
            <div key={t.id} className="p-4 flex justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {t.notes?.trim() || categoryName(t.categoryId)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(t.date, 'MMM d, yyyy')} · {categoryName(t.categoryId)}
                </p>
              </div>
              <p className="text-sm font-medium text-foreground tabular-nums shrink-0">
                LKR <MaskedAmount amount={expensePersonalSpendAmount(t)} />
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BudgetPeriodStats({
  budget,
  transactions,
  showPace,
}: {
  budget: Budget;
  transactions: Transaction[];
  showPace: boolean;
}) {
  const range = { startDate: budget.startDate, endDate: budget.endDate };
  const spent = sumBudgetSpending(transactions, range);
  const status = getBudgetStatus(spent, budget.amount, showPace ? range : undefined);
  const daysLeft = Math.max(0, differenceInDays(budget.endDate, Date.now()));
  const outOfBudgetSpent = transactions.reduce((sum, t) => {
    if (t.type !== 'expense' || !t.excludeFromBudget) return sum;
    if (t.date < range.startDate || t.date > range.endDate) return sum;
    return sum + expensePersonalSpendAmount(t);
  }, 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <div>
          <p className="text-3xl font-light text-foreground">
            LKR <MaskedAmount amount={status.remaining} />
            <span className={`text-sm font-normal ml-2 ${status.isOverspent ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
              {status.label}
            </span>
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {status.isOverspent ? (
              <>
                LKR <MaskedAmount amount={status.remaining} /> over{' '}
                {budget.id.startsWith('bud-cont-') ? 'opening available of' : 'budget of'} LKR{' '}
                <MaskedAmount amount={budget.amount} />
              </>
            ) : (
              <>
                LKR <MaskedAmount amount={budget.amount} />{' '}
                {budget.id.startsWith('bud-cont-') ? 'opening available' : 'period limit'}
              </>
            )}
          </p>
        </div>
        <div className="text-right flex flex-col items-end">
          <span className={`w-3.5 h-3.5 rounded-full ${status.dotColor} shadow-sm ${status.glowColor}`} />
          {showPace && budget.status === 'active' && (
            <p className="text-xs text-muted-foreground mt-1.5">{daysLeft}d left</p>
          )}
          {status.paceWarning && showPace && (
            <p className={`text-[11px] mt-1 ${status.textColor}`}>{status.paceWarning}</p>
          )}
        </div>
      </div>

      <div className="h-2 w-full bg-muted rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${status.barColor}`}
          style={{ width: `${status.percent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground font-medium">
        <span>
          Spent LKR <MaskedAmount amount={spent} /> · {status.actualPercent}%
        </span>
        <span>
          {new Date(budget.startDate).toLocaleDateString()} –{' '}
          {new Date(budget.endDate).toLocaleDateString()}
        </span>
      </div>

      {outOfBudgetSpent > 0 && (
        <div className="mt-3 pt-3 border-t border-border flex justify-between items-center text-xs">
          <span className="text-muted-foreground">Out-of-budget expenses</span>
          <span className="font-medium text-amber-600 dark:text-amber-400">
            LKR <MaskedAmount amount={outOfBudgetSpent} />
          </span>
        </div>
      )}
    </div>
  );
}

export default function BudgetDetail() {
  const navigate = useNavigate();
  const { setBudgetModalOpen } = useUIStore();
  const { confirmDialog, requestConfirm } = useConfirm();

  const budgets = useLiveQuery(() => db.budgets.toArray()) || [];
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];

  const [viewingEndedId, setViewingEndedId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isExportOpen, setIsExportOpen] = useState(false);

  useEffect(() => {
    void healMultipleActiveBudgets();
  }, []);

  const activeBudget = resolveActiveBudget(budgets);
  const endedBudgets = budgets
    .filter(b => b.status === 'ended')
    .sort((a, b) => b.endDate - a.endDate);
  const archivedBudgets = budgets
    .filter(b => b.status === 'archived')
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const viewingEnded = viewingEndedId
    ? endedBudgets.find(b => b.id === viewingEndedId) ??
      budgets.find(b => b.id === viewingEndedId && b.status === 'ended')
    : undefined;

  useEffect(() => {
    if (viewingEndedId && !budgets.some(b => b.id === viewingEndedId && b.status === 'ended')) {
      setViewingEndedId(null);
    }
  }, [viewingEndedId, budgets]);

  const categoryName = (id?: string) =>
    categories.find(c => c.id === id)?.name || 'Uncategorized';

  const startRename = () => {
    setRenameValue(activeBudget?.name || '');
    setIsRenaming(true);
  };

  const saveRename = async () => {
    if (renameValue.trim() && activeBudget) {
      await db.budgets.update(activeBudget.id, { name: renameValue.trim(), updatedAt: Date.now() });
      triggerSync('budgets', activeBudget.id);
    }
    setIsRenaming(false);
  };

  const endBudget = async () => {
    if (!activeBudget) return;
    const ok = await requestConfirm({
      title: `End "${activeBudget.name}" now?`,
      body: 'This freezes its final numbers. Transactions are kept.',
      danger: true,
      confirmLabel: 'End budget',
    });
    if (ok) {
      const now = Date.now();
      await db.budgets.update(activeBudget.id, patchForEndingBudget(activeBudget, now));
      triggerSync('budgets', activeBudget.id);
    }
  };

  const archiveBudget = async (budget: Budget) => {
    const ok = await requestConfirm({
      title: `Hide "${budget.name}"?`,
      body: 'Archives this period from your lists. Transactions are not deleted. You can restore it later from Archived.',
      danger: true,
      confirmLabel: 'Hide period',
    });
    if (!ok) return;
    await db.budgets.update(budget.id, patchForArchivingBudget());
    triggerSync('budgets', budget.id);
    if (viewingEndedId === budget.id) setViewingEndedId(null);
  };

  const restoreBudget = async (budget: Budget) => {
    const gate = canRestoreArchivedBudget(budget, budgets);
    if (!gate.ok) {
      void requestConfirm({
        title: 'Cannot restore',
        body: gate.error,
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
      return;
    }
    const ok = await requestConfirm({
      title: `Restore "${budget.name}"?`,
      body: 'Returns this period to Ended with the same dates and limit. Its id is unchanged. Transactions are not modified.',
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    await db.budgets.update(budget.id, patchForRestoringArchivedBudget());
    triggerSync('budgets', budget.id);
  };

  const openContinue = (budget: Budget) => {
    const gate = canContinueBudget(budget, budgets);
    if (!gate.ok) {
      void requestConfirm({
        title: 'Cannot continue',
        body: gate.error,
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
      return;
    }
    setBudgetModalOpen(true, { mode: 'continue', budgetId: budget.id });
  };

  // ── Ended budget detail ───────────────────────────────────────────────────
  if (viewingEnded) {
    const range = { startDate: viewingEnded.startDate, endDate: viewingEnded.endDate };
    const continueGate = canContinueBudget(viewingEnded, budgets);

    return (
      <div className="pb-28 max-w-5xl mx-auto">
        {confirmDialog}
        <div className="flex items-center justify-between p-4 pt-6 border-b border-border">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setViewingEndedId(null)}
              className="p-2 -ml-2 text-muted-foreground active:scale-95"
              aria-label="Back to budgets"
            >
              <ChevronLeft size={24} />
            </button>
            <h2 className="text-xl font-medium text-foreground ml-1">Ended Budget</h2>
          </div>
          <NotificationBell />
        </div>

        <div className="p-6 space-y-6">
          <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Period results
              </p>
              <p className="text-xl font-medium text-foreground mb-4">{viewingEnded.name}</p>
              <BudgetPeriodStats budget={viewingEnded} transactions={transactions} showPace={false} />
              <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
                Totals and activity are recalculated from your current transactions in this date window.
                Editing or deleting expenses later can change these historical numbers.
              </p>
            </div>
            <div className="border-t border-border grid grid-cols-3 divide-x divide-border">
              <button
                type="button"
                onClick={() => setBudgetModalOpen(true, { mode: 'edit', budgetId: viewingEnded.id })}
                className="py-3.5 text-sm font-medium text-foreground hover:bg-muted/50 flex items-center justify-center gap-1.5"
                aria-label={`Edit ended budget ${viewingEnded.name}`}
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                type="button"
                disabled={!continueGate.ok}
                onClick={() => openContinue(viewingEnded)}
                className="py-3.5 text-sm font-medium text-foreground hover:bg-muted/50 flex items-center justify-center gap-1.5 disabled:opacity-40"
                aria-label={`Continue budget ${viewingEnded.name}`}
              >
                <RotateCcw size={14} /> Continue
              </button>
              <button
                type="button"
                onClick={() => void archiveBudget(viewingEnded)}
                className="py-3.5 text-sm font-medium text-red-500 hover:bg-red-500/10 flex items-center justify-center gap-1.5"
                aria-label={`Hide budget period ${viewingEnded.name}`}
              >
                <Trash2 size={14} /> Hide
              </button>
            </div>
          </section>

          {!continueGate.ok && (
            <p className="text-xs text-muted-foreground">{continueGate.error}</p>
          )}

          <BudgetPeriodActivity
            transactions={transactions}
            range={range}
            categoryName={categoryName}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-28 max-w-5xl mx-auto">
      {confirmDialog}
      <div className="flex items-center justify-between p-4 pt-6 border-b border-border">
        <div className="flex items-center">
          <button type="button" onClick={() => navigate('/')} className="p-2 -ml-2 text-muted-foreground active:scale-95">
            <ChevronLeft size={24} />
          </button>
          <h2 className="text-xl font-medium text-foreground ml-1">Budget</h2>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            type="button"
            onClick={() => setIsExportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border hover:bg-muted text-xs font-medium rounded-xl text-foreground transition-colors shadow-xs"
          >
            <Download size={14} />
            <span>Export Report</span>
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {activeBudget ? (
          <>
            <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="p-5">
                <div className="mb-4">
                  {isRenaming ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void saveRename();
                          if (e.key === 'Escape') setIsRenaming(false);
                        }}
                        className="flex-1 text-lg font-medium bg-background border border-border rounded-xl px-3 py-2 outline-none focus:border-foreground text-foreground"
                        autoFocus
                      />
                      <button type="button" onClick={() => void saveRename()} className="p-2 bg-accent text-accent-foreground rounded-xl">
                        <Check size={18} />
                      </button>
                      <button type="button" onClick={() => setIsRenaming(false)} className="p-2 bg-muted text-muted-foreground rounded-xl">
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={startRename} className="text-left">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Active Budget</p>
                      <p className="text-xl font-medium text-foreground">{activeBudget.name}</p>
                    </button>
                  )}
                </div>

                <BudgetPeriodStats budget={activeBudget} transactions={transactions} showPace />
              </div>

              <div className="border-t border-border grid grid-cols-2 sm:grid-cols-4 divide-x divide-border">
                <button
                  type="button"
                  onClick={() => setBudgetModalOpen(true, { mode: 'edit', budgetId: activeBudget.id })}
                  className="py-3.5 text-sm font-medium text-foreground hover:bg-muted/50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void endBudget()}
                  className="py-3.5 text-sm font-medium text-red-500 hover:bg-red-500/10"
                >
                  End
                </button>
                <button
                  type="button"
                  onClick={() => void archiveBudget(activeBudget)}
                  className="py-3.5 text-sm font-medium text-red-500 hover:bg-red-500/10"
                  aria-label={`Hide active budget ${activeBudget.name}`}
                >
                  Hide
                </button>
                <button
                  type="button"
                  onClick={() => setBudgetModalOpen(true, { mode: 'create' })}
                  className="py-3.5 text-sm font-medium text-foreground hover:bg-muted/50"
                >
                  + New
                </button>
              </div>
            </section>

            <BudgetPeriodActivity
              transactions={transactions}
              range={{ startDate: activeBudget.startDate, endDate: activeBudget.endDate }}
              categoryName={categoryName}
            />
          </>
        ) : (
          <section className="bg-muted/50 rounded-2xl border border-dashed border-border p-8 flex flex-col items-center text-center">
            <h3 className="font-medium text-foreground mb-1">No Active Budget</h3>
            <p className="text-sm text-muted-foreground mb-5">
              Start a new budget period to track your spending pace.
            </p>
            <button
              type="button"
              onClick={() => setBudgetModalOpen(true, { mode: 'create' })}
              className="bg-accent text-accent-foreground px-6 py-3 rounded-xl text-sm font-medium active:scale-95 transition-transform"
            >
              + New Budget
            </button>
          </section>
        )}

        {endedBudgets.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Ended
            </h3>
            <div className="bg-card rounded-2xl border border-border shadow-sm divide-y divide-border overflow-hidden">
              {endedBudgets.map(budget => {
                const spent = sumBudgetSpending(transactions, {
                  startDate: budget.startDate,
                  endDate: budget.endDate,
                });
                const status = getBudgetStatus(spent, budget.amount);

                return (
                  <button
                    type="button"
                    key={budget.id}
                    onClick={() => setViewingEndedId(budget.id)}
                    className="w-full text-left p-4 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium text-foreground">{budget.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(budget.startDate).toLocaleDateString()} –{' '}
                          {new Date(budget.endDate).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${status.dotColor}`} />
                        <p className="text-sm font-medium text-foreground">{status.actualPercent}%</p>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${status.barColor}`}
                        style={{ width: `${status.percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                      <span>
                        LKR <MaskedAmount amount={spent} /> spent
                      </span>
                      <span>
                        of LKR <MaskedAmount amount={budget.amount} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {archivedBudgets.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Archived
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
              Hidden periods. Restore returns them to Ended with the same id and dates — never overwrites another period.
            </p>
            <div className="bg-card rounded-2xl border border-border shadow-sm divide-y divide-border overflow-hidden">
              {archivedBudgets.map(budget => {
                const spent = sumBudgetSpending(transactions, {
                  startDate: budget.startDate,
                  endDate: budget.endDate,
                });
                const restoreGate = canRestoreArchivedBudget(budget, budgets);
                return (
                  <div key={budget.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{budget.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(budget.startDate).toLocaleDateString()} –{' '}
                        {new Date(budget.endDate).toLocaleDateString()}
                        {' · '}
                        LKR <MaskedAmount amount={spent} /> spent
                      </p>
                      {!restoreGate.ok && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{restoreGate.error}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!restoreGate.ok}
                      onClick={() => void restoreBudget(budget)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-border hover:bg-muted disabled:opacity-40"
                      aria-label={`Restore archived budget ${budget.name}`}
                    >
                      <ArchiveRestore size={14} />
                      Restore
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <ExportReportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        defaultPeriod="current"
      />
    </div>
  );
}
