import { db } from '../db/db';
import type {
  Transaction,
  Category,
  InstallmentPlan,
} from '../db/db';
import {
  startOfMonth,
  endOfMonth,
  subMonths,
} from 'date-fns';

export interface CategoryTrend {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  currentAmount: number;
  prevAmount: number;
  delta: number;
  percentChange: number;
  isSpike: boolean;
  isImprovement: boolean;
  contextNote?: string; // Cross-referenced installment plan note
}

export interface CompletedInstallmentPlan {
  id: string;
  description: string;
  monthlyAmount: number;
  totalMonths: number;
  monthsPaid: number;
  isDone: boolean;
  isFinishingNextMonth: boolean;
}

export interface MonthlyDigestData {
  year: number;
  month: number; // 0-indexed (0 = Jan, 8 = Sep)
  monthLabel: string;

  // 1. Income & Spending
  totalIncome: number;
  grossSpending: number;
  floatAndInstallmentsSpent: number;
  realSpending: number; // grossSpending - floatAndInstallmentsSpent

  // 2. Savings Rate
  savingsRate: number; // percentage (0-100)
  netSaved: number;

  // 3. Category Trends & Spikes
  categoryTrends: CategoryTrend[];
  mostImprovedCategory: CategoryTrend | null;
  topSpikeCategory: CategoryTrend | null;

  // 4. Installment Completions & Opportunities
  completedPlans: CompletedInstallmentPlan[];
  upcomingCompletions: CompletedInstallmentPlan[];
}

/**
 * Generates monthly digest data for a specified month and year.
 */
export async function generateMonthlyDigest(
  year: number,
  month: number
): Promise<MonthlyDigestData> {
  const targetDate = new Date(year, month, 15);
  const monthStart = startOfMonth(targetDate).getTime();
  const monthEnd = endOfMonth(targetDate).getTime();

  const prevDate = subMonths(targetDate, 1);
  const prevMonthStart = startOfMonth(prevDate).getTime();
  const prevMonthEnd = endOfMonth(prevDate).getTime();

  const [
    allTransactions,
    categories,
    installmentPlans,
  ] = await Promise.all([
    db.transactions.toArray(),
    db.categories.toArray(),
    db.installmentPlans.toArray(),
  ]);

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
}

