import Dexie from 'dexie';
import type { EntityTable } from 'dexie';

export type AccountType = 'cash' | 'bank' | 'card' | 'savings' | 'wallet' | 'other';
export type TransactionType = 'expense' | 'income' | 'transfer';
export type PeriodType = 'days' | 'weeks' | 'months';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  currency: string;
  includeInTotal: boolean;
  updatedAt?: number;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  updatedAt?: number;
}

export interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  icon: string;
  color: string;
  updatedAt?: number;
}

export interface SplitDetail {
  personId: string;
  amount: number;
  settled: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  date: number; // Unix timestamp
  accountId: string;
  categoryId?: string;
  notes?: string;
  tagIds?: string[];
  
  // For transfers
  toAccountId?: string;

  // For shared expenses
  isShared?: boolean;
  totalAmount?: number;
  personalAmount?: number;
  splitDetails?: SplitDetail[];
  isSettled?: boolean;

  // Out of budget expenses
  excludeFromBudget?: boolean;

  updatedAt?: number;
}

export interface Budget {
  id: string;
  name: string;
  amount: number;
  period: PeriodType;
  periodLength: number;
  startDate: number; // Unix timestamp
  endDate: number; // Unix timestamp
  status: 'active' | 'ended' | 'archived';
  updatedAt?: number;
}

export interface Person {
  id: string;
  name: string;
  updatedAt?: number;
}

export interface Debt {
  id: string;
  personId: string;
  amount: number; // Positive if they owe user, Negative if user owes them
  relatedTransactionId?: string;
  date: number;
  updatedAt?: number;
}

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  id: string;
  name: string;
  amount: number;
  categoryId?: string;
  accountId: string;
  frequency: RecurringFrequency;
  nextDueDate: number; // Unix timestamp
  type: 'expense' | 'income';
  active: boolean;
  updatedAt?: number;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: number; // Unix timestamp
  linkedAccountId?: string;
  color?: string;
  updatedAt?: number;
}

// ── Credit & Float Tools ─────────────────────────────────────────────────────
// All tables below are local-only (not synced to Supabase).
// Known gap: these tables have no cloud backup path yet. Treat extending backup
// coverage to include these tables as a near-term follow-up before relying on
// this module for day-to-day tracking.

export interface CreditCard {
  id: string;
  name: string;
  creditLimit: number;
  currentBalance: number;
  aprPercent: number;
  graceMinDays: number;
  graceMaxDays: number;
  dueDate: number; // Unix timestamp — next payment due date
  cycleStartDay: number; // Day of month (1–28)
  isSecuredAgainst?: string; // Fixed deposit id, if card is FD-secured
  /** When true, shortfall warnings fire if balance > 0 at due date.
   *  When false (carry intent), no shortfall warning — APR cost shown instead. */
  payInFullIntent: boolean;
  updatedAt?: number;
}

export interface CashOffsetSource {
  id: string;
  name: string; // e.g. "Family groceries", "Roommate rent share"
  linkedCardId: string;
  expectedMonthlyAmount: number;
  category?: string;
  updatedAt?: number;
}

export interface FixedDeposit {
  id: string;
  name: string; // e.g. "ComBank 12m FD"
  principal: number;
  ratePercent: number; // Annual rate
  maturityIntervalMonths: number;
  linkedCardId?: string; // Set if this FD secures a credit card
  updatedAt?: number;
}

export interface MoneyMarketAccount {
  id: string;
  name: string; // e.g. "NDB Smart Saver"
  balance: number;
  currentRatePercent: number; // Rate when balance >= minimumBalanceForRate
  minimumBalanceForRate: number;
  baseRatePercent: number; // Fallback rate when balance is below minimum
  updatedAt?: number;
}

export interface InstallmentPlan {
  id: string;
  linkedCardId: string;
  description: string;
  totalAmount: number;
  monthlyAmount: number;
  totalMonths: number;
  monthsPaid: number;
  active: boolean; // Auto-set to false when monthsPaid >= totalMonths
  updatedAt?: number;
}

export interface CardPromo {
  id: string;
  linkedCardId: string;
  description: string;
  spendThreshold: number;
  minTransactionCount: number;
  windowStart: number; // Unix timestamp
  windowEnd: number; // Unix timestamp
  cashbackPercent: number;
  cashbackCap: number;
  currentSpend: number; // Manually updated
  currentTransactionCount: number; // Manually updated
  updatedAt?: number;
}

