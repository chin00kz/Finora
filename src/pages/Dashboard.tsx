import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Transaction, type Category } from '../db/db';
import { differenceInDays, isToday, isYesterday, format, isSameDay } from 'date-fns';
import { getBudgetGlanceColors, getTransactionBaseline, getTransactionGlanceColor } from '../utils/glanceIntelligence';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Eye,
  EyeOff,
  ShieldCheck,
  X,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Utensils,
  Coffee,
  Bus,
  Car,
  ShoppingBag,
  Receipt,
  Film,
  HeartPulse,
  GraduationCap,
} from 'lucide-react';
import { getBudgetStatus } from '../utils/budgetUtils';
import { computeSafeToSpendSync } from '../utils/safeToSpendEngine';
import SafeToSpendCard from '../components/SafeToSpendCard';
import { usePrivacyStore } from '../store/privacyStore';
import MaskedAmount from '../components/MaskedAmount';

/**
 * Resolves a restrained, professional Lucide icon for a transaction row.
 * Emojis are eliminated. Most icons are neutral, reserving emerald for income.
 */
function getTransactionIcon(txn: Transaction, categories: Category[]) {
  if (txn.type === 'income') {
    return {
      Icon: ArrowDownLeft,
      iconClass: 'text-emerald-500',
      containerClass: 'bg-emerald-500/10 border border-emerald-500/20',
    };
  }
  if (txn.type === 'transfer') {
    return {
      Icon: ArrowLeftRight,
      iconClass: 'text-muted-foreground',
      containerClass: 'bg-muted border border-border',
    };
  }

  const cat = categories.find(c => c.id === txn.categoryId);
  const text = `${cat?.name || ''} ${txn.notes || ''}`.toLowerCase();

  let Icon = ArrowUpRight;
  if (/food|lunch|dinner|meal|snack|restaurant|dining|grocer/i.test(text)) {
    Icon = Utensils;
  } else if (/coffee|tea|cafe/i.test(text)) {
    Icon = Coffee;
  } else if (/bus|train|transit/i.test(text)) {
    Icon = Bus;
  } else if (/transport|fuel|petrol|uber|pickme|taxi|ride|car/i.test(text)) {
    Icon = Car;
  } else if (/shop|cloth|store|retail|market|buy/i.test(text)) {
    Icon = ShoppingBag;
  } else if (/bill|utilit|electric|water|internet|wifi|phone|rent|recharge/i.test(text)) {
    Icon = Receipt;
  } else if (/movie|cinema|game|entertain|netflix|spotify|stream/i.test(text)) {
    Icon = Film;
  } else if (/health|medic|doctor|pharmacy|fitness|gym/i.test(text)) {
    Icon = HeartPulse;
  } else if (/educat|course|class|book|tuition/i.test(text)) {
    Icon = GraduationCap;
  }

  return {
    Icon,
    iconClass: 'text-muted-foreground',
    containerClass: 'bg-muted border border-border',
  };
}

