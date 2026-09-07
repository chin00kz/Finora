import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { computeMonthlyDigestSync } from '../utils/monthlyDigestEngine';
import MaskedAmount from './MaskedAmount';
import { useNavigate } from 'react-router-dom';
import {
  X,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Sparkles,
  CheckCircle2,
  Clock,
  ArrowRight,
  Percent,
} from 'lucide-react';
import { subMonths, addMonths, startOfMonth, endOfMonth } from 'date-fns';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: Date;
}

export default function MonthlyDigestModal({
  isOpen,
  onClose,
  initialDate = new Date(),
}: Props) {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState<Date>(initialDate);

  // Live queries
  const allTransactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const installmentPlans = useLiveQuery(() => db.installmentPlans.toArray()) || [];

  const digest = useMemo(() => {
    const targetDate = currentDate;
    const monthStart = startOfMonth(targetDate).getTime();
    const monthEnd = endOfMonth(targetDate).getTime();

    const prevDate = subMonths(targetDate, 1);
    const prevMonthStart = startOfMonth(prevDate).getTime();
    const prevMonthEnd = endOfMonth(prevDate).getTime();

    return computeMonthlyDigestSync({
      targetDate,
      monthStart,
      monthEnd,
      prevMonthStart,
      prevMonthEnd,
      allTransactions,
      categories,
      installmentPlans,
    });
  }, [currentDate, allTransactions, categories, installmentPlans]);

  if (!isOpen) return null;

  const handlePrevMonth = () => setCurrentDate((d) => subMonths(d, 1));
  const handleNextMonth = () => setCurrentDate((d) => addMonths(d, 1));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full duration-300">
        {/* Header with Month Switcher */}
        <div className="p-5 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider font-semibold">
              <Sparkles size={14} className="text-accent" />
              <span>Monthly Financial Digest</span>
            </div>
            {/* Month navigator */}
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={handlePrevMonth}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Previous month"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-xl font-semibold text-foreground tracking-tight">
                {digest.monthLabel}
              </h2>
              <button
                onClick={handleNextMonth}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Next month"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 bg-muted rounded-full text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
          >
            <X size={20} />
          </button>
        </div>

        {/* Digest Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 text-sm">
          {/* 1. High-Level Summary Card */}
          <div className="p-4 sm:p-5 bg-muted/40 border border-border rounded-2xl space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Total Earned
                </p>
                <p className="text-xl font-semibold text-emerald-500 mt-0.5">
                  LKR <MaskedAmount amount={digest.totalIncome} />
                </p>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Real Spending
                </p>
                <p className="text-xl font-semibold text-foreground mt-0.5">
                  LKR <MaskedAmount amount={digest.realSpending} />
                </p>
              </div>
            </div>

            {/* Float & Installments breakdown line */}
            {digest.floatAndInstallmentsSpent > 0 && (
              <div className="pt-2 border-t border-border text-[11px] text-muted-foreground flex items-center justify-between">
                <span>Float & Installment Payments (Excluded)</span>
                <span className="font-mono font-medium text-foreground">
                  LKR <MaskedAmount amount={digest.floatAndInstallmentsSpent} />
                </span>
              </div>
            )}

            {/* Savings Rate Bar */}
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Percent size={13} className="text-accent" />
                  Savings Rate
                </span>
                <span
                  className={`text-xs font-semibold ${
                    digest.savingsRate >= 20
                      ? 'text-emerald-500'
                      : digest.savingsRate > 0
                      ? 'text-blue-500'
                      : 'text-muted-foreground'
                  }`}
                >
                  {digest.savingsRate}% ({digest.netSaved >= 0 ? '+' : '−'}LKR{' '}
                  <MaskedAmount amount={Math.abs(digest.netSaved)} />)
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    digest.savingsRate >= 20
                      ? 'bg-emerald-500'
                      : digest.savingsRate > 0
                      ? 'bg-blue-500'
                      : 'bg-amber-500'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, digest.savingsRate))}%` }}
                />
              </div>
            </div>
          </div>

          {/* 2. Category Highlights: Improvements & Spikes */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Category Highlights
            </h3>

            <div className="grid grid-cols-1 gap-2.5">
              {/* Most improved category */}
              {digest.mostImprovedCategory && (
                <div className="p-3.5 bg-card border border-border rounded-xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      <TrendingDown size={15} className="text-emerald-500" />
                      {digest.mostImprovedCategory.categoryName} (Reduced)
                    </span>
                    <span className="text-xs font-semibold text-emerald-500 font-mono">
                      {digest.mostImprovedCategory.percentChange}% (LKR{' '}
                      <MaskedAmount amount={Math.abs(digest.mostImprovedCategory.delta)} /> less)
                    </span>
                  </div>
                  {digest.mostImprovedCategory.contextNote && (
                    <p className="text-[11px] text-muted-foreground bg-muted/50 p-2 rounded-lg mt-1">
                      💡 {digest.mostImprovedCategory.contextNote}
                    </p>
                  )}
                </div>
              )}

              {/* Top spike category */}
              {digest.topSpikeCategory && digest.topSpikeCategory.isSpike && (
                <div className="p-3.5 bg-card border border-border rounded-xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      <TrendingUp size={15} className="text-amber-500" />
                      {digest.topSpikeCategory.categoryName} (Spike)
                    </span>
                    <span className="text-xs font-semibold text-amber-500 font-mono">
                      +{digest.topSpikeCategory.percentChange}% (+LKR{' '}
                      <MaskedAmount amount={digest.topSpikeCategory.delta} />)
                    </span>
                  </div>
                  {digest.topSpikeCategory.contextNote ? (
                    <p className="text-[11px] text-muted-foreground bg-muted/50 p-2 rounded-lg mt-1">
                      💡 {digest.topSpikeCategory.contextNote}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Spending was notably higher than the previous month.
                    </p>
                  )}
                </div>
              )}

              {!digest.mostImprovedCategory && !digest.topSpikeCategory && (
                <p className="text-xs text-muted-foreground py-2 text-center bg-card border border-border rounded-xl">
                  No category shifts detected for this period.
                </p>
              )}
            </div>
          </div>

          {/* 3. Installment Completions & Opportunities */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Installment Plans Status
            </h3>

            {digest.completedPlans.length > 0 && (
              <div className="space-y-2">
                {digest.completedPlans.map((plan) => (
                  <div
                    key={plan.id}
                    className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                      <div>
                        <p className="font-medium text-foreground text-xs">
                          {plan.description} completed
                        </p>
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          LKR <MaskedAmount amount={plan.monthlyAmount} />/mo freed up
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        onClose();
                        navigate('/float-tools');
                      }}
                      className="text-xs font-semibold text-accent hover:underline flex items-center gap-1 shrink-0 ml-2"
                    >
                      <span>Simulate Payoff</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {digest.upcomingCompletions.length > 0 && (
              <div className="space-y-2">
                {digest.upcomingCompletions.map((plan) => (
                  <div
                    key={plan.id}
                    className="p-3 bg-muted/40 border border-border rounded-xl flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Clock size={15} className="text-accent shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">
                          {plan.description} finishing next month
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          LKR <MaskedAmount amount={plan.monthlyAmount} />/month will be freed up
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {digest.completedPlans.length === 0 && digest.upcomingCompletions.length === 0 && (
              <p className="text-xs text-muted-foreground py-2 text-center bg-card border border-border rounded-xl">
                No installment plan changes for this period.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2.5 bg-foreground text-background font-medium rounded-xl text-xs active:scale-95 transition-transform"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
