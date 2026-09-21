/**
 * syncEngine.ts
 *
 * Local-first sync between Dexie (IndexedDB) and Supabase (Postgres).
 *
 * Covers all 18 tables:
 *  - Core:     accounts, categories, transactions, budgets, tags
 *  - Planning: recurring_transactions, savings_goals
 *  - IOUs:     people, debts
 *  - Float:    credit_cards, cash_offset_sources, fixed_deposits,
 *              money_market_accounts, installment_plans, card_promos,
 *              float_gap_history, reimbursement_ledgers, reimbursement_entries
 *
 * Sync model (local-first):
 *  WRITE  → save to Dexie → triggerSync(table, id) marks just that record dirty
 *           → debounce fires → pushDirtyRecords() sends only dirty rows to cloud
 *  READ   → always from Dexie (useLiveQuery)
 *  LOGIN / FOCUS / VISIBILITY → pullAll() only — pull cloud into local, no push
 *  RECONNECT / MANUAL SYNC   → pushDirtyRecords() then pullAll()
 *
 * Merge rule: remote wins only if remote.updatedAt >= local.updatedAt.
 * updatedAt || Date.now() is gone — missing timestamps use 0 (oldest possible).
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { db } from '../db/db';
import { useAuthStore } from '../store/authStore';
import { createId } from '../utils/createId';
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

// ── Dirty-record tracking (record-level, replaces table-level PENDING_KEY) ───

const DIRTY_KEY = 'finora-dirty';

type DirtyMap = Partial<Record<TableName, string[]>>;

function getDirty(): DirtyMap {
  try {
    const raw = localStorage.getItem(DIRTY_KEY);
    return raw ? (JSON.parse(raw) as DirtyMap) : {};
  } catch {
    return {};
  }
}

function markDirty(table: TableName, id: string): void {
  const map = getDirty();
  const ids = map[table] ?? [];
  if (!ids.includes(id)) ids.push(id);
  map[table] = ids;
  localStorage.setItem(DIRTY_KEY, JSON.stringify(map));
}

function clearDirtyIds(table: TableName, ids: string[]): void {
  const map = getDirty();
  const remaining = (map[table] ?? []).filter(id => !ids.includes(id));
  if (remaining.length === 0) {
    delete map[table];
  } else {
    map[table] = remaining;
  }
  localStorage.setItem(DIRTY_KEY, JSON.stringify(map));
}

// ── Deleted-record tracking (offline queue for deletes) ──────────────────────

const DELETED_KEY = 'finora-deleted';

type DeletedMap = Partial<Record<TableName, string[]>>;

function getDeleted(): DeletedMap {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    return raw ? (JSON.parse(raw) as DeletedMap) : {};
  } catch {
    return {};
  }
}

function markDeleted(table: TableName, id: string): void {
  // If it was pending creation/update, remove from dirty queue
  clearDirtyIds(table, [id]);

  const map = getDeleted();
  const ids = map[table] ?? [];
  if (!ids.includes(id)) ids.push(id);
  map[table] = ids;
  localStorage.setItem(DELETED_KEY, JSON.stringify(map));
}

function clearDeletedIds(table: TableName, ids: string[]): void {
  const map = getDeleted();
  const remaining = (map[table] ?? []).filter(id => !ids.includes(id));
  if (remaining.length === 0) {
    delete map[table];
  } else {
    map[table] = remaining;
  }
  localStorage.setItem(DELETED_KEY, JSON.stringify(map));
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
// NOTE: updated_at uses ?? 0, NOT || Date.now().
// A missing/zero timestamp sorts as oldest — it will be overwritten by cloud
// data, never falsely promoted above a real timestamp.

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
    updated_at: a.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: t.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: b.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
  };
}

// Tags
function toSupabaseTag(userId: string, t: Tag) {
  return {
    id: t.id,
    user_id: userId,
    name: t.name,
    color: t.color || null,
    updated_at: t.updatedAt ?? 0,
  };
}

function fromSupabaseTag(row: Record<string, unknown>): Tag {
  return {
    id: String(row.id),
    name: String(row.name),
    color: row.color ? String(row.color) : undefined,
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: c.updatedAt ?? 0,
  };
}

function fromSupabaseCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    type: (row.type as Category['type']) || 'expense',
    icon: String(row.icon || 'tag'),
    color: String(row.color || '#3b82f6'),
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: r.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: g.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
  };
}

// People
function toSupabasePerson(userId: string, p: Person) {
  return {
    id: p.id,
    user_id: userId,
    name: p.name,
    updated_at: p.updatedAt ?? 0,
  };
}

function fromSupabasePerson(row: Record<string, unknown>): Person {
  return {
    id: String(row.id),
    name: String(row.name),
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: d.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: c.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: s.updatedAt ?? 0,
  };
}

function fromSupabaseCashOffsetSource(row: Record<string, unknown>): CashOffsetSource {
  return {
    id: String(row.id),
    name: String(row.name),
    linkedCardId: String(row.linked_card_id),
    expectedMonthlyAmount: Number(row.expected_monthly_amount) || 0,
    category: row.category ? String(row.category) : undefined,
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: f.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: m.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: p.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: cp.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: g.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
  };
}

// Reimbursement Ledgers
function toSupabaseReimbursementLedger(userId: string, l: ReimbursementLedger) {
  return {
    id: l.id,
    user_id: userId,
    counterparty_name: l.counterpartyName,
    updated_at: l.updatedAt ?? 0,
  };
}

function fromSupabaseReimbursementLedger(row: Record<string, unknown>): ReimbursementLedger {
  return {
    id: String(row.id),
    counterpartyName: String(row.counterparty_name),
    updatedAt: Number(row.updated_at) || 0,
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
    updated_at: e.updatedAt ?? 0,
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
    updatedAt: Number(row.updated_at) || 0,
  };
}

// ── Fetch specific IDs from local Dexie ──────────────────────────────────────

async function fetchLocalRows(
  table: TableName,
  userId: string,
  ids: string[],
): Promise<Record<string, unknown>[]> {
  switch (table) {
    case 'accounts':
      return (await db.accounts.bulkGet(ids)).filter(Boolean).map(a => toSupabaseAccount(userId, a!));
    case 'transactions':
      return (await db.transactions.bulkGet(ids)).filter(Boolean).map(t => toSupabaseTransaction(userId, t!));
    case 'budgets':
      return (await db.budgets.bulkGet(ids)).filter(Boolean).map(b => toSupabaseBudget(userId, b!));
    case 'tags':
      return (await db.tags.bulkGet(ids)).filter(Boolean).map(t => toSupabaseTag(userId, t!));
    case 'categories':
      return (await db.categories.bulkGet(ids)).filter(Boolean).map(c => toSupabaseCategory(userId, c!));
    case 'recurring_transactions':
      return (await db.recurringTransactions.bulkGet(ids)).filter(Boolean).map(r => toSupabaseRecurring(userId, r!));
    case 'savings_goals':
      return (await db.savingsGoals.bulkGet(ids)).filter(Boolean).map(g => toSupabaseGoal(userId, g!));
    case 'people':
      return (await db.people.bulkGet(ids)).filter(Boolean).map(p => toSupabasePerson(userId, p!));
    case 'debts':
      return (await db.debts.bulkGet(ids)).filter(Boolean).map(d => toSupabaseDebt(userId, d!));
    case 'credit_cards':
      return (await db.creditCards.bulkGet(ids)).filter(Boolean).map(c => toSupabaseCreditCard(userId, c!));
    case 'cash_offset_sources':
      return (await db.cashOffsetSources.bulkGet(ids)).filter(Boolean).map(s => toSupabaseCashOffsetSource(userId, s!));
    case 'fixed_deposits':
      return (await db.fixedDeposits.bulkGet(ids)).filter(Boolean).map(f => toSupabaseFixedDeposit(userId, f!));
    case 'money_market_accounts':
      return (await db.moneyMarketAccounts.bulkGet(ids)).filter(Boolean).map(m => toSupabaseMMA(userId, m!));
    case 'installment_plans':
      return (await db.installmentPlans.bulkGet(ids)).filter(Boolean).map(p => toSupabaseInstallmentPlan(userId, p!));
    case 'card_promos':
      return (await db.cardPromos.bulkGet(ids)).filter(Boolean).map(cp => toSupabaseCardPromo(userId, cp!));
    case 'float_gap_history':
      return (await db.floatGapHistory.bulkGet(ids)).filter(Boolean).map(g => toSupabaseFloatGapHistory(userId, g!));
    case 'reimbursement_ledgers':
      return (await db.reimbursementLedgers.bulkGet(ids)).filter(Boolean).map(l => toSupabaseReimbursementLedger(userId, l!));
    case 'reimbursement_entries':
      return (await db.reimbursementEntries.bulkGet(ids)).filter(Boolean).map(e => toSupabaseReimbursementEntry(userId, e!));
  }
}

// ── Write remote rows into local Dexie, merging on updatedAt ─────────────────

async function mergeRemoteRows(
  table: TableName,
  remoteData: Record<string, unknown>[],
): Promise<void> {
  // Helper: merge a batch of remote rows into a Dexie table.
  // 1. Reconciles deletions: removes any local rows missing from remoteData (unless pending dirty write)
  // 2. Upserts: writes remote rows where remote.updatedAt >= local.updatedAt or !local
  async function merge<T extends { id: string; updatedAt?: number }>(
    dexieTable: {
      bulkGet: (ids: string[]) => Promise<(T | undefined)[]>;
      bulkPut: (items: T[]) => Promise<unknown>;
      bulkDelete: (ids: string[]) => Promise<void>;
      toCollection: () => { primaryKeys: () => Promise<string[]> };
    },
    remoteRows: T[],
  ) {
    // 1. Identify and delete local rows that were deleted from cloud
    const remoteIdSet = new Set(remoteRows.map(r => r.id));
    const dirtyIdSet = new Set(getDirty()[table] ?? []);
    const localIds = await dexieTable.toCollection().primaryKeys();
    const candidateIds = localIds.filter(id => !remoteIdSet.has(id) && !dirtyIdSet.has(id));
    if (candidateIds.length > 0) {
      const candidateRows = await dexieTable.bulkGet(candidateIds);
      const graceThreshold = Date.now() - 60_000; // 60-second backstop for in-flight/recent writes
      const toDelete = candidateIds.filter((_, i) => {
        const row = candidateRows[i];
        if (row && (row.updatedAt ?? 0) > graceThreshold) {
          return false; // Protect recent local write
        }
        return true;
      });
      if (toDelete.length > 0) {
        await dexieTable.bulkDelete(toDelete);
      }
    }

    // 2. Upsert changed or new remote rows
    if (remoteRows.length > 0) {
      const localRows = await dexieTable.bulkGet(remoteRows.map(r => r.id));
      const toWrite = remoteRows.filter((remote, i) => {
        const local = localRows[i];
        return !local || (remote.updatedAt ?? 0) >= (local.updatedAt ?? 0);
      });
      if (toWrite.length > 0) await dexieTable.bulkPut(toWrite);
    }
  }

  switch (table) {
    case 'accounts':
      await merge(db.accounts, remoteData.map(fromSupabaseAccount));
      break;
    case 'transactions':
      await merge(db.transactions, remoteData.map(fromSupabaseTransaction));
      break;
    case 'budgets':
      await merge(db.budgets, remoteData.map(fromSupabaseBudget));
      break;
    case 'tags':
      await merge(db.tags, remoteData.map(fromSupabaseTag));
      break;
    case 'categories':
      await merge(db.categories, remoteData.map(fromSupabaseCategory));
      break;
    case 'recurring_transactions':
      await merge(db.recurringTransactions, remoteData.map(fromSupabaseRecurring));
      break;
    case 'savings_goals':
      await merge(db.savingsGoals, remoteData.map(fromSupabaseGoal));
      break;
    case 'people':
      await merge(db.people, remoteData.map(fromSupabasePerson));
      break;
    case 'debts':
      await merge(db.debts, remoteData.map(fromSupabaseDebt));
      break;
    case 'credit_cards':
      await merge(db.creditCards, remoteData.map(fromSupabaseCreditCard));
      break;
    case 'cash_offset_sources':
      await merge(db.cashOffsetSources, remoteData.map(fromSupabaseCashOffsetSource));
      break;
    case 'fixed_deposits':
      await merge(db.fixedDeposits, remoteData.map(fromSupabaseFixedDeposit));
      break;
    case 'money_market_accounts':
      await merge(db.moneyMarketAccounts, remoteData.map(fromSupabaseMMA));
      break;
    case 'installment_plans':
      await merge(db.installmentPlans, remoteData.map(fromSupabaseInstallmentPlan));
      break;
    case 'card_promos':
      await merge(db.cardPromos, remoteData.map(fromSupabaseCardPromo));
      break;
    case 'float_gap_history':
      await merge(db.floatGapHistory, remoteData.map(fromSupabaseFloatGapHistory));
      break;
    case 'reimbursement_ledgers':
      await merge(db.reimbursementLedgers, remoteData.map(fromSupabaseReimbursementLedger));
      break;
    case 'reimbursement_entries':
      await merge(db.reimbursementEntries, remoteData.map(fromSupabaseReimbursementEntry));
      break;
  }
}

// ── Push (Local → Supabase) ──────────────────────────────────────────────────

/**
 * pushTable — push the ENTIRE table to Supabase.
 * Only used by purgeAndRepushCloud (the "reset cloud" operation in Settings).
 * Normal writes go through pushDirtyRecords instead.
 */
