import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { differenceInDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { getBudgetStatus } from '../utils/budgetUtils';

export default function Dashboard() {
  const navigate = useNavigate();
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const budgets = useLiveQuery(() => db.budgets.toArray()) || [];
  const activeBudget = budgets.find(b => b.status === 'active');
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];

  // ── Balances ────────────────────────────────────────────────────────────────
  const totalBalance = accounts
    .filter(a => a.includeInTotal)
    .reduce((sum, a) => sum + a.balance, 0);

  // ── Budget pace ─────────────────────────────────────────────────────────────
  let spentThisPeriod = 0;
  let daysLeft = 0;
  let budgetStatus = getBudgetStatus(0, 0);

  if (activeBudget) {
    const today = Date.now();
    const periodTxns = transactions.filter(
      t => t.type === 'expense' && !t.excludeFromBudget && t.date >= activeBudget.startDate && t.date <= activeBudget.endDate
    );
    spentThisPeriod = periodTxns.reduce(
      (sum, t) => sum + (t.isShared && t.personalAmount ? t.personalAmount : t.amount),
      0
    );
    daysLeft = Math.max(0, differenceInDays(activeBudget.endDate, today));
    budgetStatus = getBudgetStatus(spentThisPeriod, activeBudget.amount);
  }

  // ── Recent transactions ──────────────────────────────────────────────────────
  const recentTransactions = [...transactions]
    .sort((a, b) => b.date - a.date)
    .slice(0, 5);

  const accIcon = (type: string) =>
    type === 'cash' ? '💵' : type === 'wallet' ? '👛' : type === 'bank' ? '🏦' : type === 'card' ? '💳' : type === 'savings' ? '🐷' : '📦';

  return (
    <div className="p-6 pb-36">
      {/* ── Available balance ──────────────────────────────────────────────── */}
      <header className="mb-6 mt-4">
        <h1 className="text-5xl font-light tracking-tight text-foreground mb-1">
          <span className="text-2xl align-top mr-1">LKR</span>
          {totalBalance.toLocaleString()}
        </h1>
        <p className="text-muted-foreground text-sm font-medium mb-4">Available</p>

        {/* Account pills — read-only glance */}
        <div className="flex overflow-x-auto pb-1 -mx-6 px-6 hide-scrollbar space-x-2">
          {accounts.map(acc => (
            <div
              key={acc.id}
              className={`flex-shrink-0 px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5
                ${acc.includeInTotal
                  ? 'bg-card border-border text-foreground'
                  : 'bg-muted border-dashed border-border text-muted-foreground'}`}
            >
              <span>{accIcon(acc.type)}</span>
              <span>{acc.name}</span>
              <span className="text-muted-foreground">LKR {acc.balance.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </header>

      {/* ── Budget glance — tap to manage ─────────────────────────────────── */}
      <button
        onClick={() => navigate('/budget')}
        className="w-full text-left mb-8 active:scale-[0.99] transition-transform"
      >
        {activeBudget ? (
          <div className="bg-card rounded-2xl p-5 border border-border shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-1">{activeBudget.name}</p>
                <p className="text-3xl font-light text-foreground">
                  LKR {budgetStatus.remaining.toLocaleString()}
                  <span className={`text-sm font-normal ml-2 ${budgetStatus.isOverspent ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
                    {budgetStatus.label}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-3.5 h-3.5 rounded-full ${budgetStatus.dotColor} shadow-sm ${budgetStatus.glowColor}`} />
                <ChevronRight size={18} className="text-muted-foreground opacity-50" />
              </div>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden mb-2">
              <div
                className={`h-full rounded-full transition-all duration-500 ${budgetStatus.barColor}`}
                style={{ width: `${budgetStatus.percent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground font-medium">
              <span>LKR {spentThisPeriod.toLocaleString()} of LKR {activeBudget.amount.toLocaleString()} spent</span>
              <span>{daysLeft}d left</span>
            </div>
          </div>
        ) : (
          <div className="bg-muted rounded-2xl p-5 border border-dashed border-border flex items-center justify-between text-muted-foreground">
            <span className="text-sm font-medium">No budget · Tap to set one up</span>
            <ChevronRight size={18} className="opacity-50" />
          </div>
        )}
      </button>

      {/* ── Recent activity glance ────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Recent</h2>
        <div className="space-y-2">
          {recentTransactions.map(txn => (
            <div key={txn.id} className="flex items-center justify-between p-3 bg-card border border-border rounded-xl shadow-sm">
              <div className="flex items-center">
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-base mr-3">
                  {txn.type === 'expense' ? '💸' : txn.type === 'income' ? '💰' : '🔄'}
                </div>
                <div>
                  <p className="font-medium text-foreground text-sm leading-tight">
                    {txn.notes || (txn.type === 'expense' ? 'Expense' : txn.type === 'income' ? 'Income' : 'Transfer')}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <span>{new Date(txn.date).toLocaleDateString()}</span>
                    {txn.excludeFromBudget && (
                      <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium px-1.5 py-0.5 rounded">
                        Out of budget
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <span className={`font-medium text-sm ${txn.type === 'expense' ? 'text-foreground' : txn.type === 'income' ? 'text-green-500' : 'text-muted-foreground'}`}>
                {txn.type === 'expense' ? '−' : txn.type === 'income' ? '+' : ''}LKR {txn.amount.toLocaleString()}
              </span>
            </div>
          ))}
          {recentTransactions.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-6">No activity yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