export interface FloatGapHistory {
  id: string;
  cardId: string;
  cycleLabel: string; // Format: "YYYY-MM", e.g. "2026-09"
  totalBill: number; // Total card bill for this cycle
  cashReceived: number; // Offset cash received this cycle
  delta: number; // cashReceived - totalBill
  cumulativeGap: number; // Running sum of all deltas for this card
  updatedAt?: number;
}

export interface ReimbursementLedger {
  id: string;
  counterpartyName: string; // e.g. "Dad", "Roommate", "Business partner"
  updatedAt?: number;
}

export interface ReimbursementEntry {
  id: string;
  ledgerId: string;
  date: number; // Unix timestamp
  note: string;
  amountOwed: number; // Amount counterparty owed you this entry
  amountPaid: number; // Amount counterparty actually paid
  delta: number; // amountPaid - amountOwed (positive = counterparty overpaid / credit)
  updatedAt?: number;
}

const db = new Dexie('FinoraDB') as Dexie & {
  accounts: EntityTable<Account, 'id'>;
  categories: EntityTable<Category, 'id'>;
  transactions: EntityTable<Transaction, 'id'>;
  budgets: EntityTable<Budget, 'id'>;
  people: EntityTable<Person, 'id'>;
  debts: EntityTable<Debt, 'id'>;
  tags: EntityTable<Tag, 'id'>;
  recurringTransactions: EntityTable<RecurringTransaction, 'id'>;
  savingsGoals: EntityTable<SavingsGoal, 'id'>;
  // Credit & Float Tools (local-only)
  creditCards: EntityTable<CreditCard, 'id'>;
  cashOffsetSources: EntityTable<CashOffsetSource, 'id'>;
  fixedDeposits: EntityTable<FixedDeposit, 'id'>;
  moneyMarketAccounts: EntityTable<MoneyMarketAccount, 'id'>;
  installmentPlans: EntityTable<InstallmentPlan, 'id'>;
  cardPromos: EntityTable<CardPromo, 'id'>;
  floatGapHistory: EntityTable<FloatGapHistory, 'id'>;
  reimbursementLedgers: EntityTable<ReimbursementLedger, 'id'>;
  reimbursementEntries: EntityTable<ReimbursementEntry, 'id'>;
};


db.version(1).stores({
  accounts: 'id, type',
  categories: 'id, type',
  transactions: 'id, type, date, accountId, categoryId',
  budgets: 'id',
  people: 'id',
  debts: 'id, personId'
});

db.version(2).stores({
  tags: 'id, name'
}).upgrade(tx => {
  return tx.table('accounts').toCollection().modify(account => {
    account.includeInTotal = true;
  });
});

db.version(3).stores({}).upgrade(tx => {
  return tx.table('budgets').toCollection().modify(budget => {
    budget.status = 'active';
  });
});

// v4 — adds updatedAt index to all tables for sync engine
db.version(4).stores({
  accounts: 'id, type, updatedAt',
  categories: 'id, type, updatedAt',
  transactions: 'id, type, date, accountId, categoryId, updatedAt',
  budgets: 'id, updatedAt',
  people: 'id, updatedAt',
  debts: 'id, personId, updatedAt',
  tags: 'id, name, updatedAt',
});

// v5 — adds recurringTransactions and savingsGoals
db.version(5).stores({
  recurringTransactions: 'id, accountId, categoryId, nextDueDate, active, updatedAt',
  savingsGoals: 'id, linkedAccountId, updatedAt',
});

// v6 — Credit & Float Tools module (local-only, not synced to cloud)
// linkedCardId is indexed on applicable tables to support efficient cascade deletes.
db.version(6).stores({
  creditCards: 'id, updatedAt',
  cashOffsetSources: 'id, linkedCardId, updatedAt',
  fixedDeposits: 'id, linkedCardId, updatedAt',
  moneyMarketAccounts: 'id, updatedAt',
  installmentPlans: 'id, linkedCardId, active, updatedAt',
  cardPromos: 'id, linkedCardId, updatedAt',
  floatGapHistory: 'id, cardId, cycleLabel, updatedAt',
  reimbursementLedgers: 'id, updatedAt',
  reimbursementEntries: 'id, ledgerId, date, updatedAt',
});



export { db };
