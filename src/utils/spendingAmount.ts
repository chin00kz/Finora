import type { Transaction } from '../db/db';

export type SpendTxn = Pick<
  Transaction,
  'type' | 'amount' | 'isShared' | 'personalAmount' | 'excludeFromBudget' | 'date'
>;

/**
 * Personal spend amount for budgeting / "my spending" reports.
 * - Non-expenses → 0 (transfers/income/settlements never count as expense spend)
 * - Shared expense → personalAmount when set (0 is valid zero)
 * - Otherwise → amount (full paid amount is not used for spend totals)
 */
export function expensePersonalSpendAmount(
  t: Pick<Transaction, 'type' | 'amount' | 'isShared' | 'personalAmount'>,
): number {
  if (t.type !== 'expense') return 0;
  if (t.isShared && t.personalAmount != null) return t.personalAmount;
  return t.amount;
}

/** Expense that counts toward an active/historical budget. */
export function isBudgetCountedExpense(
  t: Pick<Transaction, 'type' | 'excludeFromBudget'>,
): boolean {
  return t.type === 'expense' && !t.excludeFromBudget;
}

export type BudgetDateRange = { startDate: number; endDate: number };

/**
 * Period-budget eligibility: counted expense whose occurrence timestamp falls
 * inside [startDate, endDate] inclusive. No category matching — budgets are
 * date windows over personal spend.
 */
export function isTransactionInBudgetPeriod(
  t: Pick<SpendTxn, 'type' | 'excludeFromBudget' | 'date'>,
  range: BudgetDateRange,
): boolean {
  if (!isBudgetCountedExpense(t)) return false;
  return t.date >= range.startDate && t.date <= range.endDate;
}

/**
 * Budget activity list — same eligibility as `sumBudgetSpending` for a range.
 * Newest first. Does not mutate transactions.
 */
export function listBudgetCountedExpenses<T extends SpendTxn>(
  txns: T[],
  range: BudgetDateRange,
): T[] {
  return txns
    .filter(t => isTransactionInBudgetPeriod(t, range))
    .sort((a, b) => b.date - a.date);
}

/**
 * Sum personal spend for budget surfaces (Dashboard, BudgetDetail, Analytics
 * when viewing a budget period). Excludes excludeFromBudget and non-expenses.
 * When `range` is set, uses the same inclusion rules as `listBudgetCountedExpenses`.
 */
export function sumBudgetSpending(
  txns: SpendTxn[],
  range?: BudgetDateRange,
): number {
  return txns.reduce((sum, t) => {
    if (range) {
      if (!isTransactionInBudgetPeriod(t, range)) return sum;
    } else if (!isBudgetCountedExpense(t)) {
      return sum;
    }
    return sum + expensePersonalSpendAmount(t);
  }, 0);
}

/**
 * Sum personal spend for general reports (calendar Analytics, Digest, Export
 * outside budget-comparison mode). Includes excludeFromBudget expenses.
 * Transfers and other non-expenses contribute 0.
 */
export function sumGeneralExpenseSpending(txns: SpendTxn[]): number {
  return txns.reduce((sum, t) => sum + expensePersonalSpendAmount(t), 0);
}

/**
 * CSV "Your Share" cell: personal share for shared expenses (including 0),
 * empty for non-shared rows so Amount remains the cash column.
 */
export function csvYourShareValue(
  t: Pick<Transaction, 'type' | 'amount' | 'isShared' | 'personalAmount'>,
): string {
  if (t.type === 'expense' && t.isShared && t.personalAmount != null) {
    return String(t.personalAmount);
  }
  return '';
}
