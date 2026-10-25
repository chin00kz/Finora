import { createId } from '../utils/createId';
import { db } from '../db/db';
import type { Transaction, Account, Category, Tag, TransactionType, AccountType } from '../db/db';
import {
  applyAccountBalanceDeltas,
  computeApplyBalanceDeltas,
  validateAccountsForApply,
} from './accountBalanceEffects';

/**
 * Robust RFC 4180 CSV line parser.
 * Handles escaped quotes, commas inside quotes, CRLF and LF newlines.
 */
export function parseCSV(csvText: string): string[][] {
  // Strip BOM if present
  let cleanText = csvText;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (insideQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentField.trim());
        if (currentRow.some(field => field.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some(field => field.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export interface ParsedCSVRow {
  dateStr: string;
  timeStr?: string;
  timestamp: number;
  type: TransactionType;
  amount: number;
  categoryName?: string;
  accountName: string;
  /** Destination account for transfers */
  toAccountName?: string;
  tagNames: string[];
  notes?: string;
  excludeFromBudget: boolean;
  /** Stable key for import dedupe / retry safety */
  fingerprint: string;
}

export interface SkippedCSVRow {
  rowNumber: number; // 1-based data row (excludes header)
  reason: string;
}

export interface CSVAnalysis {
  validRows: ParsedCSVRow[];
  skippedRows: SkippedCSVRow[];
  totalRows: number;
  invalidRowsCount: number;
  accountsToCreate: string[];
  categoriesToCreate: { name: string; type: 'income' | 'expense' }[];
  tagsToCreate: string[];
  totalExpenseAmount: number;
  totalIncomeAmount: number;
  transferCount: number;
}

export function csvImportFingerprint(parts: {
  timestamp: number;
  type: string;
  amount: number;
  accountName: string;
  toAccountName?: string;
  notes?: string;
}): string {
  return [
    parts.timestamp,
    parts.type,
    parts.amount,
    parts.accountName.trim().toLowerCase(),
    (parts.toAccountName || '').trim().toLowerCase(),
    (parts.notes || '').trim().toLowerCase(),
  ].join('|');
}

/**
 * Flexible date parser for various standard formats.
 */
function parseDateWithTime(dateStr: string, timeStr?: string): number {
  const cleanDate = dateStr.trim();
  let year = new Date().getFullYear();
  let month = 0;
  let day = 1;
  let hours = 12;
  let minutes = 0;

  const isoMatch = cleanDate.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10) - 1;
    day = parseInt(isoMatch[3], 10);
  } else {
    const slashMatch = cleanDate.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (slashMatch) {
      const p1 = parseInt(slashMatch[1], 10);
      const p2 = parseInt(slashMatch[2], 10);
      let p3 = parseInt(slashMatch[3], 10);
      if (p3 < 100) p3 += 2000;

      if (p1 > 12) {
        day = p1;
        month = p2 - 1;
      } else {
        month = p1 - 1;
        day = p2;
      }
      year = p3;
    } else {
      const parsed = Date.parse(cleanDate);
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        year = d.getFullYear();
        month = d.getMonth();
        day = d.getDate();
      }
    }
  }

  if (timeStr && timeStr.trim()) {
    const cleanTime = timeStr.trim();
    const timeMatch = cleanTime.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3]?.toLowerCase();

      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;

      hours = h;
      minutes = m;
    }
  }

  return new Date(year, month, day, hours, minutes, 0, 0).getTime();
}

