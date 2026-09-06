import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import {
  PieChart as PieChartIcon,
  BarChart3,
  TrendingUp,
  CreditCard,
  Download,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  format,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  eachDayOfInterval,
  isSameDay,
} from 'date-fns';
import ExportReportModal from '../components/ExportReportModal';

export default function Analytics() {
  const budgets = useLiveQuery(() => db.budgets.toArray()) || [];
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  const activeBudget = budgets.find(b => b.status === 'active');
  const pastBudgets = budgets.filter(b => b.status === 'ended');

  const [periodKey, setPeriodKey] = useState<string>('current');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // Derive active date range and filter transactions
  const { periodTransactions, periodLabel, dateRangeStr, budgetTarget } = useMemo(() => {
    const now = new Date();
    let txns = [...transactions];
    let label = 'All Time';
    let rangeStr = '';
    let target: number | undefined = undefined;

    if (periodKey === 'current' && activeBudget) {
      label = activeBudget.name;
      rangeStr = `${format(new Date(activeBudget.startDate), 'MMM dd')} – ${format(new Date(activeBudget.endDate), 'MMM dd, yyyy')}`;
      target = activeBudget.amount;
      txns = transactions.filter(
        t => t.date >= activeBudget.startDate && t.date <= activeBudget.endDate
      );
    } else if (periodKey.startsWith('budget_')) {
      const bId = periodKey.replace('budget_', '');
      const b = budgets.find(x => x.id === bId);
      if (b) {
        label = b.name;
        rangeStr = `${format(new Date(b.startDate), 'MMM dd')} – ${format(new Date(b.endDate), 'MMM dd, yyyy')}`;
        target = b.amount;
        txns = transactions.filter(t => t.date >= b.startDate && t.date <= b.endDate);
      }
    } else if (periodKey === 'this_month') {
      const start = startOfMonth(now).getTime();
      const end = endOfMonth(now).getTime();
      label = format(now, 'MMMM yyyy');
      rangeStr = `${format(start, 'MMM dd')} – ${format(end, 'MMM dd')}`;
      txns = transactions.filter(t => t.date >= start && t.date <= end);
    } else if (periodKey === '30_days') {
      const start = subDays(now, 30).getTime();
      label = 'Last 30 Days';
      rangeStr = `${format(start, 'MMM dd')} – ${format(now, 'MMM dd')}`;
      txns = transactions.filter(t => t.date >= start);
    }

    return { periodTransactions: txns, periodLabel: label, dateRangeStr: rangeStr, budgetTarget: target };
  }, [transactions, budgets, activeBudget, periodKey]);

  // Expenses only for spending charts
  const periodExpenses = useMemo(
    () => periodTransactions.filter(t => t.type === 'expense'),
    [periodTransactions]
  );

  const totalSpent = useMemo(
    () => periodExpenses.reduce((sum, t) => sum + (t.personalAmount ?? t.amount), 0),
    [periodExpenses]
  );

  const totalIncome = useMemo(
    () =>
      periodTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0),
    [periodTransactions]
  );

  // 1. Spending by Category (Donut + Ranked Bars)
  const categoryStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of periodExpenses) {
      const cId = t.categoryId || 'uncat';
      map.set(cId, (map.get(cId) || 0) + (t.personalAmount ?? t.amount));
    }

    const catLookup = new Map(categories.map(c => [c.id, c]));
    return Array.from(map.entries())
      .map(([cId, amount]) => {
        const cat = catLookup.get(cId);
        const percent = totalSpent > 0 ? (amount / totalSpent) * 100 : 0;
        return {
          id: cId,
          name: cat?.name || 'Uncategorized',
          color: cat?.color || '#64748b',
          amount,
          percent,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [periodExpenses, categories, totalSpent]);

  // 2. Spending Over Time (Daily Trend)
  const dailySpending = useMemo(() => {
    if (periodExpenses.length === 0) return [];

    let startDate: Date;
    let endDate: Date;

    if (periodKey === 'current' && activeBudget) {
      startDate = new Date(activeBudget.startDate);
      endDate = new Date(activeBudget.endDate);
    } else if (periodKey === 'this_month') {
      startDate = startOfMonth(new Date());
      endDate = endOfMonth(new Date());
    } else if (periodKey === '30_days') {
      startDate = subDays(new Date(), 30);
      endDate = new Date();
    } else {
      const dates = periodExpenses.map(t => t.date);
      startDate = new Date(Math.min(...dates));
      endDate = new Date(Math.max(...dates));
    }

    // Generate days interval
    try {
      const days = eachDayOfInterval({ start: startDate, end: endDate });
      return days.map(day => {
        const dayTxns = periodExpenses.filter(t => isSameDay(new Date(t.date), day));
        const amount = dayTxns.reduce((sum, t) => sum + (t.personalAmount ?? t.amount), 0);
        return {
          date: day,
          label: format(day, 'MMM dd'),
          shortLabel: format(day, 'd'),
          amount,
        };
      });
    } catch {
      return [];
    }
  }, [periodExpenses, periodKey, activeBudget]);

  const maxDailySpend = useMemo(
    () => Math.max(1, ...dailySpending.map(d => d.amount)),
    [dailySpending]
  );

  // 3. Monthly Comparison (This Month vs Last Month)
  const monthlyComparison = useMemo(() => {
    const now = new Date();
    const thisMonthStart = startOfMonth(now).getTime();
    const thisMonthEnd = endOfMonth(now).getTime();

    const lastMonthDate = subMonths(now, 1);
    const lastMonthStart = startOfMonth(lastMonthDate).getTime();
    const lastMonthEnd = endOfMonth(lastMonthDate).getTime();

    const thisMonthSpend = transactions
      .filter(t => t.type === 'expense' && t.date >= thisMonthStart && t.date <= thisMonthEnd)
      .reduce((sum, t) => sum + (t.personalAmount ?? t.amount), 0);

    const lastMonthSpend = transactions
      .filter(t => t.type === 'expense' && t.date >= lastMonthStart && t.date <= lastMonthEnd)
      .reduce((sum, t) => sum + (t.personalAmount ?? t.amount), 0);

    const diff = thisMonthSpend - lastMonthSpend;
    const percentDiff =
      lastMonthSpend > 0 ? Math.round((diff / lastMonthSpend) * 100) : thisMonthSpend > 0 ? 100 : 0;

    return {
      thisMonthSpend,
      lastMonthSpend,
      diff,
      percentDiff,
      thisMonthLabel: format(now, 'MMMM'),
      lastMonthLabel: format(lastMonthDate, 'MMMM'),
    };
  }, [transactions]);

  // 4. Cash vs Card/Account Split
  const accountTypeSplit = useMemo(() => {
    const accMap = new Map(accounts.map(a => [a.id, a]));
    let cashTotal = 0;
    let digitalTotal = 0;

    for (const t of periodExpenses) {
      const acc = accMap.get(t.accountId);
      const amt = t.personalAmount ?? t.amount;
      if (acc?.type === 'cash' || acc?.type === 'wallet') {
        cashTotal += amt;
      } else {
        digitalTotal += amt;
      }
    }

    const total = cashTotal + digitalTotal;
    const cashPct = total > 0 ? Math.round((cashTotal / total) * 100) : 0;
    const digitalPct = total > 0 ? Math.round((digitalTotal / total) * 100) : 0;

    return { cashTotal, digitalTotal, cashPct, digitalPct, total };
  }, [periodExpenses, accounts]);

  return (
    <div className="p-6 pb-28 max-w-5xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-foreground">Analytics</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Spending patterns, trends, and budget distribution
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Period Selector */}
          <div className="relative">
            <select
              value={periodKey}
              onChange={e => setPeriodKey(e.target.value)}
              className="appearance-none bg-card border border-border rounded-xl px-3.5 py-2 pr-8 text-xs font-medium text-foreground outline-none focus:border-foreground"
            >
              {activeBudget && <option value="current">Current: {activeBudget.name}</option>}
              <option value="this_month">This Month</option>
              <option value="30_days">Last 30 Days</option>
              {pastBudgets.map(b => (
                <option key={b.id} value={`budget_${b.id}`}>
                  Past: {b.name}
                </option>
              ))}
            </select>
            <Calendar
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
          </div>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-card border border-border rounded-xl text-xs font-medium text-foreground hover:bg-muted active:scale-95 transition-all shadow-sm"
          >
            <Download size={14} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Total Spent
          </p>
          <p className="text-2xl font-light text-foreground">
            LKR {totalSpent.toLocaleString()}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {periodLabel} &middot; {dateRangeStr}
          </p>
        </div>

        {budgetTarget !== undefined ? (
          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {totalSpent > budgetTarget ? 'Over Budget' : 'Remaining Budget'}
            </p>
            <p
              className={`text-2xl font-light ${
                totalSpent > budgetTarget ? 'text-red-500 font-normal' : 'text-foreground'
              }`}
            >
              LKR {Math.abs(budgetTarget - totalSpent).toLocaleString()}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Budget target: LKR {budgetTarget.toLocaleString()}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Total Income
            </p>
            <p className="text-2xl font-light text-emerald-500">
              LKR {totalIncome.toLocaleString()}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">For selected period</p>
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Daily Average
          </p>
          <p className="text-2xl font-light text-foreground">
            LKR{' '}
            {dailySpending.length > 0
              ? Math.round(totalSpent / dailySpending.length).toLocaleString()
              : '0'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Across {dailySpending.length} days recorded
          </p>
        </div>
      </div>

      {/* Grid: Category Breakdown (Donut + Bars) & Over Time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Chart 1: Spending by Category ────────────────────────────────── */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
              <PieChartIcon size={16} />
              <span>Spending by Category</span>
            </h2>
            <span className="text-xs text-muted-foreground">{categoryStats.length} categories</span>
          </div>

          {categoryStats.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
              No expense data recorded in this period.
            </div>
          ) : (
            <div>
              {/* Category ranked bars */}
              <div className="space-y-3">
                {categoryStats.map(cat => (
                  <div key={cat.id}>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="font-medium text-foreground">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          LKR {cat.amount.toLocaleString()}
                        </span>
                        <span className="text-muted-foreground w-9 text-right">
                          {Math.round(cat.percent)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Chart 2: Spending Over Time (Daily Bar Trend) ──────────────────── */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                <BarChart3 size={16} />
                <span>Spending Over Time</span>
              </h2>
              <span className="text-xs text-muted-foreground">{periodLabel}</span>
            </div>

            {dailySpending.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                No spending data for this period.
              </div>
            ) : (
              <div className="pt-4">
                {/* Visual SVG / HTML Bar Chart */}
                <div className="flex items-end gap-1.5 h-40 w-full overflow-x-auto pb-2 hide-scrollbar">
                  {dailySpending.map((d, i) => {
                    const heightPct = maxDailySpend > 0 ? (d.amount / maxDailySpend) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className="flex-1 min-w-[12px] max-w-[28px] h-full flex flex-col items-center justify-end group relative"
                      >
                        {/* Tooltip on hover */}
                        <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                          <div className="bg-foreground text-background text-[10px] px-2 py-1 rounded-md font-medium whitespace-nowrap shadow-md">
                            {d.label}: LKR {d.amount.toLocaleString()}
                          </div>
                          <div className="w-1.5 h-1.5 bg-foreground rotate-45 -mt-0.5" />
                        </div>

                        {/* Bar */}
                        <div
                          className="w-full rounded-t-sm transition-all duration-300 bg-muted-foreground/30 hover:bg-foreground"
                          style={{
                            height: `${Math.max(4, heightPct)}%`,
                          }}
                        />
                        {/* Label (sample every N days to avoid crowding) */}
                        {i % Math.max(1, Math.ceil(dailySpending.length / 7)) === 0 && (
                          <span className="text-[9px] text-muted-foreground mt-1.5">
                            {d.shortLabel}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-between items-center pt-3 border-t border-border text-[11px] text-muted-foreground">
            <span>Peak daily spend: LKR {maxDailySpend.toLocaleString()}</span>
            <span>Hover bars for daily details</span>
          </div>
        </section>
      </div>

      {/* Grid: Monthly Comparison & Payment Method Split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ── Chart 3: Monthly Comparison ──────────────────────────────────── */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
              <TrendingUp size={16} />
              <span>Monthly Comparison</span>
            </h2>
          </div>

          <div className="space-y-4">
            <div className="p-3 bg-muted/40 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{monthlyComparison.thisMonthLabel} (Current)</p>
                <p className="text-lg font-medium text-foreground mt-0.5">
                  LKR {monthlyComparison.thisMonthSpend.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{monthlyComparison.lastMonthLabel} (Previous)</p>
                <p className="text-lg font-medium text-muted-foreground mt-0.5">
                  LKR {monthlyComparison.lastMonthSpend.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {monthlyComparison.diff > 0 ? (
                <div className="flex items-center gap-1 text-red-500 font-medium bg-red-500/10 px-2.5 py-1 rounded-lg">
                  <ArrowUpRight size={14} />
                  <span>+{monthlyComparison.percentDiff}% vs last month</span>
                </div>
              ) : monthlyComparison.diff < 0 ? (
                <div className="flex items-center gap-1 text-emerald-500 font-medium bg-emerald-500/10 px-2.5 py-1 rounded-lg">
                  <ArrowDownRight size={14} />
                  <span>{monthlyComparison.percentDiff}% vs last month</span>
                </div>
              ) : (
                <div className="text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                  Same spending as last month
                </div>
              )}
              <span className="text-muted-foreground">
                ({Math.abs(monthlyComparison.diff).toLocaleString()} LKR difference)
              </span>
            </div>
          </div>
        </section>

        {/* ── Chart 4: Cash vs Card/Account Split ──────────────────────────── */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
              <CreditCard size={16} />
              <span>Cash vs Digital Split</span>
            </h2>
            <span className="text-xs text-muted-foreground">Payment accounts</span>
          </div>

          <div className="space-y-4">
            {/* Split Progress Bar */}
            <div>
              <div className="h-3 w-full bg-muted rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${accountTypeSplit.cashPct}%` }}
                />
                <div
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${accountTypeSplit.digitalPct}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-3 bg-muted/40 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs font-medium text-muted-foreground">Cash & Wallet</span>
                </div>
                <p className="text-base font-semibold text-foreground">
                  LKR {accountTypeSplit.cashTotal.toLocaleString()}
                </p>
                <p className="text-[11px] text-muted-foreground">{accountTypeSplit.cashPct}% of total</p>
              </div>

              <div className="p-3 bg-muted/40 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span className="text-xs font-medium text-muted-foreground">Bank & Cards</span>
                </div>
                <p className="text-base font-semibold text-foreground">
                  LKR {accountTypeSplit.digitalTotal.toLocaleString()}
                </p>
                <p className="text-[11px] text-muted-foreground">{accountTypeSplit.digitalPct}% of total</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        defaultPeriod={periodKey}
      />
    </div>
  );
}

