/**
 * syncEngine.ts
 *
 * Robust Two-Way Sync between Dexie (local IndexedDB) and Supabase (Postgres).
 *
 * Covers all 18 tables in Finora:
 *  - Core: accounts, categories, transactions, budgets, tags
 *  - Planning: recurring_transactions, savings_goals
 *  - IOUs: people, debts
 *  - Float & Credit: credit_cards, cash_offset_sources, fixed_deposits,
 *    money_market_accounts, installment_plans, card_promos,
 *    float_gap_history, reimbursement_ledgers, reimbursement_entries
 *
 * Write path: local first, always. Changes trigger debounced background sync.
 * Read path: local Dexie with useLiveQuery.
 * Sync path:
 *   1. Push local changes to Supabase (upsert with onConflict id).
 *   2. Pull remote records from Supabase into Dexie (merges based on updatedAt).
 *   3. Gracefully skips any table that has not yet been initialized in Supabase SQL.
 */

import { supabase } from '../lib/supabase';
import { db } from '../db/db';
import { useAuthStore } from '../store/authStore';
import type {
  Account,
  Transaction,
  Budget,
  Tag,
  Category,
  RecurringTransaction,
  SavingsGoal,
  Person,
  Debt,
  CreditCard,
  CashOffsetSource,
  FixedDeposit,
  MoneyMarketAccount,
  InstallmentPlan,
  CardPromo,
  FloatGapHistory,
  ReimbursementLedger,
  ReimbursementEntry,
} from '../db/db';

export type TableName =
  | 'accounts'
  | 'transactions'
  | 'budgets'
  | 'tags'
  | 'categories'
  | 'recurring_transactions'
  | 'savings_goals'
  | 'people'
  | 'debts'
  | 'credit_cards'
  | 'cash_offset_sources'
  | 'fixed_deposits'
  | 'money_market_accounts'
  | 'installment_plans'
  | 'card_promos'
  | 'float_gap_history'
  | 'reimbursement_ledgers'
  | 'reimbursement_entries';

export const ALL_TABLES: TableName[] = [
  'accounts',
  'categories',
  'tags',
  'budgets',
  'transactions',
  'recurring_transactions',
  'savings_goals',
  'people',
  'debts',
  'credit_cards',
  'cash_offset_sources',
  'fixed_deposits',
  'money_market_accounts',
  'installment_plans',
  'card_promos',
  'float_gap_history',
  'reimbursement_ledgers',
  'reimbursement_entries',
];

const PENDING_KEY = 'finora-pending-sync';

function getPending(): Set<TableName> {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return new Set(raw ? (JSON.parse(raw) as TableName[]) : []);
  } catch {
    return new Set();
  }
}

function markPending(table: TableName) {
  const s = getPending();
  s.add(table);
  localStorage.setItem(PENDING_KEY, JSON.stringify([...s]));
}

function clearPending(table: TableName) {
  const s = getPending();
  s.delete(table);
  localStorage.setItem(PENDING_KEY, JSON.stringify([...s]));
}

function isTableMissingError(errMsg?: string): boolean {
  if (!errMsg) return false;
  return (
    errMsg.includes('schema cache') ||
    errMsg.includes('does not exist') ||
    errMsg.includes('42P01') ||
    errMsg.includes('PGRST204')
  );
}

// ── camelCase ↔ snake_case mappers ──────────────────────────────────────────

// Accounts
function toSupabaseAccount(userId: string, a: Account) {
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    type: a.type,
    balance: a.balance,
    currency: a.currency,
    include_in_total: a.includeInTotal,
    updated_at: a.updatedAt || Date.now(),
  };
}

