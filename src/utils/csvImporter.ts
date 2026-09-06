import { db } from '../db/db';
import type { Transaction, Account, Category, Tag, TransactionType, AccountType } from '../db/db';
import { triggerSync } from '../sync/syncEngine';

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
        // Escaped quote
        currentField += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        // Closing quote
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
        // Handle CRLF
        if (nextChar === '\n') {
          i++;
        }
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

  // Final field & row
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
  tagNames: string[];
  notes?: string;
  excludeFromBudget: boolean;
}

export interface CSVAnalysis {
  validRows: ParsedCSVRow[];
  totalRows: number;
  invalidRowsCount: number;
  accountsToCreate: string[];
  categoriesToCreate: { name: string; type: 'income' | 'expense' }[];
  tagsToCreate: string[];
  totalExpenseAmount: number;
  totalIncomeAmount: number;
}

/**
 * Flexible date parser for various standard formats.
 */
function parseDateWithTime(dateStr: string, timeStr?: string): number {
  const cleanDate = dateStr.trim();
  let year = new Date().getFullYear();
  let month = 0; // 0-indexed
  let day = 1;
  let hours = 12;
  let minutes = 0;

  // Check ISO format YYYY-MM-DD
  const isoMatch = cleanDate.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10) - 1;
    day = parseInt(isoMatch[3], 10);
  } else {
    // Check MM/DD/YYYY or DD/MM/YYYY
    const slashMatch = cleanDate.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (slashMatch) {
      const p1 = parseInt(slashMatch[1], 10);
      const p2 = parseInt(slashMatch[2], 10);
      let p3 = parseInt(slashMatch[3], 10);
      if (p3 < 100) p3 += 2000;

      // Assume MM/DD/YYYY if p1 <= 12, unless p1 > 12 which must be DD/MM/YYYY
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

  // Parse Time string if available (e.g. "3:45 PM", "15:45", "03:45:00")
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

  const result = new Date(year, month, day, hours, minutes, 0, 0);
  return result.getTime();
}

/**
 * Normalizes an amount string by stripping currencies, commas, and negative signs.
 */
function parseAmount(raw: string): { amount: number; isNegative: boolean } {
  const clean = raw.replace(/[^0-9.-]/g, '').trim();
  const num = parseFloat(clean);
  if (isNaN(num)) return { amount: 0, isNegative: false };
  return {
    amount: Math.abs(num),
    isNegative: num < 0 || raw.includes('-'),
  };
}

/**
 * Analyzes CSV content and returns preview metrics.
 */
export async function analyzeCSV(csvText: string): Promise<CSVAnalysis> {
  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    throw new Error('The CSV file does not contain enough data (missing headers or rows).');
  }

  // Normalize headers
  const headerRow = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  
  const findCol = (candidates: string[]) => {
    return headerRow.findIndex(h => candidates.some(c => h.includes(c)));
  };

  const dateCol = findCol(['date', 'time', 'timestamp']);
  const timeCol = findCol(['time', 'hour']);
  const typeCol = findCol(['type', 'transactiontype', 'txntype']);
  const amountCol = findCol(['amount', 'lkr', 'total', 'value', 'price']);
  const catCol = findCol(['category', 'cat']);
  const accCol = findCol(['account', 'acc', 'wallet', 'bank']);
  const tagsCol = findCol(['tags', 'tag', 'label']);
  const notesCol = findCol(['notes', 'note', 'description', 'desc', 'memo', 'title']);
  const outBudgetCol = findCol(['outofbudget', 'excludefrombudget', 'budgetexclude']);

  if (dateCol === -1 || amountCol === -1) {
    throw new Error('Could not identify required "Date" and "Amount" columns in the CSV headers.');
  }

  const existingAccounts = await db.accounts.toArray();
  const existingCategories = await db.categories.toArray();
  const existingTags = await db.tags.toArray();

  const accountNameMap = new Map(existingAccounts.map(a => [a.name.toLowerCase(), a]));
  const catNameMap = new Map(existingCategories.map(c => [`${c.name.toLowerCase()}|${c.type}`, c]));
  const tagNameMap = new Map(existingTags.map(t => [t.name.toLowerCase(), t]));

  const validRows: ParsedCSVRow[] = [];
  let invalidRowsCount = 0;
  let totalExpense = 0;
  let totalIncome = 0;

  const accountsToCreateSet = new Set<string>();
  const categoriesToCreateSet = new Map<string, 'income' | 'expense'>();
  const tagsToCreateSet = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const dateRaw = r[dateCol];
    const amountRaw = r[amountCol];

    if (!dateRaw || !amountRaw) {
      invalidRowsCount++;
      continue;
    }

    const { amount, isNegative } = parseAmount(amountRaw);
    if (amount <= 0) {
      invalidRowsCount++;
      continue;
    }

    const timeRaw = timeCol !== -1 && timeCol !== dateCol ? r[timeCol] : undefined;
    const timestamp = parseDateWithTime(dateRaw, timeRaw);

    // Determine type
    let type: TransactionType = 'expense';
    if (typeCol !== -1 && r[typeCol]) {
      const tVal = r[typeCol].toLowerCase();
      if (tVal.includes('income') || tVal.includes('deposit') || tVal.includes('credit')) {
        type = 'income';
      } else if (tVal.includes('transfer')) {
        type = 'transfer';
      } else {
        type = 'expense';
      }
    } else {
      // Inferred from sign if available
      type = isNegative ? 'expense' : 'income';
    }

    // Account
    const accRaw = accCol !== -1 && r[accCol] ? r[accCol].trim() : 'Wallet';
    const accountName = accRaw || 'Wallet';
    if (!accountNameMap.has(accountName.toLowerCase())) {
      accountsToCreateSet.add(accountName);
    }

    // Category
    const catRaw = catCol !== -1 && r[catCol] ? r[catCol].trim() : undefined;
    let categoryName: string | undefined = undefined;
    if (catRaw && catRaw.toLowerCase() !== 'none' && catRaw.toLowerCase() !== 'uncategorized') {
      categoryName = catRaw;
      const catKey = `${categoryName.toLowerCase()}|${type === 'income' ? 'income' : 'expense'}`;
      if (!catNameMap.has(catKey)) {
        categoriesToCreateSet.set(categoryName, type === 'income' ? 'income' : 'expense');
      }
    }

    // Tags
    const tagsRaw = tagsCol !== -1 && r[tagsCol] ? r[tagsCol].trim() : '';
    const tagNames = tagsRaw
      ? tagsRaw
          .split(/[;,]/)
          .map(t => t.trim())
          .filter(Boolean)
      : [];

    tagNames.forEach(t => {
      if (!tagNameMap.has(t.toLowerCase())) {
        tagsToCreateSet.add(t);
      }
    });

    // Notes
    const notes = notesCol !== -1 && r[notesCol] ? r[notesCol].trim() : undefined;

    // Out of Budget
    let excludeFromBudget = false;
    if (outBudgetCol !== -1 && r[outBudgetCol]) {
      const obVal = r[outBudgetCol].toLowerCase();
      excludeFromBudget = obVal === 'yes' || obVal === 'true' || obVal === '1';
    }

    if (type === 'expense') totalExpense += amount;
    if (type === 'income') totalIncome += amount;

    validRows.push({
      dateStr: dateRaw,
      timeStr: timeRaw,
      timestamp,
      type,
      amount,
      categoryName,
      accountName,
      tagNames,
      notes,
      excludeFromBudget,
    });
  }

  return {
    validRows,
    totalRows: rows.length - 1,
    invalidRowsCount,
    accountsToCreate: Array.from(accountsToCreateSet),
    categoriesToCreate: Array.from(categoriesToCreateSet.entries()).map(([name, type]) => ({
      name,
      type,
    })),
    tagsToCreate: Array.from(tagsToCreateSet),
    totalExpenseAmount: totalExpense,
    totalIncomeAmount: totalIncome,
  };
}

