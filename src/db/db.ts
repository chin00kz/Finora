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


const db = new Dexie('FinoraDB') as Dexie & {
  accounts: EntityTable<Account, 'id'>;
  categories: EntityTable<Category, 'id'>;
  transactions: EntityTable<Transaction, 'id'>;
  budgets: EntityTable<Budget, 'id'>;
  people: EntityTable<Person, 'id'>;
  debts: EntityTable<Debt, 'id'>;
  tags: EntityTable<Tag, 'id'>;
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

export { db };