export async function pushTable(
  table: TableName,
  userId: string,
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  if (!isSupabaseConfigured) return { success: true, skipped: true };
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

    if (rows.length === 0) return { success: true };

    const { error } = await supabase.from(table).upsert(rows.map(stripUndefinedFields), { onConflict: 'id' });
    if (error) {
      if (isTableMissingError(error.message)) return { success: true, skipped: true };
      console.warn(`[sync] pushTable failed for ${table}:`, error.message);
      return { success: false, error: `${table}: ${error.message}` };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTableMissingError(msg)) return { success: true, skipped: true };
    console.warn(`[sync] pushTable exception for ${table}:`, msg);
    return { success: false, error: `${table}: ${msg}` };
  }
}

function stripUndefinedFields(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * pushDirtyRecords — push only records marked dirty by triggerSync.
 * This is the normal write path for every user action.
 */
export async function pushDirtyRecords(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const map = getDirty();
  const tables = Object.keys(map) as TableName[];
  if (tables.length === 0) return;

  await Promise.all(
    tables.map(async table => {
      const ids = map[table];
      if (!ids || ids.length === 0) return;
      try {
        const rows = await fetchLocalRows(table, userId, ids);
        if (rows.length === 0) {
          // Records may have been deleted — clean up dirty list
          clearDirtyIds(table, ids);
          return;
        }
        const { error } = await supabase.from(table).upsert(rows.map(stripUndefinedFields), { onConflict: 'id' });
        if (error) {
          if (isTableMissingError(error.message)) {
            clearDirtyIds(table, ids);
            return;
          }
          console.warn(`[sync] pushDirtyRecords failed for ${table}:`, error);
          return; // Keep dirty — will retry next time
        }
        clearDirtyIds(table, ids);
      } catch (err) {
        console.warn(`[sync] pushDirtyRecords exception for ${table}:`, err);
      }
    }),
  );
}

// ── Pull (Supabase → Local, with updatedAt merge) ────────────────────────────

/**
 * pullTable — pull all rows for a table from Supabase and merge into Dexie.
 * Remote wins only if remote.updatedAt >= local.updatedAt.
 */
export async function pullTable(
  table: TableName,
  userId: string,
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  if (!isSupabaseConfigured) return { success: true, skipped: true };
  try {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId);
    if (error) {
      if (isTableMissingError(error.message)) return { success: true, skipped: true };
      console.warn(`[sync] pullTable failed for ${table}:`, error.message);
      return { success: false, error: `${table}: ${error.message}` };
    }
    await mergeRemoteRows(table, data ?? []);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTableMissingError(msg)) return { success: true, skipped: true };
    console.warn(`[sync] pullTable exception for ${table}:`, msg);
    return { success: false, error: `${table}: ${msg}` };
  }
}

