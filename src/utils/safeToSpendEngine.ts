import { db } from '../db/db';
import type {
  Account,
  CreditCard,
  CashOffsetSource,
  MoneyMarketAccount,
  RecurringTransaction,
  ReimbursementLedger,
  ReimbursementEntry,
} from '../db/db';
import { addDays, endOfDay } from 'date-fns';

export interface MmaAnnotation {
  mmaId: string;
  mmaName: string;
  balance: number;
  minimumBalance: number;
  currentRate: number;
  baseRate: number;
  message: string;
}

export interface UncoveredCardExposure {
  cardId: string;
  cardName: string;
  currentBalance: number;
  coveredAmount: number;
  uncoveredAmount: number;
}

export interface UpcomingRecurringItem {
  id: string;
  name: string;
  amount: number;
  dueDate: number;
}

export interface SafeToSpendBreakdown {
  safeToSpend: number;
  isNegative: boolean;

  // Component 1: Liquid Cash
  liquidCash: number;
  accountsCash: number;
  mmasCash: number;
  mmaAnnotations: MmaAnnotation[];

  // Component 2: Net Pending Card Bills
  rawCardBills: number;
  cardOffsets: number;
  cardLedgerOffsets: number;
  netPendingCardBills: number;
  uncoveredCards: UncoveredCardExposure[];

  // Component 3: Upcoming Recurring Charges
  upcomingRecurringTotal: number;
  forecastDays: number;
  upcomingRecurringItems: UpcomingRecurringItem[];

  // Component 4: Net Reimbursement Ledger Position
  netGeneralLedgersPosition: number;
  generalLedgerItems: { ledgerId: string; name: string; balance: number }[];
}

/**
 * Computes the forward-looking Safe-to-Spend cashflow forecast.
 */
export async function calculateSafeToSpend(
  forecastDays: number = 14
): Promise<SafeToSpendBreakdown> {
  const [
    accounts,
    mmas,
    cards,
    offsets,
    recurring,
    ledgers,
    entries,
  ] = await Promise.all([
    db.accounts.toArray(),
    db.moneyMarketAccounts.toArray(),
    db.creditCards.toArray(),
    db.cashOffsetSources.toArray(),
    db.recurringTransactions.toArray(),
    db.reimbursementLedgers.toArray(),
    db.reimbursementEntries.toArray(),
  ]);

  return computeSafeToSpendSync({
    accounts,
    mmas,
    cards,
    offsets,
    recurring,
    ledgers,
    entries,
    forecastDays,
  });
}

/**
 * Pure synchronous computation so components with live hooks can re-compute instantaneously.
 */