export function computeMonthlyDigestSync({
  targetDate,
  monthStart,
  monthEnd,
  prevMonthStart,
  prevMonthEnd,
  allTransactions,
  categories,
  installmentPlans,
}: {
  targetDate: Date;
  monthStart: number;
  monthEnd: number;
  prevMonthStart: number;
  prevMonthEnd: number;
  allTransactions: Transaction[];
  categories: Category[];
  installmentPlans: InstallmentPlan[];
}): MonthlyDigestData {
  const categoryMap = new Map<string, Category>(categories.map((c) => [c.id, c]));

  // Helper to test if a transaction is float-gap or installment related
  const isFloatOrInstallmentTxn = (t: Transaction): boolean => {
    const text = `${t.notes || ''}`.toLowerCase();
    if (
      text.includes('installment') ||
      text.includes('flexiplan') ||
      text.includes('float gap') ||
      text.includes('float-gap') ||
      text.includes('plan payoff')
    ) {
      return true;
    }
    for (const p of installmentPlans) {
      if (p.description && text.includes(p.description.toLowerCase())) {
        return true;
      }
    }
    return false;
  };

  // Filter current month transactions (exclude debt_settlement and transfer)
  const currentTxns = allTransactions.filter(
    (t) =>
      t.date >= monthStart &&
      t.date <= monthEnd &&
      t.type !== 'transfer' &&
      t.type !== 'debt_settlement'
  );

  // Filter prev month transactions
  const prevTxns = allTransactions.filter(
    (t) =>
      t.date >= prevMonthStart &&
      t.date <= prevMonthEnd &&
      t.type !== 'transfer' &&
      t.type !== 'debt_settlement'
  );

  // 1. Total Earned vs Spent
  let totalIncome = 0;
  let grossSpending = 0;
  let floatAndInstallmentsSpent = 0;

  for (const t of currentTxns) {
    if (t.type === 'income') {
      totalIncome += t.amount;
    } else if (t.type === 'expense') {
      const amount = t.isShared && t.personalAmount ? t.personalAmount : t.amount;
      grossSpending += amount;

      if (isFloatOrInstallmentTxn(t)) {
        floatAndInstallmentsSpent += amount;
      }
    }
  }

  const realSpending = Math.max(0, grossSpending - floatAndInstallmentsSpent);
  const netSaved = totalIncome - realSpending;
  const savingsRate =
    totalIncome > 0
      ? Math.max(-100, Math.min(100, Math.round((netSaved / totalIncome) * 100)))
      : 0;

  // 2. Category Spending Comparison (Current vs Prev)
  const currentByCat = new Map<string, number>();
  for (const t of currentTxns.filter((t) => t.type === 'expense')) {
    const cid = t.categoryId || 'uncategorized';
    const amt = t.isShared && t.personalAmount ? t.personalAmount : t.amount;
    currentByCat.set(cid, (currentByCat.get(cid) || 0) + amt);
  }

  const prevByCat = new Map<string, number>();
  for (const t of prevTxns.filter((t) => t.type === 'expense')) {
    const cid = t.categoryId || 'uncategorized';
    const amt = t.isShared && t.personalAmount ? t.personalAmount : t.amount;
    prevByCat.set(cid, (prevByCat.get(cid) || 0) + amt);
  }

  const allCatIds = Array.from(
    new Set([...currentByCat.keys(), ...prevByCat.keys()])
  );

  const categoryTrends: CategoryTrend[] = [];

  for (const cid of allCatIds) {
    const cur = currentByCat.get(cid) || 0;
    const prev = prevByCat.get(cid) || 0;
    const delta = cur - prev;
    const percentChange =
      prev > 0
        ? Math.round(((cur - prev) / prev) * 100)
        : cur > 0
        ? 100
        : 0;

    const cat = categoryMap.get(cid);
    const catName = cat?.name || (cid === 'uncategorized' ? 'Uncategorized' : 'Other');
    const catColor = cat?.color || '#94a3b8';

    // Cross-reference with Installment Plans
    let contextNote: string | undefined = undefined;
    for (const plan of installmentPlans) {
      const planDesc = plan.description.toLowerCase();
      const matchCat =
        planDesc.includes(catName.toLowerCase()) ||
        (catName.toLowerCase() === 'electronics' &&
          (planDesc.includes('macbook') ||
            planDesc.includes('iphone') ||
            planDesc.includes('laptop') ||
            planDesc.includes('ele')));

      if (matchCat) {
        if (!plan.active || plan.monthsPaid >= plan.totalMonths) {
          contextNote = `Reflects completion of ${plan.description} (LKR ${plan.monthlyAmount.toLocaleString()}/mo), not a behavioral change.`;
        } else if (plan.monthsPaid <= 1) {
          contextNote = `Reflects start of installment plan: ${plan.description} (LKR ${plan.monthlyAmount.toLocaleString()}/mo).`;
        }
      }
    }

    categoryTrends.push({
      categoryId: cid,
      categoryName: catName,
      categoryColor: catColor,
      currentAmount: cur,
      prevAmount: prev,
      delta,
      percentChange,
      isSpike: delta > 1000 && percentChange >= 25,
      isImprovement: delta < -1000 && percentChange <= -20,
      contextNote,
    });
  }

  // Find most improved (biggest decrease in spend)
  const mostImprovedCategory =
    [...categoryTrends]
      .filter((c) => c.delta < 0)
      .sort((a, b) => a.delta - b.delta)[0] || null;

  // Find top spike (biggest increase in spend)
  const topSpikeCategory =
    [...categoryTrends]
      .filter((c) => c.delta > 0)
      .sort((a, b) => b.delta - a.delta)[0] || null;

  // 3. Installment Plan completions
  const completedPlans: CompletedInstallmentPlan[] = installmentPlans
    .filter((p) => p.monthsPaid >= p.totalMonths || !p.active)
    .map((p) => ({
      id: p.id,
      description: p.description,
      monthlyAmount: p.monthlyAmount,
      totalMonths: p.totalMonths,
      monthsPaid: p.monthsPaid,
      isDone: true,
      isFinishingNextMonth: false,
    }));

  const upcomingCompletions: CompletedInstallmentPlan[] = installmentPlans
    .filter((p) => p.active && p.totalMonths - p.monthsPaid === 1)
    .map((p) => ({
      id: p.id,
      description: p.description,
      monthlyAmount: p.monthlyAmount,
      totalMonths: p.totalMonths,
      monthsPaid: p.monthsPaid,
      isDone: false,
      isFinishingNextMonth: true,
    }));

  const monthLabel = targetDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return {
    year: targetDate.getFullYear(),
    month: targetDate.getMonth(),
    monthLabel,
    totalIncome,
    grossSpending,
    floatAndInstallmentsSpent,
    realSpending,
    savingsRate,
    netSaved,
    categoryTrends,
    mostImprovedCategory,
    topSpikeCategory,
    completedPlans,
    upcomingCompletions,
  };
}
