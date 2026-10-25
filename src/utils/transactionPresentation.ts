import type { Transaction, TransactionType } from '../db/db';

export function isBalanceHistoryType(type: TransactionType | string): boolean {
  return type === 'opening_balance' || type === 'balance_adjustment';
}

export function transactionTypeLabel(type: TransactionType | string): string {
  switch (type) {
    case 'expense':
      return 'Expense';
    case 'income':
      return 'Income';
    case 'transfer':
      return 'Transfer';
    case 'debt_settlement':
      return 'Debt Settlement';
    case 'opening_balance':
      return 'Opening Balance';
    case 'balance_adjustment':
      return 'Balance Adjustment';
    default:
      return 'Transaction';
  }
}

/** Default Activity / list title when notes are empty. */
export function transactionFallbackTitle(
  txn: Pick<Transaction, 'type' | 'notes' | 'categoryId'>,
  categoryName?: string | null,
): string {
  if (txn.notes?.trim()) return txn.notes.trim();
  if (isBalanceHistoryType(txn.type)) return transactionTypeLabel(txn.type);
  if (txn.type === 'debt_settlement') return 'Debt Settlement';
  if (txn.type === 'transfer') return 'Transfer';
  if (categoryName) return categoryName;
  return 'Transaction';
}

/**
 * Display prefix for list amounts.
 * Signed balance types follow the amount's sign; expense/income use type.
 */
export function transactionAmountPrefix(
  txn: Pick<Transaction, 'type' | 'amount' | 'debtDirection'>,
): '+' | '−' | '' {
  if (isBalanceHistoryType(txn.type)) {
    if (txn.amount > 0) return '+';
    if (txn.amount < 0) return '−';
    return '';
  }
  if (txn.type === 'expense' || (txn.type === 'debt_settlement' && txn.debtDirection === 'iOweThem')) {
    return '−';
  }
  if (txn.type === 'income' || (txn.type === 'debt_settlement' && txn.debtDirection === 'theyOweMe')) {
    return '+';
  }
  return '';
}

export function transactionAmountClassName(
  txn: Pick<Transaction, 'type' | 'amount' | 'debtDirection'>,
): string {
  if (isBalanceHistoryType(txn.type)) {
    return txn.amount >= 0 ? 'text-emerald-500' : 'text-foreground';
  }
  if (txn.type === 'expense' || (txn.type === 'debt_settlement' && txn.debtDirection === 'iOweThem')) {
    return 'text-foreground';
  }
  if (txn.type === 'income' || (txn.type === 'debt_settlement' && txn.debtDirection === 'theyOweMe')) {
    return 'text-emerald-500';
  }
  return 'text-muted-foreground';
}

/** Absolute value for MaskedAmount when prefix already carries the sign. */
export function transactionDisplayAmount(
  txn: Pick<Transaction, 'type' | 'amount'>,
): number {
  if (isBalanceHistoryType(txn.type)) return Math.abs(txn.amount);
  return txn.amount;
}