/**
 * pullLiveActivity — pull only accounts and transactions.
 * Used for fast background polling (e.g. 15s) and focus so the other device
 * sees new transactions and balance changes quickly without pulling all 18 tables.
 */
export async function pullLiveActivity(userId: string): Promise<void> {
  await Promise.all([pullTable('accounts', userId), pullTable('transactions', userId)]);
}

/**
 * pullAll — pull every table from Supabase.
 * Called on login, focus, and visibility change. Does NOT push first.
 */
export async function pullAll(userId: string): Promise<{ success: boolean; error?: string }> {
  const results = await Promise.all(ALL_TABLES.map(t => pullTable(t, userId)));
  const failed = results.find(r => !r.success && !r.skipped);
  if (failed) return { success: false, error: failed.error };
  useAuthStore.getState().setLastSyncedAt(Date.now());
  return { success: true };
}

// ── Delete from Supabase ────────────────────────────────────────────────────

export async function deleteFromCloud(table: TableName, id: string): Promise<void> {
  // Always queue in offline deletion tracker (and clear any pending dirty write)
  markDeleted(table, id);

  if (!isSupabaseConfigured) return;
  const user = useAuthStore.getState().user;
  if (!user) return;

  try {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      console.warn(`[sync] Delete failed for ${table}/${id}:`, error.message);
      return;
    }
    clearDeletedIds(table, [id]);
  } catch (err) {
    console.warn(`[sync] Delete failed for ${table}/${id}:`, err);
  }
}