const DEFAULT_CATEGORY_COLORS = [
  '#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#14b8a6', '#6366f1', '#84cc16'
];

/**
 * Executes the import into IndexedDB.
 */
export async function executeImport(
  analysis: CSVAnalysis,
  options: { adjustBalances: boolean } = { adjustBalances: true }
): Promise<{
  importedTransactionsCount: number;
  createdAccountsCount: number;
  createdCategoriesCount: number;
  createdTagsCount: number;
}> {
  const { validRows, accountsToCreate, categoriesToCreate, tagsToCreate } = analysis;

  if (validRows.length === 0) {
    return {
      importedTransactionsCount: 0,
      createdAccountsCount: 0,
      createdCategoriesCount: 0,
      createdTagsCount: 0,
    };
  }

  let createdAccountsCount = 0;
  let createdCategoriesCount = 0;
  let createdTagsCount = 0;

  await db.transaction(
    'rw',
    [db.accounts, db.categories, db.tags, db.transactions],
    async () => {
      // 1. Create missing Accounts
      const currentAccounts = await db.accounts.toArray();
      const accLookup = new Map<string, Account>(
        currentAccounts.map(a => [a.name.toLowerCase(), a])
      );

      for (const name of accountsToCreate) {
        if (!accLookup.has(name.toLowerCase())) {
          const rand = Math.random().toString(36).substring(2, 7);
          let type: AccountType = 'bank';
          const lower = name.toLowerCase();
          if (lower.includes('cash') || lower.includes('wallet')) type = 'wallet';
          if (lower.includes('card') || lower.includes('credit')) type = 'card';
          if (lower.includes('saving')) type = 'savings';

          const newAcc: Account = {
            id: `acc-${Date.now()}-${rand}`,
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

      // 2. Create missing Categories
      const currentCategories = await db.categories.toArray();
      const catLookup = new Map<string, Category>(
        currentCategories.map(c => [`${c.name.toLowerCase()}|${c.type}`, c])
      );

      let colorIdx = 0;
      for (const item of categoriesToCreate) {
        const key = `${item.name.toLowerCase()}|${item.type}`;
        if (!catLookup.has(key)) {
          const rand = Math.random().toString(36).substring(2, 7);
          const color = DEFAULT_CATEGORY_COLORS[colorIdx % DEFAULT_CATEGORY_COLORS.length];
          colorIdx++;

          const newCat: Category = {
            id: `cat-${Date.now()}-${rand}`,
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

      // 3. Create missing Tags
      const currentTags = await db.tags.toArray();
      const tagLookup = new Map<string, Tag>(
        currentTags.map(t => [t.name.toLowerCase(), t])
      );

      for (const name of tagsToCreate) {
        if (!tagLookup.has(name.toLowerCase())) {
          const rand = Math.random().toString(36).substring(2, 7);
          const newTag: Tag = {
            id: `tag-${Date.now()}-${rand}`,
            name,
            updatedAt: Date.now(),
          };
          await db.tags.add(newTag);
          tagLookup.set(name.toLowerCase(), newTag);
          createdTagsCount++;
        }
      }

      // 4. Create Transactions & Calculate Account Delta
      const accountDeltas = new Map<string, number>();
      const txnsToAdd: Transaction[] = [];

      for (const row of validRows) {
        const acc = accLookup.get(row.accountName.toLowerCase());
        const accountId = acc?.id || currentAccounts[0]?.id || 'acc-default';

        let categoryId: string | undefined = undefined;
        if (row.categoryName) {
          const catKey = `${row.categoryName.toLowerCase()}|${row.type === 'income' ? 'income' : 'expense'}`;
          categoryId = catLookup.get(catKey)?.id;
        }

        const tagIds = row.tagNames
          .map(tName => tagLookup.get(tName.toLowerCase())?.id)
          .filter((id): id is string => Boolean(id));

        const rand = Math.random().toString(36).substring(2, 7);
        const txn: Transaction = {
          id: `txn-imp-${Date.now()}-${rand}`,
          type: row.type,
          amount: row.amount,
          date: row.timestamp,
          accountId,
          categoryId,
          tagIds: tagIds.length > 0 ? tagIds : undefined,
          notes: row.notes,
          excludeFromBudget: row.excludeFromBudget,
          updatedAt: Date.now(),
        };
        txnsToAdd.push(txn);

        if (options.adjustBalances) {
          const curDelta = accountDeltas.get(accountId) || 0;
          const factor = row.type === 'expense' ? -row.amount : row.type === 'income' ? row.amount : 0;
          accountDeltas.set(accountId, curDelta + factor);
        }
      }

      await db.transactions.bulkAdd(txnsToAdd);

      // 5. Update balances if requested
      if (options.adjustBalances) {
        for (const [accId, delta] of accountDeltas.entries()) {
          const acc = await db.accounts.get(accId);
          if (acc) {
            await db.accounts.update(accId, {
              balance: acc.balance + delta,
              updatedAt: Date.now(),
            });
          }
        }
      }
    }
  );

  // Trigger background sync to backup imported data to Supabase
  triggerSync();

  return {
    importedTransactionsCount: validRows.length,
    createdAccountsCount,
    createdCategoriesCount,
    createdTagsCount,
  };
}