function formatTransactionDate(timestamp: number): string {
  const d = new Date(timestamp);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    showSafeToSpendHome,
    isMasked,
    toggleMask,
    glanceBudget,
    glanceTransactions,
    glanceUpcoming,
  } = usePrivacyStore();

  const [showSafeBreakdownModal, setShowSafeBreakdownModal] = useState(false);

  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const budgets = useLiveQuery(() => db.budgets.toArray()) || [];
  const activeBudget = budgets.find(b => b.status === 'active');
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];

  // Data for safe-to-spend calculation
  const mmas = useLiveQuery(() => db.moneyMarketAccounts.toArray()) || [];
  const cards = useLiveQuery(() => db.creditCards.toArray()) || [];
  const offsets = useLiveQuery(() => db.cashOffsetSources.toArray()) || [];
  const recurring = useLiveQuery(() => db.recurringTransactions.toArray()) || [];
  const ledgers = useLiveQuery(() => db.reimbursementLedgers.toArray()) || [];
  const entries = useLiveQuery(() => db.reimbursementEntries.toArray()) || [];

  // ── Balances ────────────────────────────────────────────────────────────────
  const totalBalance = accounts
    .filter(a => a.includeInTotal)
    .reduce((sum, a) => sum + a.balance, 0);

  const activeAccountsCount = accounts.filter(a => a.includeInTotal).length;

  const transactionBaseline = useMemo(() => {
    return getTransactionBaseline(transactions);
  }, [transactions]);

  // ── Safe-to-Spend Computation ───────────────────────────────────────────────
  const safeToSpendBreakdown = useMemo(() => {
    return computeSafeToSpendSync({
      accounts,
      mmas,
      cards,
      offsets,
      recurring,
      ledgers,
      entries,
      forecastDays: 14,
    });
  }, [accounts, mmas, cards, offsets, recurring, ledgers, entries]);

  // ── Budget pace with centralized getBudgetStatus ────────────────────────────
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
    budgetStatus = getBudgetStatus(spentThisPeriod, activeBudget.amount, {
      startDate: activeBudget.startDate,
      endDate: activeBudget.endDate,
    });
  }

  // ── Recent transactions (Max 3) ─────────────────────────────────────────────
  const recentTransactions = useMemo(() => {
    return [...transactions]
      .sort((a, b) => b.date - a.date)
      .slice(0, 3);
  }, [transactions]);

  const budgetGlance = getBudgetGlanceColors(budgetStatus.actualPercent, glanceBudget);

  // Contextual budget label: prefer 'This Month' or 'Budget' over arbitrary test names
  const budgetContextLabel = useMemo(() => {
    if (!activeBudget) return 'Budget';
    const spanDays = differenceInDays(activeBudget.endDate, activeBudget.startDate);
    if (spanDays >= 27 && spanDays <= 32) return 'This Month';
    if (spanDays <= 7) return 'This Week';
    return 'Budget';
  }, [activeBudget]);

  const now = Date.now();
  const next24h = now + 24 * 60 * 60 * 1000;
  const recurringRules = recurring || [];
  const upcomingPayments = recurringRules
    .filter(r => r.active && r.nextDueDate >= now && r.nextDueDate <= next24h)
    .sort((a, b) => a.nextDueDate - b.nextDueDate)
    .slice(0, 3);

  return (
    <div className="w-full max-w-md md:max-w-xl lg:max-w-2xl mx-auto px-5 pt-7 sm:pt-8 md:pt-10 pb-36">
      {/* ── SECTION 1: Available Context (Page Level) ───────────────────────── */}
      <section className="mb-7 sm:mb-8 mt-1">
        {/* Available row with quiet utility actions [shield] [eye] */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Available</span>

          <div className="flex items-center gap-1 -mr-2">
            {/* Safe-to-Spend Status Shield Icon */}
            {showSafeToSpendHome && (
              <button
                type="button"
                onClick={() => setShowSafeBreakdownModal(true)}
                className={`p-1.5 flex items-center justify-center rounded-lg transition-colors hover:bg-muted ${
                  safeToSpendBreakdown.isNegative
                    ? 'text-amber-500'
                    : 'text-emerald-500'
                }`}
                title={`Safe to spend: LKR ${safeToSpendBreakdown.safeToSpend.toLocaleString()}`}
              >
                <ShieldCheck size={20} />
              </button>
            )}

            {/* Privacy Eye Toggle Icon (Quiet, unboxed) */}
            <button
              type="button"
              onClick={toggleMask}
              className="p-1.5 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              title={isMasked ? 'Reveal figures' : 'Mask figures'}
            >
              {isMasked ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>

        {/* Hero Balance: printed on page */}
        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-sm font-medium text-muted-foreground select-none">LKR</span>
          <span className="text-[40px] font-light tracking-tight text-foreground tabular-nums leading-none">
            <MaskedAmount amount={totalBalance} />
          </span>
        </div>

        {/* 4 accounts › */}
        <button
          type="button"
          onClick={() => navigate('/accounts')}
          className="mt-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer group"
        >
          <span>
            {activeAccountsCount} {activeAccountsCount === 1 ? 'account' : 'accounts'}
          </span>
          <span className="text-muted-foreground group-hover:text-foreground transition-colors">›</span>
        </button>
      </section>

      {/* ── CARD 2: Monthly Budget (The Single Hero Card) ────────────────────── */}
      <section>
        <button
          type="button"
          onClick={() => navigate('/budget')}
          className="w-full text-left active:scale-[0.99] transition-transform block focus:outline-none"
        >
          {activeBudget ? (
            <div className="bg-card border border-border rounded-xl px-5 py-4 shadow-none">
              {/* Context Label (THIS MONTH or BUDGET) */}
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {budgetContextLabel}
              </p>

              {/* Glance Remaining Amount & Total: larger for emphasis */}
              <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[34px] font-normal text-foreground tracking-tight tabular-nums leading-none">
                    LKR <MaskedAmount amount={budgetStatus.remaining} />
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {budgetStatus.isOverspent ? 'over budget' : 'left'}
                  </span>
                </div>
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  of LKR <MaskedAmount amount={activeBudget.amount} />
                </span>
              </div>

              {/* Intelligent Progress / Health Bar (substantial 8px height, generous breathing room) */}
              <div className="h-[8px] w-full bg-muted rounded-full overflow-hidden mt-6 mb-5">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${budgetGlance.barColor}`}
                  style={{ width: `${budgetStatus.percent}%` }}
                />
              </div>

              {/* Metrics Line: Spent on left, percentage, days left on right */}
              <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                <span>
                  LKR <MaskedAmount amount={spentThisPeriod} /> spent
                </span>

                <span className={`font-medium ${budgetGlance.textColor}`}>
                  {Math.round(budgetStatus.actualPercent)}% spent
                </span>

                <span>{daysLeft}d left</span>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-5 shadow-none flex items-center justify-between text-muted-foreground hover:text-foreground transition-colors">
              <span className="text-sm font-medium">No active budget · Tap to set up</span>
              <ChevronRight size={18} className="text-muted-foreground" />
            </div>
          )}
        </button>
      </section>

      {/* ── LIST: Recent Activity (What just happened? - Completely unboxed) ─ */}
      <section className="mt-7 sm:mt-8">
        {/* Header: RECENT on left, See all › on right */}
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Recent</h2>
          <button
            type="button"
            onClick={() => navigate('/activity')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
          >
            <span>See all</span>
            <span className="text-muted-foreground">›</span>
          </button>
        </div>

        {/* Clean unboxed rows with subtle dividers */}
        <div className="divide-y divide-border">
          {recentTransactions.map(txn => {
            const iconData = getTransactionIcon(txn, categories);
            const isIncome = txn.type === 'income';
            const isExpense = txn.type === 'expense';
            const dateLabel = formatTransactionDate(txn.date);

            return (
              <button
                key={txn.id}
                type="button"
                onClick={() => navigate('/activity', { state: { selectedTransactionId: txn.id } })}
                className="w-full py-3 sm:py-3.5 flex items-center justify-between text-left active:opacity-70 transition-opacity focus:outline-none"
              >
                <div className="flex items-center min-w-0 pr-4">
                  <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center mr-3 shrink-0 text-muted-foreground">
                    <iconData.Icon size={15} className={isIncome ? 'text-emerald-500' : 'text-muted-foreground'} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground text-sm leading-tight truncate">
                      {txn.notes || (isExpense ? 'Expense' : isIncome ? 'Income' : 'Transfer')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {dateLabel}
                      {txn.excludeFromBudget && (
                        <span className="ml-2 text-[10px] text-amber-500 font-medium">
                          Out of budget
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <span className={`font-medium text-sm tabular-nums whitespace-nowrap ${getTransactionGlanceColor(txn.amount, txn.type, transactionBaseline, glanceTransactions)}`}>
                  {isExpense ? '−' : isIncome ? '+' : ''}LKR <MaskedAmount amount={txn.amount} />
                </span>
              </button>
            );
          })}

          {recentTransactions.length === 0 && (
            <p className="text-muted-foreground text-xs py-4">No recent activity.</p>
          )}
        </div>
      </section>

      {/* 🚀 UPCOMING PAYMENTS (Only if within 24h) */}
      {upcomingPayments.length > 0 && (
        <section className="mt-7 sm:mt-8">
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Upcoming</h2>
            <button
              type="button"
              onClick={() => navigate('/recurring')}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
            >
              <span>See all</span>
              <span className="text-muted-foreground">›</span>
            </button>
          </div>

          <div className="divide-y divide-border">
            {upcomingPayments.map(r => {
              const iconData = getTransactionIcon({ type: r.type, categoryId: r.categoryId, notes: r.name } as Transaction, categories);
              const isIncome = r.type === 'income';
              const isExpense = r.type === 'expense';
              
              const isTodayObj = isSameDay(r.nextDueDate, now);
              const isTomorrowObj = isSameDay(r.nextDueDate, next24h);
              const dateLabel = isTodayObj ? 'Today' : isTomorrowObj ? 'Tomorrow' : format(r.nextDueDate, 'MMM d');

              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate('/recurring', { state: { selectedRecurringId: r.id } })}
                  className="w-full py-3 sm:py-3.5 flex items-center justify-between text-left active:opacity-70 transition-opacity focus:outline-none"
                >
                  <div className="flex items-center min-w-0 pr-4">
                    <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center mr-3 shrink-0 text-muted-foreground">
                      <iconData.Icon size={15} className={isIncome ? 'text-emerald-500' : 'text-muted-foreground'} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground text-sm leading-tight truncate">
                        {r.name || (isExpense ? 'Recurring Expense' : 'Recurring Income')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {dateLabel}
                      </p>
                    </div>
                  </div>
                  <span className={`font-medium text-sm tabular-nums whitespace-nowrap ${getTransactionGlanceColor(r.amount, r.type, transactionBaseline, glanceUpcoming)}`}>
                    {isExpense ? '−' : isIncome ? '+' : ''}LKR <MaskedAmount amount={r.amount} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 🛡️ Safe to Spend Breakdown Modal (Opens upon tapping Shield icon) 🛡️ */}
      {showSafeBreakdownModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-md bg-card border border-border rounded-2xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Safe to Spend Breakdown</h3>
              <button
                type="button"
                onClick={() => setShowSafeBreakdownModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <SafeToSpendCard />
          </div>
        </div>
      )}
    </div>
  );
}
