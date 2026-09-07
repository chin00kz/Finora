import { subDays } from 'date-fns';
import type { Transaction, Account, Category } from '../db/db';

export type TimeBucket = 'morning' | 'midday' | 'evening' | 'night';

export interface QuickCandidate {
  key: string;
  canonicalNote: string;
  amount: number;
  type: 'expense' | 'income';
  categoryId?: string;
  categoryName?: string;
  categoryColor?: string;
  accountId?: string;
  accountName?: string;
  accountMissing: boolean;
  tagIds?: string[];
  frequency: number;
  bucketFrequency: number;
  score: number;
  isPinned: boolean;
  lastDate: number;
}

/**
 * Categorizes a date into 4 distinct daily time-of-day buckets.
 */
export function getTimeBucket(date: Date = new Date()): TimeBucket {
  const hours = date.getHours();
  if (hours >= 5 && hours < 11) return 'morning';
  if (hours >= 11 && hours < 16) return 'midday';
  if (hours >= 16 && hours < 21) return 'evening';
  return 'night';
}

interface ComputeQuickCandidatesOptions {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  pinnedNotes?: string[];
  hiddenNotes?: string[];
  windowDays?: number;
  currentDate?: Date;
  limit?: number;
}

/**
 * Computes the top habitual transactions based on recent frequency,
 * with light time-of-day contextual reordering and account validity checks.
 */
export function computeQuickCandidates(
  options: ComputeQuickCandidatesOptions
): QuickCandidate[] {
  const {
    transactions,
    accounts,
    categories,
    pinnedNotes = [],
    hiddenNotes = [],
    windowDays = 45,
    currentDate = new Date(),
    limit = 8,
  } = options;

  const currentBucket = getTimeBucket(currentDate);
  const cutoffTime = subDays(currentDate, windowDays).getTime();
  const pinnedSet = new Set(pinnedNotes.map((n) => n.trim().toLowerCase()));
  const hiddenSet = new Set(hiddenNotes.map((n) => n.trim().toLowerCase()));

  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Map of canonical key -> aggregated stats and txns
  const groups = new Map<
    string,
    {
      key: string;
      txns: Transaction[];
      mostRecentTxn: Transaction;
    }
  >();

  // Filter and group transactions
  for (const t of transactions) {
    const rawNote = t.notes?.trim();
    if (!rawNote) continue;

    // Skip transfers or debt settlements from regular habitual quick-chips
    if (t.type === 'transfer' || (t.type as string) === 'debt_settlement') {
      continue;
    }

    const key = rawNote.toLowerCase();

    // Skip user-hidden items
    if (hiddenSet.has(key)) continue;

    // Check window cutoff unless explicitly pinned
    const isPinned = pinnedSet.has(key);
    if (!isPinned && t.date < cutoffTime) continue;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        txns: [],
        mostRecentTxn: t,
      };
      groups.set(key, group);
    } else if (t.date > group.mostRecentTxn.date) {
      group.mostRecentTxn = t;
    }

    group.txns.push(t);
  }

  const candidates: QuickCandidate[] = [];

  for (const [key, group] of groups.entries()) {
    const isPinned = pinnedSet.has(key);
    const count = group.txns.length;
    const latest = group.mostRecentTxn;

    // Count how many occurrences occurred in the current time-of-day bucket
    let bucketCount = 0;
    for (const t of group.txns) {
      if (getTimeBucket(new Date(t.date)) === currentBucket) {
        bucketCount++;
      }
    }

    const bucketRatio = count > 0 ? bucketCount / count : 0;
    // Base frequency + soft time-of-day contextual bonus (up to +35% boost for high match in current bucket)
    const baseScore = isPinned ? 1000 + count : count;
    const score = baseScore * (1.0 + 0.35 * bucketRatio);

    const acc = latest.accountId ? accountMap.get(latest.accountId) : undefined;
    const cat = latest.categoryId ? categoryMap.get(latest.categoryId) : undefined;

    candidates.push({
      key,
      canonicalNote: latest.notes?.trim() || key,
      amount: latest.amount,
      type: latest.type === 'income' ? 'income' : 'expense',
      categoryId: latest.categoryId,
      categoryName: cat?.name,
      categoryColor: cat?.color,
      accountId: latest.accountId,
      accountName: acc?.name,
      accountMissing: !acc,
      tagIds: latest.tagIds,
      frequency: count,
      bucketFrequency: bucketCount,
      score,
      isPinned,
      lastDate: latest.date,
    });
  }

  // Sort by score descending, then by recency
  candidates.sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    if (Math.abs(b.score - a.score) > 0.05) {
      return b.score - a.score;
    }
    return b.lastDate - a.lastDate;
  });

  return candidates.slice(0, limit);
}