function parseAmount(raw: string): { amount: number; isNegative: boolean } {
  const clean = raw.replace(/[^0-9.-]/g, '').trim();
  const num = parseFloat(clean);
  if (isNaN(num)) return { amount: 0, isNegative: false };
  return {
    amount: Math.abs(num),
    isNegative: num < 0 || raw.includes('-'),
  };
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Prefer exact header match, then includes — skipping already claimed columns. */
function findCol(
  headerRow: string[],
  candidates: string[],
  claimed: Set<number> = new Set(),
): number {
  for (let i = 0; i < headerRow.length; i++) {
    if (claimed.has(i)) continue;
    if (candidates.some(c => headerRow[i] === c)) return i;
  }
  for (let i = 0; i < headerRow.length; i++) {
    if (claimed.has(i)) continue;
    if (candidates.some(c => headerRow[i].includes(c))) return i;
  }
  return -1;
}

export interface CSVAnalyzeContext {
  existingAccountNames: Set<string>; // lowercase
  existingCategoryKeys: Set<string>; // name|type lowercase
  existingTagNames: Set<string>; // lowercase
  /** Existing import fingerprints to skip duplicates on retry */
  existingFingerprints?: Set<string>;
}

/**
 * Pure CSV analysis (testable without Dexie).
 */
export function analyzeCSVRows(rows: string[][], ctx: CSVAnalyzeContext): CSVAnalysis {
  if (rows.length < 2) {
    throw new Error('The CSV file does not contain enough data (missing headers or rows).');
  }

  const headerRow = rows[0].map(normalizeHeader);
  const claimed = new Set<number>();

  // Destination before source so "toaccount" is not claimed as "account"
  const toAccCol = findCol(
    headerRow,
    ['toaccount', 'destinationaccount', 'destination', 'transferto', 'toacc'],
    claimed,
  );
  if (toAccCol !== -1) claimed.add(toAccCol);

  const dateCol = findCol(headerRow, ['date', 'timestamp'], claimed);
  if (dateCol !== -1) claimed.add(dateCol);

  const timeCol = findCol(headerRow, ['time', 'hour'], claimed);
  if (timeCol !== -1) claimed.add(timeCol);

  const typeCol = findCol(headerRow, ['type', 'transactiontype', 'txntype'], claimed);
  if (typeCol !== -1) claimed.add(typeCol);

  const amountCol = findCol(headerRow, ['amount', 'lkr', 'total', 'value', 'price'], claimed);
  if (amountCol !== -1) claimed.add(amountCol);

  const catCol = findCol(headerRow, ['category', 'cat'], claimed);
  if (catCol !== -1) claimed.add(catCol);

  const accCol = findCol(headerRow, ['account', 'acc', 'wallet', 'bank', 'fromaccount', 'sourceaccount'], claimed);
  if (accCol !== -1) claimed.add(accCol);

  const tagsCol = findCol(headerRow, ['tags', 'tag', 'label'], claimed);
  if (tagsCol !== -1) claimed.add(tagsCol);

  const notesCol = findCol(headerRow, ['notes', 'note', 'description', 'desc', 'memo', 'title'], claimed);
  if (notesCol !== -1) claimed.add(notesCol);

  const outBudgetCol = findCol(headerRow, ['outofbudget', 'excludefrombudget', 'budgetexclude'], claimed);

  if (dateCol === -1 || amountCol === -1) {
    throw new Error('Could not identify required "Date" and "Amount" columns in the CSV headers.');
  }

  const validRows: ParsedCSVRow[] = [];
  const skippedRows: SkippedCSVRow[] = [];
  let totalExpense = 0;
  let totalIncome = 0;
  let transferCount = 0;

  const accountsToCreateSet = new Set<string>();
  const categoriesToCreateSet = new Map<string, 'income' | 'expense'>();
  const tagsToCreateSet = new Set<string>();
  const batchFingerprints = new Set<string>();

  const noteAccount = (name: string) => {
    if (!ctx.existingAccountNames.has(name.toLowerCase())) {
      accountsToCreateSet.add(name);
    }
  };

  for (let i = 1; i < rows.length; i++) {
    const rowNumber = i; // data row index matching spreadsheet row-1 if header is row 1
    const r = rows[i];
    const dateRaw = r[dateCol];
    const amountRaw = r[amountCol];

    if (!dateRaw || !amountRaw) {
      skippedRows.push({ rowNumber, reason: 'Missing date or amount' });
      continue;
    }

    const { amount, isNegative } = parseAmount(amountRaw);
    if (amount <= 0) {
      skippedRows.push({ rowNumber, reason: 'Invalid or zero amount' });
      continue;
    }

    const timeRaw = timeCol !== -1 && timeCol !== dateCol ? r[timeCol] : undefined;
    const timestamp = parseDateWithTime(dateRaw, timeRaw);

    let type: TransactionType = 'expense';
    if (typeCol !== -1 && r[typeCol]) {
      const tVal = r[typeCol].toLowerCase().trim();
      if (
        tVal === 'opening_balance' ||
        tVal === 'balance_adjustment' ||
        tVal.includes('opening balance') ||
        tVal.includes('balance adjustment')
      ) {
        skippedRows.push({
          rowNumber,
          reason: 'Opening balance / balance adjustment rows are not imported via CSV',
        });
        continue;
      }
      if (tVal.includes('income') || tVal.includes('deposit') || tVal === 'credit') {
        type = 'income';
      } else if (tVal.includes('transfer')) {
        type = 'transfer';
      } else if (tVal.includes('expense') || tVal.includes('debit')) {
        type = 'expense';
      } else {
        type = 'expense';
      }
    } else {
      type = isNegative ? 'expense' : 'income';
    }

    const accRaw = accCol !== -1 && r[accCol] ? r[accCol].trim() : '';
    const accountName = accRaw || (type === 'transfer' ? '' : 'Wallet');
    if (!accountName) {
      skippedRows.push({ rowNumber, reason: 'Missing source account' });
      continue;
    }

    let toAccountName: string | undefined;
    if (type === 'transfer') {
      const toRaw = toAccCol !== -1 && r[toAccCol] ? r[toAccCol].trim() : '';
      if (!toRaw) {
        skippedRows.push({
          rowNumber,
          reason: 'Transfer requires both source and destination accounts (To Account column)',
        });
        continue;
      }
      if (toRaw.toLowerCase() === accountName.toLowerCase()) {
        skippedRows.push({
          rowNumber,
          reason: 'Transfer source and destination accounts must be different',
        });
        continue;
      }
      toAccountName = toRaw;
      noteAccount(accountName);
      noteAccount(toAccountName);
    } else {
      noteAccount(accountName);
    }

    const catRaw = catCol !== -1 && r[catCol] ? r[catCol].trim() : undefined;
    let categoryName: string | undefined;
    if (
      type !== 'transfer' &&
      catRaw &&
      catRaw.toLowerCase() !== 'none' &&
      catRaw.toLowerCase() !== 'uncategorized'
    ) {
      categoryName = catRaw;
      const catKey = `${categoryName.toLowerCase()}|${type === 'income' ? 'income' : 'expense'}`;
      if (!ctx.existingCategoryKeys.has(catKey)) {
        categoriesToCreateSet.set(categoryName, type === 'income' ? 'income' : 'expense');
      }
    }

    const tagsRaw = tagsCol !== -1 && r[tagsCol] ? r[tagsCol].trim() : '';
    const tagNames = tagsRaw
      ? tagsRaw
          .split(/[;,]/)
          .map(t => t.trim())
          .filter(Boolean)
      : [];

    tagNames.forEach(t => {
      if (!ctx.existingTagNames.has(t.toLowerCase())) {
        tagsToCreateSet.add(t);
      }
    });

    const notes = notesCol !== -1 && r[notesCol] ? r[notesCol].trim() : undefined;

    let excludeFromBudget = false;
    if (outBudgetCol !== -1 && r[outBudgetCol]) {
      const obVal = r[outBudgetCol].toLowerCase();
      excludeFromBudget = obVal === 'yes' || obVal === 'true' || obVal === '1';
    }

    const fingerprint = csvImportFingerprint({
      timestamp,
      type,
      amount,
      accountName,
      toAccountName,
      notes,
    });

    if (ctx.existingFingerprints?.has(fingerprint) || batchFingerprints.has(fingerprint)) {
      skippedRows.push({
        rowNumber,
        reason: 'Duplicate of an existing or earlier row (skipped to avoid double import)',
      });
      continue;
    }
    batchFingerprints.add(fingerprint);

    if (type === 'expense') totalExpense += amount;
    if (type === 'income') totalIncome += amount;
    if (type === 'transfer') transferCount++;

    validRows.push({
      dateStr: dateRaw,
      timeStr: timeRaw,
      timestamp,
      type,
      amount,
      categoryName,
      accountName,
      toAccountName,
      tagNames,
      notes,
      excludeFromBudget,
      fingerprint,
    });
  }

  return {
    validRows,
    skippedRows,
    totalRows: rows.length - 1,
    invalidRowsCount: skippedRows.length,
    accountsToCreate: Array.from(accountsToCreateSet),
    categoriesToCreate: Array.from(categoriesToCreateSet.entries()).map(([name, type]) => ({
      name,
      type,
    })),
    tagsToCreate: Array.from(tagsToCreateSet),
    totalExpenseAmount: totalExpense,
    totalIncomeAmount: totalIncome,
    transferCount,
  };
}

/**
 * Analyzes CSV content and returns preview metrics.
 */
export async function analyzeCSV(csvText: string): Promise<CSVAnalysis> {
  const rows = parseCSV(csvText);
  const existingAccounts = await db.accounts.toArray();
  const existingCategories = await db.categories.toArray();
  const existingTags = await db.tags.toArray();
  const existingTxns = await db.transactions.toArray();
  const accById = new Map(existingAccounts.map(a => [a.id, a.name]));

  const existingFingerprints = new Set(
    existingTxns.map(t =>
      csvImportFingerprint({
        timestamp: t.date,
        type: t.type,
        amount: t.amount,
        accountName: accById.get(t.accountId) || t.accountId,
        toAccountName: t.toAccountId ? accById.get(t.toAccountId) || t.toAccountId : undefined,
        notes: t.notes,
      }),
    ),
  );

  return analyzeCSVRows(rows, {
    existingAccountNames: new Set(existingAccounts.map(a => a.name.toLowerCase())),
    existingCategoryKeys: new Set(
      existingCategories.map(c => `${c.name.toLowerCase()}|${c.type}`),
    ),
    existingTagNames: new Set(existingTags.map(t => t.name.toLowerCase())),
    existingFingerprints,
  });
}

const DEFAULT_CATEGORY_COLORS = [
  '#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#14b8a6', '#6366f1', '#84cc16',
];

/**
 * Executes the import into IndexedDB.
 * Balance adjustments use shared accountBalanceEffects helpers exactly once per imported row.
 */
export async function executeImport(
  analysis: CSVAnalysis,
  options: { adjustBalances: boolean } = { adjustBalances: true },
): Promise<{
  importedTransactionsCount: number;
  skippedDuplicateCount: number;
  createdAccountsCount: number;
  createdCategoriesCount: number;
  createdTagsCount: number;
}> {
  const { getPersonalFinanceEditBlockError } = await import('../sync/restoreIsolation');
  const editBlock = getPersonalFinanceEditBlockError();
  if (editBlock) {
    throw new Error(editBlock.message);
  }

  const { validRows, accountsToCreate, categoriesToCreate, tagsToCreate } = analysis;

  if (validRows.length === 0) {
    return {
      importedTransactionsCount: 0,
      skippedDuplicateCount: 0,
      createdAccountsCount: 0,
      createdCategoriesCount: 0,
      createdTagsCount: 0,
    };
  }

  let createdAccountsCount = 0;
  let createdCategoriesCount = 0;
  let createdTagsCount = 0;
  let skippedDuplicateCount = 0;
  const txnsToAdd: Transaction[] = [];
  const balanceDeltas = new Map<string, number>();
  const touchedAccountIds = new Set<string>();

  await db.transaction(
    'rw',
    [db.accounts, db.categories, db.tags, db.transactions],
    async () => {
      const currentAccounts = await db.accounts.toArray();
      const accLookup = new Map<string, Account>(
        currentAccounts.map(a => [a.name.toLowerCase(), a]),
      );

      for (const name of accountsToCreate) {
        if (!accLookup.has(name.toLowerCase())) {
          let type: AccountType = 'bank';
          const lower = name.toLowerCase();
          if (lower.includes('cash') || lower.includes('wallet')) type = 'wallet';
          if (lower.includes('card') || lower.includes('credit')) type = 'card';
          if (lower.includes('saving')) type = 'savings';

          const newAcc: Account = {
            id: createId('acc'),
            name,
            type,
            balance: 0,
            currency: 'LKR',
            includeInTotal: true,
            updatedAt: Date.now(),
          };
          await db.accounts.add(newAcc);
          accLookup.set(name.toLowerCase(), newAcc);
          createdAccountsCount++;
        }
      }

      const currentCategories = await db.categories.toArray();
      const catLookup = new Map<string, Category>(
        currentCategories.map(c => [`${c.name.toLowerCase()}|${c.type}`, c]),
      );

      let colorIdx = 0;
      for (const item of categoriesToCreate) {
        const key = `${item.name.toLowerCase()}|${item.type}`;
        if (!catLookup.has(key)) {
          const color = DEFAULT_CATEGORY_COLORS[colorIdx % DEFAULT_CATEGORY_COLORS.length];
          colorIdx++;

          const newCat: Category = {
            id: createId('cat'),
            name: item.name,
            type: item.type,
            icon: item.type === 'income' ? 'briefcase' : 'tag',
            color,
            updatedAt: Date.now(),
          };
          await db.categories.add(newCat);
          catLookup.set(key, newCat);
          createdCategoriesCount++;
        }
      }

      const currentTags = await db.tags.toArray();
      const tagLookup = new Map<string, Tag>(
        currentTags.map(t => [t.name.toLowerCase(), t]),
      );

      for (const name of tagsToCreate) {
        if (!tagLookup.has(name.toLowerCase())) {
          const newTag: Tag = {
            id: createId('tag'),
            name,
            updatedAt: Date.now(),
          };
          await db.tags.add(newTag);
          tagLookup.set(name.toLowerCase(), newTag);
          createdTagsCount++;
        }
      }

      // Re-check fingerprints inside the transaction against current DB
      const existingTxns = await db.transactions.toArray();
      const nameById = new Map(
        [...accLookup.values()].map(a => [a.id, a.name] as const),
      );
      const existingFingerprints = new Set(
        existingTxns.map(t =>
          csvImportFingerprint({
            timestamp: t.date,
            type: t.type,
            amount: t.amount,
            accountName: nameById.get(t.accountId) || t.accountId,
            toAccountName: t.toAccountId
              ? nameById.get(t.toAccountId) || t.toAccountId
              : undefined,
            notes: t.notes,
          }),
        ),
      );

      const now = Date.now();

      for (const row of validRows) {
        if (existingFingerprints.has(row.fingerprint)) {
          skippedDuplicateCount++;
          continue;
        }

        const acc = accLookup.get(row.accountName.toLowerCase());
        if (!acc) {
          // Should not happen if analysis was consistent; skip rather than guess
          skippedDuplicateCount++;
          continue;
        }

        let toAccountId: string | undefined;
        if (row.type === 'transfer') {
          if (!row.toAccountName) continue;
          const toAcc = accLookup.get(row.toAccountName.toLowerCase());
          if (!toAcc) continue;
          toAccountId = toAcc.id;
        }

        const balanceTxn = {
          type: row.type,
          amount: row.amount,
          accountId: acc.id,
          toAccountId,
        };
        const validationError = validateAccountsForApply(balanceTxn);
        if (validationError) continue;

        let categoryId: string | undefined;
        if (row.categoryName && row.type !== 'transfer') {
          const catKey = `${row.categoryName.toLowerCase()}|${row.type === 'income' ? 'income' : 'expense'}`;
          categoryId = catLookup.get(catKey)?.id;
        }

        const tagIds = row.tagNames
          .map(tName => tagLookup.get(tName.toLowerCase())?.id)
          .filter((id): id is string => Boolean(id));

        const txn: Transaction = {
          id: createId('txn-imp'),
          type: row.type,
          amount: row.amount,
          date: row.timestamp,
          accountId: acc.id,
          toAccountId,
          categoryId,
          tagIds: tagIds.length > 0 ? tagIds : undefined,
          notes: row.notes,
          excludeFromBudget: row.type === 'expense' ? row.excludeFromBudget : undefined,
          updatedAt: now,
        };
        txnsToAdd.push(txn);
        existingFingerprints.add(row.fingerprint);

        if (options.adjustBalances) {
          for (const [accountId, delta] of computeApplyBalanceDeltas(balanceTxn)) {
            balanceDeltas.set(accountId, (balanceDeltas.get(accountId) || 0) + delta);
            touchedAccountIds.add(accountId);
          }
        }
      }

      if (txnsToAdd.length > 0) {
        await db.transactions.bulkAdd(txnsToAdd);
      }

      if (options.adjustBalances && balanceDeltas.size > 0) {
        await applyAccountBalanceDeltas(balanceDeltas, { now, requireAllAccounts: true });
      }
    },
  );

  const { triggerSync } = await import('../sync/syncEngine');
  txnsToAdd.forEach(t => triggerSync('transactions', t.id));
  if (options.adjustBalances) {
    touchedAccountIds.forEach(id => triggerSync('accounts', id));
  }
  // Newly created accounts should sync even when balances are not adjusted
  for (const name of accountsToCreate) {
    const acc = await db.accounts.filter(a => a.name.toLowerCase() === name.toLowerCase()).first();
    if (acc) triggerSync('accounts', acc.id);
  }

  return {
    importedTransactionsCount: txnsToAdd.length,
    skippedDuplicateCount,
    createdAccountsCount,
    createdCategoriesCount,
    createdTagsCount,
  };
}