/** Retry any deletions that failed while offline */
export async function drainDeletedRecords(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const map = getDeleted();
  const tables = Object.keys(map) as TableName[];
  if (tables.length === 0) return;

  await Promise.all(
    tables.map(async table => {
      const ids = map[table];
      if (!ids || ids.length === 0) return;
      try {
        const { error } = await supabase.from(table).delete().in('id', ids).eq('user_id', userId);
        if (!error) {
          clearDeletedIds(table, ids);
        }
      } catch (err) {
        console.warn(`[sync] Failed to drain deletes for ${table}:`, err);
      }
    }),
  );
}

/**
 * upsertSingleRemoteRow — writes a single incoming realtime row to Dexie if newer.
 * Crucially does NOT run deletion reconciliation on the rest of the table.
 */
async function upsertSingleRemoteRow(
  table: TableName,
  row: Record<string, unknown>,
): Promise<void> {
  async function putIfNewer<T extends { id: string; updatedAt?: number }>(
    dexieTable: any,
    item: T,
  ) {
    const local = await dexieTable.get(item.id);
    if (!local || (item.updatedAt ?? 0) >= (local.updatedAt ?? 0)) {
      await dexieTable.put(item);
    }
  }

  switch (table) {
    case 'accounts': await putIfNewer(db.accounts, fromSupabaseAccount(row)); break;
    case 'transactions': await putIfNewer(db.transactions, fromSupabaseTransaction(row)); break;
    case 'budgets': await putIfNewer(db.budgets, fromSupabaseBudget(row)); break;
    case 'tags': await putIfNewer(db.tags, fromSupabaseTag(row)); break;
    case 'categories': await putIfNewer(db.categories, fromSupabaseCategory(row)); break;
    case 'recurring_transactions': await putIfNewer(db.recurringTransactions, fromSupabaseRecurring(row)); break;
    case 'savings_goals': await putIfNewer(db.savingsGoals, fromSupabaseGoal(row)); break;
    case 'people': await putIfNewer(db.people, fromSupabasePerson(row)); break;
    case 'debts': await putIfNewer(db.debts, fromSupabaseDebt(row)); break;
    case 'credit_cards': await putIfNewer(db.creditCards, fromSupabaseCreditCard(row)); break;
    case 'cash_offset_sources': await putIfNewer(db.cashOffsetSources, fromSupabaseCashOffsetSource(row)); break;
    case 'fixed_deposits': await putIfNewer(db.fixedDeposits, fromSupabaseFixedDeposit(row)); break;
    case 'money_market_accounts': await putIfNewer(db.moneyMarketAccounts, fromSupabaseMMA(row)); break;
    case 'installment_plans': await putIfNewer(db.installmentPlans, fromSupabaseInstallmentPlan(row)); break;
    case 'card_promos': await putIfNewer(db.cardPromos, fromSupabaseCardPromo(row)); break;
    case 'float_gap_history': await putIfNewer(db.floatGapHistory, fromSupabaseFloatGapHistory(row)); break;
    case 'reimbursement_ledgers': await putIfNewer(db.reimbursementLedgers, fromSupabaseReimbursementLedger(row)); break;
    case 'reimbursement_entries': await putIfNewer(db.reimbursementEntries, fromSupabaseReimbursementEntry(row)); break;
  }
}

