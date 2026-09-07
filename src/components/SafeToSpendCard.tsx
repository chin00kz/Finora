import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { computeSafeToSpendSync } from '../utils/safeToSpendEngine';
import { usePrivacyStore } from '../store/privacyStore';
import MaskedAmount from './MaskedAmount';
import {
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  AlertTriangle,
  Wallet,
  CreditCard,
  Repeat,
  BookOpen,
  Info,
  Calendar,
  X,
} from 'lucide-react';
import { format } from 'date-fns';

export default function SafeToSpendCard() {
  const {
    safeToSpendForecastDays,
    setSafeToSpendForecastDays,
    setShowSafeToSpendHome,
  } = usePrivacyStore();

  const [isExpanded, setIsExpanded] = useState(false);

  // Live queries
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const mmas = useLiveQuery(() => db.moneyMarketAccounts.toArray()) || [];
  const cards = useLiveQuery(() => db.creditCards.toArray()) || [];
  const offsets = useLiveQuery(() => db.cashOffsetSources.toArray()) || [];
  const recurring = useLiveQuery(() => db.recurringTransactions.toArray()) || [];
  const ledgers = useLiveQuery(() => db.reimbursementLedgers.toArray()) || [];
  const entries = useLiveQuery(() => db.reimbursementEntries.toArray()) || [];

  const breakdown = useMemo(() => {
    return computeSafeToSpendSync({
      accounts,
      mmas,
      cards,
      offsets,
      recurring,
      ledgers,
      entries,
      forecastDays: safeToSpendForecastDays,
    });
  }, [
    accounts,
    mmas,
    cards,
    offsets,
    recurring,
    ledgers,
    entries,
    safeToSpendForecastDays,
  ]);

  return (
    <div
      className={`rounded-2xl border transition-all duration-300 shadow-sm mb-6 overflow-hidden ${
        breakdown.isNegative
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-card border-border'
      }`}
    >
      {/* Header bar */}
      <div className="p-4 sm:p-5 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              {breakdown.isNegative ? (
                <AlertTriangle size={14} className="text-amber-500 shrink-0" />
              ) : (
                <ShieldCheck size={14} className="text-emerald-500 shrink-0" />
              )}
              Safe-to-Spend
            </span>

            {/* Forecast Window Toggle (7d / 14d / 30d) */}
            <div className="inline-flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg text-[10px] font-medium ml-1">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSafeToSpendForecastDays(d);
                  }}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    safeToSpendForecastDays === d
                      ? 'bg-foreground text-background font-semibold shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {/* Headline Amount */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground font-medium">LKR</span>
            <span
              className={`text-3xl sm:text-4xl font-light tracking-tight ${
                breakdown.isNegative
                  ? 'text-amber-500 font-normal'
                  : 'text-foreground'
              }`}
            >
              <MaskedAmount amount={breakdown.safeToSpend} />
            </span>
          </div>

          <p className="text-xs text-muted-foreground mt-1">
            {breakdown.isNegative ? (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                Upcoming bills exceed liquid funds by LKR{' '}
                <MaskedAmount amount={Math.abs(breakdown.safeToSpend)} />
              </span>
            ) : (
              `Discretionary cash after next ${safeToSpendForecastDays} days of bills & obligations`
            )}
          </p>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setIsExpanded((v) => !v)}
            className="p-2 rounded-xl bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 text-xs font-medium"
            title="Toggle breakdown"
          >
            <span className="hidden sm:inline">Breakdown</span>
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={() => setShowSafeToSpendHome(false)}
            className="p-2 text-muted-foreground hover:text-foreground rounded-xl"
            title="Hide from Home"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Uncovered Card Warning Banner */}
      {breakdown.uncoveredCards.length > 0 && (
        <div className="px-4 sm:px-5 py-2.5 bg-amber-500/15 border-t border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle size={13} className="shrink-0" />
            <span>Uncovered Card Balance Alert:</span>
          </p>
          {breakdown.uncoveredCards.map((c) => (
            <p key={c.cardId} className="pl-5 text-[11px] opacity-90">
              <span className="font-medium text-foreground">{c.cardName}</span>: LKR{' '}
              <MaskedAmount amount={c.uncoveredAmount} /> must be covered from personal cash (not offset by third parties).
            </p>
          ))}
        </div>
      )}

      {/* MMA Annotations */}
      {breakdown.mmaAnnotations.length > 0 && (
        <div className="px-4 sm:px-5 py-2.5 bg-blue-500/10 border-t border-blue-500/20 text-[11px] text-blue-600 dark:text-blue-300 space-y-1">
          {breakdown.mmaAnnotations.map((m) => (
            <div key={m.mmaId} className="flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-0.5" />
              <p>{m.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Expandable Breakdown Accordion */}
      {isExpanded && (
        <div className="border-t border-border p-4 sm:p-5 space-y-4 bg-muted/20 animate-in slide-in-from-top-2 fade-in duration-200">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Calculation Breakdown
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Component 1: Liquid Cash */}
            <div className="p-3 bg-card border border-border rounded-xl space-y-1">
              <div className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Wallet size={14} className="text-emerald-500" />
                  Liquid Cash
                </span>
                <span className="font-semibold text-emerald-500">
                  +LKR <MaskedAmount amount={breakdown.liquidCash} />
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                Checking/Savings (LKR <MaskedAmount amount={breakdown.accountsCash} />) + MMAs (LKR <MaskedAmount amount={breakdown.mmasCash} />)
              </p>
            </div>

            {/* Component 2: Net Pending Card Bills */}
            <div className="p-3 bg-card border border-border rounded-xl space-y-1">
              <div className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CreditCard size={14} className="text-amber-500" />
                  Net Card Bills
                </span>
                <span className="font-semibold text-amber-500">
                  −LKR <MaskedAmount amount={breakdown.netPendingCardBills} />
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                Bills LKR <MaskedAmount amount={breakdown.rawCardBills} /> − Offsets LKR{' '}
                <MaskedAmount amount={breakdown.cardOffsets + breakdown.cardLedgerOffsets} />
              </p>
            </div>

            {/* Component 3: Upcoming Recurring */}
            <div className="p-3 bg-card border border-border rounded-xl space-y-1">
              <div className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Repeat size={14} className="text-rose-500" />
                  Upcoming Recurring ({safeToSpendForecastDays}d)
                </span>
                <span className="font-semibold text-rose-500">
                  −LKR <MaskedAmount amount={breakdown.upcomingRecurringTotal} />
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                {breakdown.upcomingRecurringItems.length} active bill{breakdown.upcomingRecurringItems.length !== 1 ? 's' : ''} in window
              </p>
            </div>

            {/* Component 4: Net General Ledgers */}
            <div className="p-3 bg-card border border-border rounded-xl space-y-1">
              <div className="flex items-center justify-between font-medium">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <BookOpen size={14} className="text-blue-500" />
                  Net Reimbursements
                </span>
                <span
                  className={`font-semibold ${
                    breakdown.netGeneralLedgersPosition >= 0
                      ? 'text-emerald-500'
                      : 'text-amber-500'
                  }`}
                >
                  {breakdown.netGeneralLedgersPosition >= 0 ? '+' : '−'}LKR{' '}
                  <MaskedAmount amount={Math.abs(breakdown.netGeneralLedgersPosition)} />
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground pl-5">
                {breakdown.generalLedgerItems.length} general counterparty ledger{breakdown.generalLedgerItems.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Detailed upcoming recurring items list */}
          {breakdown.upcomingRecurringItems.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <Calendar size={12} />
                Upcoming Charges in Next {safeToSpendForecastDays} Days
              </p>
              <div className="divide-y divide-border/60 bg-card rounded-xl border border-border overflow-hidden">
                {breakdown.upcomingRecurringItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 px-3 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-medium text-foreground">{item.name}</span>
                      <span className="text-muted-foreground text-[11px] ml-2">
                        Due {format(new Date(item.dueDate), 'MMM dd')}
                      </span>
                    </div>
                    <span className="font-mono font-medium text-foreground">
                      LKR <MaskedAmount amount={item.amount} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