export function computeSafeToSpendSync({
  accounts,
  mmas,
  cards,
  offsets,
  recurring,
  ledgers,
  entries,
  forecastDays = 14,
}: {
  accounts: Account[];
  mmas: MoneyMarketAccount[];
  cards: CreditCard[];
  offsets: CashOffsetSource[];
  recurring: RecurringTransaction[];
  ledgers: ReimbursementLedger[];
  entries: ReimbursementEntry[];
  forecastDays?: number;
}): SafeToSpendBreakdown {
  // ── 1. Liquid Cash ──────────────────────────────────────────────────────────
  // Non-card accounts that are included in totals
  const nonCardAccounts = accounts.filter(
    (a) => a.type !== 'card' && a.includeInTotal !== false
  );
  const accountsCash = nonCardAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const mmasCash = mmas.reduce((sum, m) => sum + (m.balance || 0), 0);
  const liquidCash = accountsCash + mmasCash;

  // MMA Annotations (alert if near or below minimum preferential rate threshold)
  const mmaAnnotations: MmaAnnotation[] = [];
  for (const mma of mmas) {
    if (mma.minimumBalanceForRate > 0) {
      const isBelow = mma.balance < mma.minimumBalanceForRate;
      const isNear =
        !isBelow && mma.balance <= mma.minimumBalanceForRate * 1.15;

      if (isBelow || isNear) {
        mmaAnnotations.push({
          mmaId: mma.id,
          mmaName: mma.name,
          balance: mma.balance,
          minimumBalance: mma.minimumBalanceForRate,
          currentRate: mma.currentRatePercent,
          baseRate: mma.baseRatePercent,
          message: isBelow
            ? `Balance is below LKR ${mma.minimumBalanceForRate.toLocaleString()} minimum — earning base rate of ${mma.baseRatePercent}%.`
            : `Includes LKR ${mma.balance.toLocaleString()} from ${mma.name} — withdrawing below LKR ${mma.minimumBalanceForRate.toLocaleString()} drops it out of preferential rate (${mma.currentRatePercent}% → ${mma.baseRatePercent}%).`,
        });
      }
    }
  }

  // ── 2. Net Pending Card Bills ───────────────────────────────────────────────
  const rawCardBills = cards.reduce((sum, c) => sum + (c.currentBalance || 0), 0);

  // Group entries by ledgerId
  const entriesByLedger = new Map<string, ReimbursementEntry[]>();
  for (const entry of entries) {
    const list = entriesByLedger.get(entry.ledgerId) || [];
    list.push(entry);
    entriesByLedger.set(entry.ledgerId, list);
  }

  // Helper to get net owed to user for a ledger (positive = owed to user)
  const getLedgerOwedToUser = (ledgerId: string): number => {
    const lEntries = entriesByLedger.get(ledgerId) || [];
    return lEntries.reduce((sum, e) => sum + (e.amountOwed - e.amountPaid), 0);
  };

  // Card-related ledgers vs General ledgers
  const cardRelatedLedgers = ledgers.filter(
    (l) => l.isCardRelated === true || Boolean(l.linkedCardId)
  );
  const generalLedgers = ledgers.filter(
    (l) => !l.isCardRelated && !l.linkedCardId
  );

  // Card-related ledger offsets (only positive balances where counterparty owes user offset card bills)
  let cardLedgerOffsets = 0;
  for (const l of cardRelatedLedgers) {
    const owed = getLedgerOwedToUser(l.id);
    if (owed > 0) cardLedgerOffsets += owed;
  }

  const cardOffsets = offsets.reduce(
    (sum, o) => sum + (o.expectedMonthlyAmount || 0),
    0
  );

  const netPendingCardBills = Math.max(
    0,
    rawCardBills - cardOffsets - cardLedgerOffsets
  );

  // Per-card uncovered exposure
  const uncoveredCards: UncoveredCardExposure[] = [];
  for (const card of cards) {
    if (card.currentBalance > 0) {
      const cardDirectOffsets = offsets
        .filter((o) => o.linkedCardId === card.id)
        .reduce((sum, o) => sum + (o.expectedMonthlyAmount || 0), 0);

      const cardDirectLedgers = cardRelatedLedgers
        .filter((l) => l.linkedCardId === card.id)
        .reduce((sum, l) => {
          const owed = getLedgerOwedToUser(l.id);
          return sum + (owed > 0 ? owed : 0);
        }, 0);

      const covered = cardDirectOffsets + cardDirectLedgers;
      const uncovered = Math.max(0, card.currentBalance - covered);

      if (uncovered > 0) {
        uncoveredCards.push({
          cardId: card.id,
          cardName: card.name,
          currentBalance: card.currentBalance,
          coveredAmount: covered,
          uncoveredAmount: uncovered,
        });
      }
    }
  }

  // ── 3. Upcoming Recurring Charges ───────────────────────────────────────────
  const now = Date.now();
  const windowEnd = endOfDay(addDays(new Date(now), forecastDays)).getTime();

  const upcomingRecurringItems: UpcomingRecurringItem[] = [];
  let upcomingRecurringTotal = 0;

  for (const rec of recurring) {
    if (rec.active !== false && rec.type === 'expense') {
      if (rec.nextDueDate >= now && rec.nextDueDate <= windowEnd) {
        upcomingRecurringTotal += rec.amount;
        upcomingRecurringItems.push({
          id: rec.id,
          name: rec.name,
          amount: rec.amount,
          dueDate: rec.nextDueDate,
        });
      }
    }
  }

  upcomingRecurringItems.sort((a, b) => a.dueDate - b.dueDate);

  // ── 4. Net Reimbursement Ledger Position (General ledgers) ──────────────────
  const generalLedgerItems: { ledgerId: string; name: string; balance: number }[] = [];
  let netGeneralLedgersPosition = 0;

  for (const l of generalLedgers) {
    const bal = getLedgerOwedToUser(l.id);
    netGeneralLedgersPosition += bal;
    generalLedgerItems.push({
      ledgerId: l.id,
      name: l.counterpartyName,
      balance: bal,
    });
  }

  // ── Final Formula ───────────────────────────────────────────────────────────
  const safeToSpend =
    liquidCash -
    netPendingCardBills -
    upcomingRecurringTotal +
    netGeneralLedgersPosition;

  return {
    safeToSpend,
    isNegative: safeToSpend < 0,
    liquidCash,
    accountsCash,
    mmasCash,
    mmaAnnotations,
    rawCardBills,
    cardOffsets,
    cardLedgerOffsets,
    netPendingCardBills,
    uncoveredCards,
    upcomingRecurringTotal,
    forecastDays,
    upcomingRecurringItems,
    netGeneralLedgersPosition,
    generalLedgerItems,
  };
}

