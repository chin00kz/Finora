import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Transaction, type Category } from '../db/db';
import { differenceInDays, isToday, isYesterday, format } from 'date-fns';
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
 * Emojis are eliminated. Most icons are neutral zinc, reserving emerald for income.
 */
function getTransactionIcon(txn: Transaction, categories: Category[]) {
  if (txn.type === 'income') {
    return {
      Icon: ArrowDownLeft,
      iconClass: 'text-emerald-400',
      containerClass: 'bg-emerald-500/10 border border-emerald-500/20',
    };
  }
  if (txn.type === 'transfer') {
    return {
      Icon: ArrowLeftRight,
      iconClass: 'text-zinc-400',
      containerClass: 'bg-zinc-800/80 border border-zinc-700/40',
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
    iconClass: 'text-zinc-300',
    containerClass: 'bg-zinc-800/70 border border-zinc-700/40',
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

  // Contextual budget label: prefer 'This Month' or 'Budget' over arbitrary test names
  const budgetContextLabel = useMemo(() => {
    if (!activeBudget) return 'Budget';
    const spanDays = differenceInDays(activeBudget.endDate, activeBudget.startDate);
    if (spanDays >= 27 && spanDays <= 32) return 'This Month';
    if (spanDays <= 7) return 'This Week';
    return 'Budget';
  }, [activeBudget]);

  return (
    <div className="w-full max-w-md md:max-w-xl lg:max-w-2xl mx-auto px-5 pt-7 sm:pt-8 md:pt-10 pb-36">
      {/* ── CARD 1: Available Money (What do I have?) ───────────────────────── */}
      <section className="bg-[#111113] border border-white/[0.04] rounded-xl p-5 shadow-none">
        {/* Available row with quiet utility actions [shield] [eye] */}
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-zinc-400">Available</span>

          <div className="flex items-center gap-1 -mr-1">
            {/* Safe-to-Spend Status Shield Icon */}
            {showSafeToSpendHome && (
              <button
                type="button"
                onClick={() => setShowSafeBreakdownModal(true)}
                className={`p-1.5 flex items-center justify-center rounded-lg transition-colors hover:bg-white/[0.04] ${
                  safeToSpendBreakdown.isNegative
                    ? 'text-amber-500'
                    : 'text-emerald-500'
                }`}
                title={`Safe to spend: LKR ${safeToSpendBreakdown.safeToSpend.toLocaleString()}`}
              >
                <ShieldCheck size={18} />
              </button>
            )}

            {/* Privacy Eye Toggle Icon (Quiet, unboxed) */}
            <button
              type="button"
              onClick={toggleMask}
              className="p-1.5 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors"
              title={isMasked ? 'Reveal figures' : 'Mask figures'}
            >
              {isMasked ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Hero Balance: dominant 48-52px, baseline aligned */}
        <div className="flex items-baseline gap-2.5 mt-4">
          <span className="text-[13px] sm:text-[14px] font-normal text-zinc-400 select-none">LKR</span>
          <span className="text-5xl sm:text-[52px] font-normal tracking-tight text-zinc-50 tabular-nums leading-none">
            <MaskedAmount amount={totalBalance} />
          </span>
        </div>

        {/* 4 accounts › */}
        <button
          type="button"
          onClick={() => navigate('/accounts')}
          className="mt-3 text-[13px] text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1 cursor-pointer group"
        >
          <span>
            {activeAccountsCount} {activeAccountsCount === 1 ? 'account' : 'accounts'}
          </span>
          <span className="text-zinc-500 group-hover:text-zinc-300 transition-colors">›</span>
        </button>
      </section>

      {/* ── CARD 2: Monthly Budget (How am I doing?) ───────────────────────── */}
      <section className="mt-3.5 sm:mt-4">
        <button
          type="button"
          onClick={() => navigate('/budget')}
          className="w-full text-left active:scale-[0.99] transition-transform block focus:outline-none"
        >
          {activeBudget ? (
            <div className="bg-[#111113] border border-white/[0.04] rounded-xl p-5 shadow-none">
              {/* Context Label (THIS MONTH or BUDGET) */}
              <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                {budgetContextLabel}
              </p>

              {/* Glance Remaining Amount & Total: around 30-34px */}
              <div className="flex items-baseline justify-between mb-3.5 flex-wrap gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[30px] sm:text-[32px] font-normal text-zinc-50 tracking-tight tabular-nums leading-none">
                    LKR <MaskedAmount amount={budgetStatus.remaining} />
                  </span>
                  <span className="text-sm font-normal text-zinc-400">
                    {budgetStatus.isOverspent ? 'over budget' : 'left'}
                  </span>
                </div>
                <span className="text-[13px] text-zinc-400 tabular-nums">
                  of LKR <MaskedAmount amount={activeBudget.amount} />
                </span>
              </div>

              {/* Intelligent Progress / Health Bar (clean solid bar, smooth rounded ends, strongest colored element) */}
              <div className="h-[5px] w-full bg-zinc-800/80 rounded-full overflow-hidden mb-2.5">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${budgetStatus.barColor}`}
                  style={{ width: `${budgetStatus.percent}%` }}
                />
              </div>

              {/* Metrics Line: Spent on left, days left on right, pace warning if needed */}
              <div className="flex items-center justify-between text-xs text-zinc-400 tabular-nums">
                <span>
                  LKR <MaskedAmount amount={spentThisPeriod} /> spent
                </span>

                {budgetStatus.paceWarning && (
                  <span className={`font-medium ${budgetStatus.textColor}`}>
                    {budgetStatus.paceWarning}
                  </span>
                )}

                <span>{daysLeft}d left</span>
              </div>
            </div>
          ) : (
            <div className="bg-[#111113] border border-white/[0.04] rounded-xl p-5 shadow-none flex items-center justify-between text-zinc-400 hover:text-zinc-200 transition-colors">
              <span className="text-sm font-medium">No active budget · Tap to set up</span>
              <ChevronRight size={18} className="text-zinc-500" />
            </div>
          )}
        </button>
      </section>

      {/* ── LIST: Recent Activity (What just happened? - Completely unboxed) ─ */}
      <section className="mt-7 sm:mt-8">
        {/* Header: RECENT on left, See all › on right */}
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Recent</h2>
          <button
            type="button"
            onClick={() => navigate('/activity')}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-0.5"
          >
            <span>See all</span>
            <span className="text-zinc-500">›</span>
          </button>
        </div>

        {/* Clean unboxed rows with subtle dividers */}
        <div className="divide-y divide-zinc-800/40">
          {recentTransactions.map(txn => {
            const iconData = getTransactionIcon(txn, categories);
            const isIncome = txn.type === 'income';
            const isExpense = txn.type === 'expense';
            const dateLabel = formatTransactionDate(txn.date);

            return (
              <div key={txn.id} className="py-3 sm:py-3.5 flex items-center justify-between">
                <div className="flex items-center min-w-0 pr-4">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800/50 border border-zinc-800/30 flex items-center justify-center mr-3 shrink-0 text-zinc-400">
                    <iconData.Icon size={15} className={isIncome ? 'text-emerald-400' : 'text-zinc-400'} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-100 text-sm leading-tight truncate">
                      {txn.notes || (isExpense ? 'Expense' : isIncome ? 'Income' : 'Transfer')}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {dateLabel}
                      {txn.excludeFromBudget && (
                        <span className="ml-2 text-[10px] text-amber-400/90 font-medium">
                          Out of budget
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <span className={`font-medium text-sm tabular-nums whitespace-nowrap ${isIncome ? 'text-emerald-400' : 'text-zinc-50'}`}>
                  {isExpense ? '−' : isIncome ? '+' : ''}LKR <MaskedAmount amount={txn.amount} />
                </span>
              </div>
            );
          })}

          {recentTransactions.length === 0 && (
            <p className="text-zinc-500 text-xs py-4">No recent activity.</p>
          )}
        </div>
      </section>

      {/* ── Safe to Spend Breakdown Modal (Opens upon tapping Shield icon) ── */}
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
