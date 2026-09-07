import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { usePrivacyStore } from '../store/privacyStore';
import { useUIStore } from '../store/uiStore';
import { computeQuickCandidates, type QuickCandidate } from '../utils/quickLogEngine';
import { triggerSync } from '../sync/syncEngine';
import MaskedAmount from './MaskedAmount';
import { AlertCircle, Pin, Sparkles } from 'lucide-react';

interface QuickAddChipsProps {
  condensed?: boolean;
  onSelectCandidate?: (candidate: QuickCandidate) => void;
  className?: string;
}

export default function QuickAddChips({
  condensed = false,
  onSelectCandidate,
  className = '',
}: QuickAddChipsProps) {
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];

  const {
    oneTapLogMode,
    pinnedQuickNotes,
    hiddenQuickNotes,
  } = usePrivacyStore();

  const {
    setAddTransactionModalOpen,
    setPrefillData,
    showUndoToast,
  } = useUIStore();

  // Compute top candidates
  const candidates = useMemo(() => {
    return computeQuickCandidates({
      transactions,
      accounts,
      categories,
      pinnedNotes: pinnedQuickNotes,
      hiddenNotes: hiddenQuickNotes,
      limit: condensed ? 4 : 8,
    });
  }, [transactions, accounts, categories, pinnedQuickNotes, hiddenQuickNotes, condensed]);

  if (candidates.length === 0) return null;

  const handleChipClick = async (candidate: QuickCandidate) => {
    // If parent supplied custom handler (e.g. inside TransactionModal in pre-fill mode)
    if (onSelectCandidate) {
      onSelectCandidate(candidate);
      return;
    }

    // If account is missing/deleted, we MUST open the form to pick an account
    if (candidate.accountMissing || !oneTapLogMode) {
      setPrefillData({
        notes: candidate.canonicalNote,
        amount: candidate.amount,
        categoryId: candidate.categoryId,
        accountId: candidate.accountMissing ? undefined : candidate.accountId,
        type: candidate.type,
        tagIds: candidate.tagIds,
      });
      setAddTransactionModalOpen(true);
      return;
    }

    // 1-Tap Instant Log Mode
    try {
      const id = `txn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const now = Date.now();

      await db.transactions.add({
        id,
        amount: candidate.amount,
        type: candidate.type,
        categoryId: candidate.categoryId,
        accountId: candidate.accountId!,
        date: now,
        notes: candidate.canonicalNote,
        tagIds: candidate.tagIds,
        updatedAt: now,
      });

      // Update account balance
      const acc = await db.accounts.get(candidate.accountId!);
      if (acc) {
        const delta = candidate.type === 'expense' ? -candidate.amount : candidate.amount;
        await db.accounts.update(acc.id, {
          balance: acc.balance + delta,
          updatedAt: now,
        });
      }

      triggerSync();

      // Launch Global Undo Toast
      showUndoToast({
        id: `undo-${id}`,
        message: `Logged "${candidate.canonicalNote}" · LKR ${candidate.amount.toLocaleString()} (${candidate.accountName || 'Account'})`,
        transactionId: id,
        accountId: candidate.accountId!,
        amount: candidate.amount,
        type: candidate.type,
        createdAt: now,
        durationMs: 6000,
      });
    } catch (err) {
      console.error('Error in 1-tap log:', err);
    }
  };

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground px-0.5">
        <span className="flex items-center gap-1">
          <Sparkles size={12} className="text-accent" />
          <span>{condensed ? 'Quick-Log' : 'Frequent Habits'}</span>
        </span>
        <span className="text-[10px] text-muted-foreground/80">
          {oneTapLogMode ? '1-Tap Log' : 'Tap to fill'}
        </span>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar -mx-1 px-1">
        {candidates.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => handleChipClick(c)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all active:scale-95 shadow-2xs ${
              c.accountMissing
                ? 'bg-amber-500/10 border-amber-500/30 text-foreground hover:bg-amber-500/20'
                : 'bg-card border-border hover:bg-muted/80 text-foreground'
            }`}
            title={
              c.accountMissing
                ? `Account previously used was deleted. Tap to pick an account for "${c.canonicalNote}"`
                : `${oneTapLogMode ? 'Instant log' : 'Fill'} "${c.canonicalNote}" with LKR ${c.amount.toLocaleString()} from ${c.accountName || 'Account'}`
            }
          >
            {c.isPinned && <Pin size={10} className="text-accent -ml-0.5" />}

            {/* Category dot if available */}
            {c.categoryColor && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: c.categoryColor }}
              />
            )}

            <span className="font-semibold">{c.canonicalNote}</span>

            <span className="text-muted-foreground">
              LKR <MaskedAmount amount={c.amount} />
            </span>

            {/* Account warning badge if deleted */}
            {c.accountMissing ? (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-500 bg-amber-500/15 px-1.5 py-0.5 rounded-md ml-0.5">
                <AlertCircle size={10} />
                <span>Pick Acc</span>
              </span>
            ) : (
              c.accountName && (
                <span className="text-[10px] text-muted-foreground/70 hidden sm:inline">
                  · {c.accountName}
                </span>
              )
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
