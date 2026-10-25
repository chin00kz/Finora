/**
 * Blocks personal-finance Dexie mutations while restoreIsolation.phase === 'reconciling'.
 * Choice B / kit / quarantine paths use beginPersonalFinanceSystemWrite() to bypass.
 */
import { getPersonalFinanceEditBlockError } from './restoreIsolation';

/** Dexie store names that hold local-first personal finance data. */
export const GUARDED_PERSONAL_DEXIE_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'budgets',
  'tags',
  'people',
  'debts',
  'recurringTransactions',
  'savingsGoals',
  'creditCards',
  'cashOffsetSources',
  'fixedDeposits',
  'moneyMarketAccounts',
  'installmentPlans',
  'cardPromos',
  'floatGapHistory',
  'reimbursementLedgers',
  'reimbursementEntries',
] as const;

const GUARDED_SET = new Set<string>(GUARDED_PERSONAL_DEXIE_TABLES);

let systemWriteDepth = 0;

export function isPersonalFinanceSystemWriteActive(): boolean {
  return systemWriteDepth > 0;
}

export function beginPersonalFinanceSystemWrite(): void {
  systemWriteDepth += 1;
}

export function endPersonalFinanceSystemWrite(): void {
  systemWriteDepth = Math.max(0, systemWriteDepth - 1);
}

export async function withPersonalFinanceSystemWrite<T>(fn: () => Promise<T>): Promise<T> {
  beginPersonalFinanceSystemWrite();
  try {
    return await fn();
  } finally {
    endPersonalFinanceSystemWrite();
  }
}

export function isGuardedPersonalDexieTable(tableName: string): boolean {
  return GUARDED_SET.has(tableName);
}

/**
 * Throws when a user-facing personal-finance mutation is attempted during
 * reconciliation (unless a system write is active).
 */
export function assertPersonalFinanceUserMutationAllowed(): void {
  if (systemWriteDepth > 0) return;
  const blocked = getPersonalFinanceEditBlockError();
  if (blocked) throw new Error(blocked.message);
}

/** Used by Dexie middleware — returns error message or null. */
export function personalFinanceMutationBlockReason(tableName: string): string | null {
  if (!isGuardedPersonalDexieTable(tableName)) return null;
  if (systemWriteDepth > 0) return null;
  return getPersonalFinanceEditBlockError()?.message ?? null;
}