function fromSupabaseAccount(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    name: String(row.name),
    type: (row.type as Account['type']) || 'bank',
    balance: Number(row.balance) || 0,
    currency: String(row.currency || 'LKR'),
    includeInTotal: row.include_in_total !== false,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Transactions
function toSupabaseTransaction(userId: string, t: Transaction) {
  return {
    id: t.id,
    user_id: userId,
    type: t.type,
    amount: t.amount,
    date: t.date,
    account_id: t.accountId,
    category_id: t.categoryId || null,
    notes: t.notes || null,
    tag_ids: t.tagIds || null,
    to_account_id: t.toAccountId || null,
    is_shared: t.isShared || null,
    personal_amount: t.personalAmount != null ? t.personalAmount : null,
    is_settled: t.isSettled || null,
    exclude_from_budget: t.excludeFromBudget || null,
    debt_id: t.debtId || null,
    debt_direction: t.debtDirection || null,
    debt_settlement_id: t.debtSettlementId || null,
    updated_at: t.updatedAt || Date.now(),
  };
}

function fromSupabaseTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: String(row.id),
    type: (row.type as Transaction['type']) || 'expense',
    amount: Number(row.amount) || 0,
    date: Number(row.date) || Date.now(),
    accountId: String(row.account_id),
    categoryId: row.category_id ? String(row.category_id) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    tagIds: Array.isArray(row.tag_ids) ? (row.tag_ids as string[]) : undefined,
    toAccountId: row.to_account_id ? String(row.to_account_id) : undefined,
    isShared: Boolean(row.is_shared),
    personalAmount: row.personal_amount != null ? Number(row.personal_amount) : undefined,
    isSettled: Boolean(row.is_settled),
    excludeFromBudget: Boolean(row.exclude_from_budget),
    debtId: row.debt_id ? String(row.debt_id) : undefined,
    debtDirection: (row.debt_direction as Transaction['debtDirection']) || undefined,
    debtSettlementId: row.debt_settlement_id ? String(row.debt_settlement_id) : undefined,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Budgets
function toSupabaseBudget(userId: string, b: Budget) {
  return {
    id: b.id,
    user_id: userId,
    name: b.name,
    amount: b.amount,
    period: b.period,
    period_length: b.periodLength,
    start_date: b.startDate,
    end_date: b.endDate,
    status: b.status,
    updated_at: b.updatedAt || Date.now(),
  };
}

function fromSupabaseBudget(row: Record<string, unknown>): Budget {
  return {
    id: String(row.id),
    name: String(row.name),
    amount: Number(row.amount) || 0,
    period: (row.period as Budget['period']) || 'days',
    periodLength: Number(row.period_length) || 1,
    startDate: Number(row.start_date) || Date.now(),
    endDate: Number(row.end_date) || Date.now(),
    status: (row.status as Budget['status']) || 'active',
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Tags
function toSupabaseTag(userId: string, t: Tag) {
  return {
    id: t.id,
    user_id: userId,
    name: t.name,
    color: t.color || null,
    updated_at: t.updatedAt || Date.now(),
  };
}

function fromSupabaseTag(row: Record<string, unknown>): Tag {
  return {
    id: String(row.id),
    name: String(row.name),
    color: row.color ? String(row.color) : undefined,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Categories
function toSupabaseCategory(userId: string, c: Category) {
  return {
    id: c.id,
    user_id: userId,
    name: c.name,
    type: c.type,
    icon: c.icon,
    color: c.color,
    updated_at: c.updatedAt || Date.now(),
  };
}

function fromSupabaseCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    type: (row.type as Category['type']) || 'expense',
    icon: String(row.icon || 'tag'),
    color: String(row.color || '#3b82f6'),
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Recurring Transactions
function toSupabaseRecurring(userId: string, r: RecurringTransaction) {
  return {
    id: r.id,
    user_id: userId,
    name: r.name,
    amount: r.amount,
    account_id: r.accountId,
    category_id: r.categoryId || null,
    frequency: r.frequency,
    next_due_date: r.nextDueDate,
    type: r.type,
    active: r.active,
    updated_at: r.updatedAt || Date.now(),
  };
}

function fromSupabaseRecurring(row: Record<string, unknown>): RecurringTransaction {
  return {
    id: String(row.id),
    name: String(row.name),
    amount: Number(row.amount) || 0,
    accountId: String(row.account_id),
    categoryId: row.category_id ? String(row.category_id) : undefined,
    frequency: (row.frequency as RecurringTransaction['frequency']) || 'monthly',
    nextDueDate: Number(row.next_due_date) || Date.now(),
    type: (row.type as RecurringTransaction['type']) || 'expense',
    active: row.active !== false,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Savings Goals
function toSupabaseGoal(userId: string, g: SavingsGoal) {
  return {
    id: g.id,
    user_id: userId,
    name: g.name,
    target_amount: g.targetAmount,
    current_amount: g.currentAmount,
    target_date: g.targetDate || null,
    linked_account_id: g.linkedAccountId || null,
    color: g.color || null,
    updated_at: g.updatedAt || Date.now(),
  };
}

function fromSupabaseGoal(row: Record<string, unknown>): SavingsGoal {
  return {
    id: String(row.id),
    name: String(row.name),
    targetAmount: Number(row.target_amount) || 0,
    currentAmount: Number(row.current_amount) || 0,
    targetDate: row.target_date ? Number(row.target_date) : undefined,
    linkedAccountId: row.linked_account_id ? String(row.linked_account_id) : undefined,
    color: row.color ? String(row.color) : undefined,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// People
function toSupabasePerson(userId: string, p: Person) {
  return {
    id: p.id,
    user_id: userId,
    name: p.name,
    updated_at: p.updatedAt || Date.now(),
  };
}

function fromSupabasePerson(row: Record<string, unknown>): Person {
  return {
    id: String(row.id),
    name: String(row.name),
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Debts
function toSupabaseDebt(userId: string, d: Debt) {
  return {
    id: d.id,
    user_id: userId,
    person_id: d.personId || null,
    person_name: d.personName || 'Friend',
    amount: d.amount,
    source: d.source || 'manual',
    direction: d.direction || 'theyOweMe',
    note: d.note || null,
    settlements: d.settlements || [],
    related_transaction_id: d.relatedTransactionId || null,
    date: d.date,
    updated_at: d.updatedAt || Date.now(),
  };
}

function fromSupabaseDebt(row: Record<string, unknown>): Debt {
  let settlements: Debt['settlements'] = [];
  if (Array.isArray(row.settlements)) {
    settlements = row.settlements as Debt['settlements'];
  } else if (typeof row.settlements === 'string') {
    try {
      settlements = JSON.parse(row.settlements);
    } catch {
      settlements = [];
    }
  }

  return {
    id: String(row.id),
    personId: row.person_id ? String(row.person_id) : undefined,
    personName: String(row.person_name || 'Friend'),
    amount: Number(row.amount) || 0,
    source: (row.source as Debt['source']) || (row.related_transaction_id ? 'shared_expense' : 'manual'),
    direction: (row.direction as Debt['direction']) || 'theyOweMe',
    note: row.note ? String(row.note) : undefined,
    settlements,
    relatedTransactionId: row.related_transaction_id ? String(row.related_transaction_id) : undefined,
    date: Number(row.date) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Credit Cards
function toSupabaseCreditCard(userId: string, c: CreditCard) {
  return {
    id: c.id,
    user_id: userId,
    name: c.name,
    credit_limit: c.creditLimit,
    current_balance: c.currentBalance,
    apr_percent: c.aprPercent,
    grace_min_days: c.graceMinDays,
    grace_max_days: c.graceMaxDays,
    due_date: c.dueDate,
    cycle_start_day: c.cycleStartDay,
    is_secured_against: c.isSecuredAgainst || null,
    pay_in_full_intent: c.payInFullIntent,
    updated_at: c.updatedAt || Date.now(),
  };
}

function fromSupabaseCreditCard(row: Record<string, unknown>): CreditCard {
  return {
    id: String(row.id),
    name: String(row.name),
    creditLimit: Number(row.credit_limit) || 0,
    currentBalance: Number(row.current_balance) || 0,
    aprPercent: Number(row.apr_percent) || 0,
    graceMinDays: Number(row.grace_min_days) || 0,
    graceMaxDays: Number(row.grace_max_days) || 0,
    dueDate: Number(row.due_date) || Date.now(),
    cycleStartDay: Number(row.cycle_start_day) || 1,
    isSecuredAgainst: row.is_secured_against ? String(row.is_secured_against) : undefined,
    payInFullIntent: row.pay_in_full_intent !== false,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Cash Offset Sources
function toSupabaseCashOffsetSource(userId: string, s: CashOffsetSource) {
  return {
    id: s.id,
    user_id: userId,
    name: s.name,
    linked_card_id: s.linkedCardId,
    expected_monthly_amount: s.expectedMonthlyAmount,
    category: s.category || null,
    updated_at: s.updatedAt || Date.now(),
  };
}

function fromSupabaseCashOffsetSource(row: Record<string, unknown>): CashOffsetSource {
  return {
    id: String(row.id),
    name: String(row.name),
    linkedCardId: String(row.linked_card_id),
    expectedMonthlyAmount: Number(row.expected_monthly_amount) || 0,
    category: row.category ? String(row.category) : undefined,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Fixed Deposits
function toSupabaseFixedDeposit(userId: string, f: FixedDeposit) {
  return {
    id: f.id,
    user_id: userId,
    name: f.name,
    principal: f.principal,
    rate_percent: f.ratePercent,
    maturity_interval_months: f.maturityIntervalMonths,
    linked_card_id: f.linkedCardId || null,
    updated_at: f.updatedAt || Date.now(),
  };
}

function fromSupabaseFixedDeposit(row: Record<string, unknown>): FixedDeposit {
  return {
    id: String(row.id),
    name: String(row.name),
    principal: Number(row.principal) || 0,
    ratePercent: Number(row.rate_percent) || 0,
    maturityIntervalMonths: Number(row.maturity_interval_months) || 12,
    linkedCardId: row.linked_card_id ? String(row.linked_card_id) : undefined,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Money Market Accounts
function toSupabaseMMA(userId: string, m: MoneyMarketAccount) {
  return {
    id: m.id,
    user_id: userId,
    name: m.name,
    balance: m.balance,
    current_rate_percent: m.currentRatePercent,
    minimum_balance_for_rate: m.minimumBalanceForRate || 0,
    base_rate_percent: m.baseRatePercent || 0,
    updated_at: m.updatedAt || Date.now(),
  };
}

function fromSupabaseMMA(row: Record<string, unknown>): MoneyMarketAccount {
  return {
    id: String(row.id),
    name: String(row.name),
    balance: Number(row.balance) || 0,
    currentRatePercent: Number(row.current_rate_percent) || 0,
    minimumBalanceForRate: Number(row.minimum_balance_for_rate) || 0,
    baseRatePercent: Number(row.base_rate_percent) || 0,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Installment Plans
function toSupabaseInstallmentPlan(userId: string, p: InstallmentPlan) {
  return {
    id: p.id,
    user_id: userId,
    linked_card_id: p.linkedCardId,
    description: p.description,
    total_amount: p.totalAmount,
    monthly_amount: p.monthlyAmount,
    total_months: p.totalMonths,
    months_paid: p.monthsPaid,
    active: p.active,
    updated_at: p.updatedAt || Date.now(),
  };
}

function fromSupabaseInstallmentPlan(row: Record<string, unknown>): InstallmentPlan {
  return {
    id: String(row.id),
    linkedCardId: String(row.linked_card_id),
    description: String(row.description),
    totalAmount: Number(row.total_amount) || 0,
    monthlyAmount: Number(row.monthly_amount) || 0,
    totalMonths: Number(row.total_months) || 1,
    monthsPaid: Number(row.months_paid) || 0,
    active: row.active !== false,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Card Promos
function toSupabaseCardPromo(userId: string, cp: CardPromo) {
  return {
    id: cp.id,
    user_id: userId,
    linked_card_id: cp.linkedCardId,
    description: cp.description,
    spend_threshold: cp.spendThreshold,
    min_transaction_count: cp.minTransactionCount,
    window_start: cp.windowStart,
    window_end: cp.windowEnd,
    cashback_percent: cp.cashbackPercent,
    cashback_cap: cp.cashbackCap,
    current_spend: cp.currentSpend,
    current_transaction_count: cp.currentTransactionCount,
    updated_at: cp.updatedAt || Date.now(),
  };
}

function fromSupabaseCardPromo(row: Record<string, unknown>): CardPromo {
  return {
    id: String(row.id),
    linkedCardId: String(row.linked_card_id),
    description: String(row.description),
    spendThreshold: Number(row.spend_threshold) || 0,
    minTransactionCount: Number(row.min_transaction_count) || 0,
    windowStart: Number(row.window_start) || Date.now(),
    windowEnd: Number(row.window_end) || Date.now(),
    cashbackPercent: Number(row.cashback_percent) || 0,
    cashbackCap: Number(row.cashback_cap) || 0,
    currentSpend: Number(row.current_spend) || 0,
    currentTransactionCount: Number(row.current_transaction_count) || 0,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Float Gap History
function toSupabaseFloatGapHistory(userId: string, g: FloatGapHistory) {
  return {
    id: g.id,
    user_id: userId,
    card_id: g.cardId,
    cycle_label: g.cycleLabel,
    total_bill: g.totalBill,
    cash_received: g.cashReceived,
    delta: g.delta,
    cumulative_gap: g.cumulativeGap,
    updated_at: g.updatedAt || Date.now(),
  };
}

function fromSupabaseFloatGapHistory(row: Record<string, unknown>): FloatGapHistory {
  return {
    id: String(row.id),
    cardId: String(row.card_id),
    cycleLabel: String(row.cycle_label),
    totalBill: Number(row.total_bill) || 0,
    cashReceived: Number(row.cash_received) || 0,
    delta: Number(row.delta) || 0,
    cumulativeGap: Number(row.cumulative_gap) || 0,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Reimbursement Ledgers
function toSupabaseReimbursementLedger(userId: string, l: ReimbursementLedger) {
  return {
    id: l.id,
    user_id: userId,
    counterparty_name: l.counterpartyName,
    updated_at: l.updatedAt || Date.now(),
  };
}

function fromSupabaseReimbursementLedger(row: Record<string, unknown>): ReimbursementLedger {
  return {
    id: String(row.id),
    counterpartyName: String(row.counterparty_name),
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// Reimbursement Entries
function toSupabaseReimbursementEntry(userId: string, e: ReimbursementEntry) {
  return {
    id: e.id,
    user_id: userId,
    ledger_id: e.ledgerId,
    date: e.date,
    note: e.note || '',
    amount_owed: e.amountOwed,
    amount_paid: e.amountPaid,
    delta: e.delta,
    updated_at: e.updatedAt || Date.now(),
  };
}

function fromSupabaseReimbursementEntry(row: Record<string, unknown>): ReimbursementEntry {
  return {
    id: String(row.id),
    ledgerId: String(row.ledger_id),
    date: Number(row.date) || Date.now(),
    note: String(row.note || ''),
    amountOwed: Number(row.amount_owed) || 0,
    amountPaid: Number(row.amount_paid) || 0,
    delta: Number(row.delta) || 0,
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

// ── Push (Local → Supabase) ──────────────────────────────────────────────────

export async function pushTable(table: TableName, userId: string): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  try {
    let rows: Record<string, unknown>[] = [];

    switch (table) {
      case 'accounts':
        rows = (await db.accounts.toArray()).map(a => toSupabaseAccount(userId, a));
        break;
      case 'transactions':
        rows = (await db.transactions.toArray()).map(t => toSupabaseTransaction(userId, t));
        break;
      case 'budgets':
        rows = (await db.budgets.toArray()).map(b => toSupabaseBudget(userId, b));
        break;
      case 'tags':
        rows = (await db.tags.toArray()).map(t => toSupabaseTag(userId, t));
        break;
      case 'categories':
        rows = (await db.categories.toArray()).map(c => toSupabaseCategory(userId, c));
        break;
      case 'recurring_transactions':
        rows = (await db.recurringTransactions.toArray()).map(r => toSupabaseRecurring(userId, r));
        break;
      case 'savings_goals':
        rows = (await db.savingsGoals.toArray()).map(g => toSupabaseGoal(userId, g));
        break;
      case 'people':
        rows = (await db.people.toArray()).map(p => toSupabasePerson(userId, p));
        break;
      case 'debts':
        rows = (await db.debts.toArray()).map(d => toSupabaseDebt(userId, d));
        break;
      case 'credit_cards':
        rows = (await db.creditCards.toArray()).map(c => toSupabaseCreditCard(userId, c));
        break;
      case 'cash_offset_sources':
        rows = (await db.cashOffsetSources.toArray()).map(s => toSupabaseCashOffsetSource(userId, s));
        break;
      case 'fixed_deposits':
        rows = (await db.fixedDeposits.toArray()).map(f => toSupabaseFixedDeposit(userId, f));
        break;
      case 'money_market_accounts':
        rows = (await db.moneyMarketAccounts.toArray()).map(m => toSupabaseMMA(userId, m));
        break;
      case 'installment_plans':
        rows = (await db.installmentPlans.toArray()).map(p => toSupabaseInstallmentPlan(userId, p));
        break;
      case 'card_promos':
        rows = (await db.cardPromos.toArray()).map(cp => toSupabaseCardPromo(userId, cp));
        break;
      case 'float_gap_history':
        rows = (await db.floatGapHistory.toArray()).map(g => toSupabaseFloatGapHistory(userId, g));
        break;
      case 'reimbursement_ledgers':
        rows = (await db.reimbursementLedgers.toArray()).map(l => toSupabaseReimbursementLedger(userId, l));
        break;
      case 'reimbursement_entries':
        rows = (await db.reimbursementEntries.toArray()).map(e => toSupabaseReimbursementEntry(userId, e));
        break;
    }

    if (rows.length === 0) {
      clearPending(table);
      return { success: true };
    }

    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });

    if (error) {
      if (isTableMissingError(error.message)) {
        clearPending(table);
        return { success: true, skipped: true };
      }
      console.warn(`[sync] Push failed for ${table}:`, error.message);
      markPending(table);
      return { success: false, error: `${table}: ${error.message}` };
    }

    clearPending(table);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTableMissingError(msg)) {
      clearPending(table);
      return { success: true, skipped: true };
    }
    console.warn(`[sync] Push exception for ${table}:`, msg);
    markPending(table);
    return { success: false, error: `${table}: ${msg}` };
  }
}

// ── Pull (Supabase → Local) ──────────────────────────────────────────────────

export async function pullTable(table: TableName, userId: string): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  try {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId);
    if (error) {
      if (isTableMissingError(error.message)) {
        return { success: true, skipped: true };
      }
      console.warn(`[sync] Pull failed for ${table}:`, error.message);
      return { success: false, error: `${table}: ${error.message}` };
    }
    if (!data || data.length === 0) return { success: true };

    switch (table) {
      case 'accounts':
        await db.accounts.bulkPut(data.map(r => fromSupabaseAccount(r)));
        break;
      case 'transactions':
        await db.transactions.bulkPut(data.map(r => fromSupabaseTransaction(r)));
        break;
      case 'budgets':
        await db.budgets.bulkPut(data.map(r => fromSupabaseBudget(r)));
        break;
      case 'tags':
        await db.tags.bulkPut(data.map(r => fromSupabaseTag(r)));
        break;
      case 'categories':
        await db.categories.bulkPut(data.map(r => fromSupabaseCategory(r)));
        break;
      case 'recurring_transactions':
        await db.recurringTransactions.bulkPut(data.map(r => fromSupabaseRecurring(r)));
        break;
      case 'savings_goals':
        await db.savingsGoals.bulkPut(data.map(r => fromSupabaseGoal(r)));
        break;
      case 'people':
        await db.people.bulkPut(data.map(r => fromSupabasePerson(r)));
        break;
      case 'debts':
        await db.debts.bulkPut(data.map(r => fromSupabaseDebt(r)));
        break;
      case 'credit_cards':
        await db.creditCards.bulkPut(data.map(r => fromSupabaseCreditCard(r)));
        break;
      case 'cash_offset_sources':
        await db.cashOffsetSources.bulkPut(data.map(r => fromSupabaseCashOffsetSource(r)));
        break;
      case 'fixed_deposits':
        await db.fixedDeposits.bulkPut(data.map(r => fromSupabaseFixedDeposit(r)));
        break;
      case 'money_market_accounts':
        await db.moneyMarketAccounts.bulkPut(data.map(r => fromSupabaseMMA(r)));
        break;
      case 'installment_plans':
        await db.installmentPlans.bulkPut(data.map(r => fromSupabaseInstallmentPlan(r)));
        break;
      case 'card_promos':
        await db.cardPromos.bulkPut(data.map(r => fromSupabaseCardPromo(r)));
        break;
      case 'float_gap_history':
        await db.floatGapHistory.bulkPut(data.map(r => fromSupabaseFloatGapHistory(r)));
        break;
      case 'reimbursement_ledgers':
        await db.reimbursementLedgers.bulkPut(data.map(r => fromSupabaseReimbursementLedger(r)));
        break;
      case 'reimbursement_entries':
        await db.reimbursementEntries.bulkPut(data.map(r => fromSupabaseReimbursementEntry(r)));
        break;
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTableMissingError(msg)) {
      return { success: true, skipped: true };
    }
    console.warn(`[sync] Pull exception for ${table}:`, msg);
    return { success: false, error: `${table}: ${msg}` };
  }
}

// ── Delete from Supabase ────────────────────────────────────────────────────

export async function deleteFromCloud(table: TableName, id: string): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) return;
  try {
    await supabase.from(table).delete().eq('id', id).eq('user_id', user.id);
  } catch (err) {
    console.warn(`[sync] Delete failed for ${table}/${id}:`, err);
  }
}

// ── Purge All Cloud Data + Re-push Local ────────────────────────────────────

export async function purgeAndRepushCloud(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Delete ALL cloud rows for this user
    for (const table of ALL_TABLES) {
      const { error } = await supabase.from(table).delete().eq('user_id', userId);
      if (error && !isTableMissingError(error.message)) {
        console.warn(`[sync] Purge failed for ${table}:`, error.message);
        return { success: false, error: `Purge ${table}: ${error.message}` };
      }
    }

    // 2. Re-push local data as single source of truth
    for (const table of ALL_TABLES) {
      const res = await pushTable(table, userId);
      if (!res.success && !res.skipped) {
        return { success: false, error: `Re-push ${table}: ${res.error}` };
      }
    }

    useAuthStore.getState().setLastSyncedAt(Date.now());
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[sync] purgeAndRepushCloud exception:', msg);
    return { success: false, error: msg };
  }
}

async function migrateLegacyIds(): Promise<void> {
  try {
    const cash = await db.accounts.get('acc-cash');
    if (cash) {
      const newId = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await db.accounts.delete('acc-cash');
      await db.accounts.add({ ...cash, id: newId, updatedAt: Date.now() });
      const txns = await db.transactions.filter(t => t.accountId === 'acc-cash').toArray();
      for (const t of txns) {
        await db.transactions.update(t.id, { accountId: newId, updatedAt: Date.now() });
      }
    }

    const bank = await db.accounts.get('acc-bank');
    if (bank) {
      const newId = `acc-${Date.now() + 1}-${Math.random().toString(36).substring(2, 7)}`;
      await db.accounts.delete('acc-bank');
      await db.accounts.add({ ...bank, id: newId, updatedAt: Date.now() });
      const txns = await db.transactions.filter(t => t.accountId === 'acc-bank').toArray();
      for (const t of txns) {
        await db.transactions.update(t.id, { accountId: newId, updatedAt: Date.now() });
      }
    }
  } catch (err) {
    console.warn('[sync] Legacy ID migration failed:', err);
  }
}

// ── Full Two-Way Sync ────────────────────────────────────────────────────────

export async function syncAll(userId: string): Promise<{ success: boolean; error?: string }> {
  await migrateLegacyIds();

  // 1. Push all local tables
  const pushResults = await Promise.all(ALL_TABLES.map(t => pushTable(t, userId)));
  const failedPush = pushResults.find(r => !r.success && !r.skipped);
  if (failedPush) {
    return { success: false, error: `Upload error (${failedPush.error})` };
  }
  
  // 2. Pull all remote tables
  const pullResults = await Promise.all(ALL_TABLES.map(t => pullTable(t, userId)));
  const failedPull = pullResults.find(r => !r.success && !r.skipped);
  if (failedPull) {
    return { success: false, error: `Download error (${failedPull.error})` };
  }

  useAuthStore.getState().setLastSyncedAt(Date.now());
  return { success: true };
}

/** Retry any tables that failed during a previous push */
export async function drainPendingSync(userId: string): Promise<void> {
  const pending = getPending();
  if (pending.size === 0) return;
  console.log('[sync] Draining pending:', [...pending]);
  await Promise.all([...pending].map(t => pushTable(t, userId)));
}

// ── Hydrate from Cloud (Used on Login / New Device) ──────────────────────────

export async function hydrateFromCloud(userId: string): Promise<{ restoredCount: number }> {
  await migrateLegacyIds();
  let count = 0;

  for (const table of ALL_TABLES) {
    try {
      const { data, error } = await supabase.from(table).select('*').eq('user_id', userId);
      if (error || !data || data.length === 0) continue;

      switch (table) {
        case 'accounts':
          await db.accounts.bulkPut(data.map(r => fromSupabaseAccount(r)));
          break;
        case 'transactions':
          await db.transactions.bulkPut(data.map(r => fromSupabaseTransaction(r)));
          break;
        case 'budgets':
          await db.budgets.bulkPut(data.map(r => fromSupabaseBudget(r)));
          break;
        case 'tags':
          await db.tags.bulkPut(data.map(r => fromSupabaseTag(r)));
          break;
        case 'categories':
          await db.categories.bulkPut(data.map(r => fromSupabaseCategory(r)));
          break;
        case 'recurring_transactions':
          await db.recurringTransactions.bulkPut(data.map(r => fromSupabaseRecurring(r)));
          break;
        case 'savings_goals':
          await db.savingsGoals.bulkPut(data.map(r => fromSupabaseGoal(r)));
          break;
        case 'people':
          await db.people.bulkPut(data.map(r => fromSupabasePerson(r)));
          break;
        case 'debts':
          await db.debts.bulkPut(data.map(r => fromSupabaseDebt(r)));
          break;
        case 'credit_cards':
          await db.creditCards.bulkPut(data.map(r => fromSupabaseCreditCard(r)));
          break;
        case 'cash_offset_sources':
          await db.cashOffsetSources.bulkPut(data.map(r => fromSupabaseCashOffsetSource(r)));
          break;
        case 'fixed_deposits':
          await db.fixedDeposits.bulkPut(data.map(r => fromSupabaseFixedDeposit(r)));
          break;
        case 'money_market_accounts':
          await db.moneyMarketAccounts.bulkPut(data.map(r => fromSupabaseMMA(r)));
          break;
        case 'installment_plans':
          await db.installmentPlans.bulkPut(data.map(r => fromSupabaseInstallmentPlan(r)));
          break;
        case 'card_promos':
          await db.cardPromos.bulkPut(data.map(r => fromSupabaseCardPromo(r)));
          break;
        case 'float_gap_history':
          await db.floatGapHistory.bulkPut(data.map(r => fromSupabaseFloatGapHistory(r)));
          break;
        case 'reimbursement_ledgers':
          await db.reimbursementLedgers.bulkPut(data.map(r => fromSupabaseReimbursementLedger(r)));
          break;
        case 'reimbursement_entries':
          await db.reimbursementEntries.bulkPut(data.map(r => fromSupabaseReimbursementEntry(r)));
          break;
      }
      count += data.length;
    } catch {
      // Gracefully continue to next table
    }
  }

  useAuthStore.getState().setLastSyncedAt(Date.now());
  return { restoredCount: count };
}

// ── Debounced Trigger Helper ────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function triggerSync(immediate = false): void {
  const user = useAuthStore.getState().user;
  if (!user) return;

  if (syncTimer) clearTimeout(syncTimer);
  const delay = immediate ? 100 : 1500;
  syncTimer = setTimeout(() => {
    void syncAll(user.id);
    syncTimer = null;
  }, delay);
}