/**
 * applyRealtimeChange — processes an instant change arriving over Supabase Realtime WebSocket.
 */
export async function applyRealtimeChange(
  table: TableName,
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  newRow: Record<string, unknown> | null,
  oldRow: Record<string, unknown> | null,
): Promise<void> {
  if (eventType === 'DELETE') {
    const id = oldRow?.id ? String(oldRow.id) : null;
    if (!id) return;
    switch (table) {
      case 'accounts': await db.accounts.delete(id); break;
      case 'transactions': await db.transactions.delete(id); break;
      case 'budgets': await db.budgets.delete(id); break;
      case 'tags': await db.tags.delete(id); break;
      case 'categories': await db.categories.delete(id); break;
      case 'recurring_transactions': await db.recurringTransactions.delete(id); break;
      case 'savings_goals': await db.savingsGoals.delete(id); break;
      case 'people': await db.people.delete(id); break;
      case 'debts': await db.debts.delete(id); break;
      case 'credit_cards': await db.creditCards.delete(id); break;
      case 'cash_offset_sources': await db.cashOffsetSources.delete(id); break;
      case 'fixed_deposits': await db.fixedDeposits.delete(id); break;
      case 'money_market_accounts': await db.moneyMarketAccounts.delete(id); break;
      case 'installment_plans': await db.installmentPlans.delete(id); break;
      case 'card_promos': await db.cardPromos.delete(id); break;
      case 'float_gap_history': await db.floatGapHistory.delete(id); break;
      case 'reimbursement_ledgers': await db.reimbursementLedgers.delete(id); break;
      case 'reimbursement_entries': await db.reimbursementEntries.delete(id); break;
    }
    return;
  }

  if ((eventType === 'INSERT' || eventType === 'UPDATE') && newRow) {
    await upsertSingleRemoteRow(table, newRow);
  }
}

// ── Hydrate from Cloud (used on first login / new device) ───────────────────
// Previously a 73-line copy of pullTable's switch. Now just calls pullTable.

export async function hydrateFromCloud(userId: string): Promise<{ restoredCount: number }> {
  await migrateLegacyIds();
  const results = await Promise.all(ALL_TABLES.map(t => pullTable(t, userId)));
  const count = results.filter(r => r.success && !r.skipped).length;
  useAuthStore.getState().setLastSyncedAt(Date.now());
  return { restoredCount: count };
}

// ── Purge All Cloud Data + Re-push Local ─────────────────────────────────────

export async function purgeAndRepushCloud(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    for (const table of ALL_TABLES) {
      const { error } = await supabase.from(table).delete().eq('user_id', userId);
      if (error && !isTableMissingError(error.message)) {
        console.warn(`[sync] Purge failed for ${table}:`, error.message);
        return { success: false, error: `Purge ${table}: ${error.message}` };
      }
    }

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

// ── Legacy ID migration (one-time, runs on first syncAll after upgrade) ──────

async function migrateLegacyIds(): Promise<void> {
  try {
    const cash = await db.accounts.get('acc-cash');
    if (cash) {
      const newId = createId('acc');
      await db.accounts.delete('acc-cash');
      await db.accounts.add({ ...cash, id: newId, updatedAt: Date.now() });
      const txns = await db.transactions.filter(t => t.accountId === 'acc-cash').toArray();
      for (const t of txns) {
        await db.transactions.update(t.id, { accountId: newId, updatedAt: Date.now() });
      }
    }

    const bank = await db.accounts.get('acc-bank');
    if (bank) {
      const newId = createId('acc');
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

// ── Full Two-Way Sync (used by purgeAndRepush and manual "Sync Now") ──────────

export async function syncAll(userId: string): Promise<{ success: boolean; error?: string }> {
  await migrateLegacyIds();
  await pushDirtyRecords(userId);
  return pullAll(userId);
}

// ── Debounced Trigger Helper ─────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * triggerSync — mark a single record dirty and schedule a push.
 *
 * Call this immediately after every local write:
 *   await db.accounts.put(account);
 *   triggerSync('accounts', account.id);
 *
 * The push is debounced 1.5 s so rapid writes batch into one network request.
 */
export function triggerSync(table: TableName, id: string, immediate = false): void {
  // Always mark dirty immediately to protect the record from remote deletion sweeps,
  // even if the user session is still resolving or currently offline.
  markDirty(table, id);

  const user = useAuthStore.getState().user;
  if (!user) return;

  if (syncTimer) clearTimeout(syncTimer);
  const delay = immediate ? 100 : 1500;
  syncTimer = setTimeout(() => {
    void pushDirtyRecords(user.id);
    syncTimer = null;
  }, delay);
}

/** Check if any pending dirty writes exist, optionally filtered by specific tables. */
export function hasPendingDirty(tables?: TableName[]): boolean {
  const map = getDirty();
  if (!tables) {
    return Object.values(map).some(ids => ids && ids.length > 0);
  }
  return tables.some(t => map[t] && map[t]!.length > 0);
}

/** Retry any records or deletions that failed while offline (called on reconnect). */
export async function drainPendingSync(userId: string): Promise<void> {
  await drainDeletedRecords(userId);
  const map = getDirty();
  const hasAny = Object.values(map).some(ids => ids && ids.length > 0);
  if (!hasAny) return;
  console.log('[sync] Draining dirty records:', map);
  await pushDirtyRecords(userId);
}
