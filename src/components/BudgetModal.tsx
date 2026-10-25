import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useUIStore } from '../store/uiStore';
import { triggerSync } from '../sync/syncEngine';
import { createId } from '../utils/createId';
import {
  budgetsWithActivesClippedForCreate,
  canContinueBudget,
  computeContinuationCarryForward,
  continuationBudgetId,
  defaultContinuationDateStrings,
  describeBudgetOverlapConflict,
  findOverlappingBudget,
  formatLocalDateInput,
  isCreateHandoffContext,
  isSameDayCreateHandoffEnded,
  parseBudgetDateBounds,
  patchForCreateHandoffEnded,
  patchForReplacingBudget,
  resolveBudgetEditBounds,
  resolveContinuationBounds,
  resolveCreatePeriodBounds,
  resolveOverlapRecoveryClick,
  validateBudgetAmount,
  type BudgetOverlapCheckMode,
  type BudgetOverlapConflictDetails,
  type ContinuationCarryForward,
} from '../utils/budgetLifecycle';
import { sumBudgetSpending } from '../utils/spendingAmount';
import { formatMoney } from '../utils/formatters';

export default function BudgetModal() {
  const { isBudgetModalOpen, budgetModalIntent, setBudgetModalOpen } = useUIStore();
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) || [];
  const transactions = useLiveQuery(() => db.transactions.toArray(), []) || [];

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [startDateStr, setStartDateStr] = useState('');
  const [endDateStr, setEndDateStr] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [overlapRecovery, setOverlapRecovery] = useState<BudgetOverlapConflictDetails | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [carryPreview, setCarryPreview] = useState<ContinuationCarryForward | null>(null);

  const mode = budgetModalIntent.mode;
  const targetId =
    budgetModalIntent.mode === 'edit' || budgetModalIntent.mode === 'continue'
      ? budgetModalIntent.budgetId
      : null;
  const targetBudget = targetId ? budgets.find(b => b.id === targetId) : undefined;

  const liveCarry = useMemo(() => {
    if (mode !== 'continue' || !targetBudget) return null;
    const priorSpent = sumBudgetSpending(transactions, {
      startDate: targetBudget.startDate,
      endDate: targetBudget.endDate,
    });
    return computeContinuationCarryForward(targetBudget.amount, priorSpent);
  }, [mode, targetBudget, transactions]);

  useEffect(() => {
    if (!isBudgetModalOpen) return;

    setFormError(null);
    setOverlapRecovery(null);
    setIsSubmitting(false);

    if (mode === 'edit' && targetBudget) {
      setCarryPreview(null);
      setName(targetBudget.name);
      setAmount(String(targetBudget.amount));
      setStartDateStr(formatLocalDateInput(new Date(targetBudget.startDate)));
      setEndDateStr(formatLocalDateInput(new Date(targetBudget.endDate)));
      return;
    }

    if (mode === 'continue' && targetBudget && liveCarry) {
      const dates = defaultContinuationDateStrings(targetBudget);
      setName(targetBudget.name);
      setCarryPreview(liveCarry);
      // Opening available for the new period = unused remainder (not the old limit).
      setAmount(liveCarry.carriedForward > 0 ? String(liveCarry.carriedForward) : '');
      setStartDateStr(dates.startDateStr);
      setEndDateStr(dates.endDateStr);
      return;
    }

    setCarryPreview(null);
    const today = new Date();
    setStartDateStr(formatLocalDateInput(today));
    const defaultEnd = new Date();
    defaultEnd.setDate(defaultEnd.getDate() + 30);
    setEndDateStr(formatLocalDateInput(defaultEnd));
    setName('');
    setAmount('');
  }, [isBudgetModalOpen, mode, targetBudget?.id, targetBudget?.updatedAt, liveCarry?.carriedForward, liveCarry?.priorSpent]);

  const datesEditable = mode === 'create' || mode === 'continue' ||
    (mode === 'edit' && targetBudget?.status === 'active');
  const amountEditable = mode === 'create' || mode === 'continue' ||
    (mode === 'edit' && (targetBudget?.status === 'active' || targetBudget?.status === 'ended'));

  const title =
    mode === 'edit' ? 'Edit Budget' :
    mode === 'continue' ? 'Continue Budget' :
    'New Budget Period';

  const submitLabel =
    mode === 'edit' ? (isSubmitting ? 'Saving…' : 'Save Changes') :
    mode === 'continue' ? (isSubmitting ? 'Starting…' : 'Start Continued Budget') :
    (isSubmitting ? 'Starting…' : 'Start Budget');

  const overlapCheckMode = (): BudgetOverlapCheckMode =>
    mode === 'create' ? 'create' : 'plain';

  const showOverlapConflict = (conflict?: { name: string; endDate: number }) => {
    const details = describeBudgetOverlapConflict({
      minStartDateStr: startDateStr,
      endDateStr,
      budgets,
      checkMode: overlapCheckMode(),
      excludeId: mode === 'edit' ? targetBudget?.id : undefined,
      conflict,
    });
    setFormError(details.message);
    // Button only when a verified start exists; never invent dates on submit.
    setOverlapRecovery(details.earliestStartDateStr ? details : null);
  };

  /**
   * Updates start only; never auto-submits. Re-reads Dexie so recovery is not
   * tied to a stale LiveQuery snapshot; submit still re-reads and fail-closes.
   */
  const applyOverlapRecovery = async () => {
    if (!overlapRecovery?.earliestStartDateStr) return;
    const staleSuggestedStartDateStr = overlapRecovery.earliestStartDateStr;
    try {
      const latest = await db.budgets.toArray();
      const result = resolveOverlapRecoveryClick({
        latestBudgets: latest,
        startDateStr,
        endDateStr,
        checkMode: overlapCheckMode(),
        staleSuggestedStartDateStr,
        excludeId: mode === 'edit' ? targetBudget?.id : undefined,
      });
      if (result.action === 'apply') {
        setStartDateStr(result.startDateStr);
        setFormError(null);
        setOverlapRecovery(null);
        return;
      }
      if (result.action === 'clear') {
        setFormError(null);
        setOverlapRecovery(null);
        return;
      }
      setFormError(result.details.message);
      setOverlapRecovery(result.details.earliestStartDateStr ? result.details : null);
    } catch (error) {
      console.error('Failed to refresh budgets for overlap recovery', error);
      setFormError('Could not refresh budgets. Try again, or adjust dates manually.');
      setOverlapRecovery(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const { getPersonalFinanceEditBlockError } = await import('../sync/restoreIsolation');
    const editBlock = getPersonalFinanceEditBlockError();
    if (editBlock) {
      setFormError(editBlock.message);
      return;
    }

    if (!name.trim()) {
      setFormError('Budget name is required.');
      return;
    }
    const amountCheck = validateBudgetAmount(amount);
    if ('error' in amountCheck) {
      setFormError(amountCheck.error);
      return;
    }

    if (mode === 'edit') {
      if (!targetBudget) {
        setFormError('Budget not found.');
        return;
      }
      if (targetBudget.status === 'archived') {
        setFormError('Archived budgets cannot be edited.');
        return;
      }

      setIsSubmitting(true);
      setFormError(null);
      setOverlapRecovery(null);
      try {
        const now = Date.now();
        const patch: {
          name: string;
          amount?: number;
          startDate?: number;
          endDate?: number;
          periodLength?: number;
          updatedAt: number;
        } = {
          name: name.trim(),
          updatedAt: now,
        };

        if (amountEditable) {
          patch.amount = amountCheck.value;
        }

        if (datesEditable) {
          const bounds = resolveBudgetEditBounds(targetBudget, startDateStr, endDateStr, now);
          if ('error' in bounds) {
            setFormError(bounds.error);
            setIsSubmitting(false);
            return;
          }
          const conflict = findOverlappingBudget(bounds, budgets, targetBudget.id);
          if (conflict) {
            showOverlapConflict(conflict);
            setIsSubmitting(false);
            return;
          }
          patch.startDate = bounds.startDate;
          patch.endDate = bounds.endDate;
          patch.periodLength = bounds.periodLengthDays;
        }

        await db.budgets.update(targetBudget.id, patch);
        triggerSync('budgets', targetBudget.id);
        setBudgetModalOpen(false);
      } catch (error) {
        console.error('Failed to edit budget', error);
        setFormError(error instanceof Error ? error.message : 'Failed to save budget.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const nowPreview = Date.now();
    let bounds: { startDate: number; endDate: number; periodLengthDays: number };

    if (mode === 'create') {
      const handoff = isCreateHandoffContext(budgets, startDateStr, nowPreview);
      const created = resolveCreatePeriodBounds(startDateStr, endDateStr, nowPreview, handoff);
      if ('error' in created) {
        setFormError(created.error);
        return;
      }
      bounds = created;
      const createConflict = findOverlappingBudget(
        bounds,
        budgetsWithActivesClippedForCreate(budgets, nowPreview, bounds.startDate),
      );
      if (createConflict) {
        showOverlapConflict(createConflict);
        return;
      }
    } else {
      const parsed = parseBudgetDateBounds(startDateStr, endDateStr, nowPreview);
      if ('error' in parsed) {
        setFormError(parsed.error);
        return;
      }
      bounds = parsed;
    }

    if (mode === 'continue') {
      if (!targetBudget) {
        setFormError('Budget not found.');
        return;
      }
      const continued = resolveContinuationBounds(targetBudget, bounds);
      if ('error' in continued) {
        setFormError(continued.error);
        return;
      }
      bounds = continued;
      const gate = canContinueBudget(targetBudget, budgets);
      if (!gate.ok) {
        setFormError(gate.error);
        return;
      }
      const continueConflict = findOverlappingBudget(bounds, budgets);
      if (continueConflict) {
        showOverlapConflict(continueConflict);
        return;
      }
    }

    setIsSubmitting(true);
    setFormError(null);
    setOverlapRecovery(null);
    try {
      const now = Date.now();
      const endedIds: string[] = [];

      if (mode === 'continue') {
        if (!targetBudget) {
          setFormError('Budget not found.');
          setIsSubmitting(false);
          return;
        }
        // Re-check inside submit (liveQuery may be stale vs concurrent heal).
        const latest = await db.budgets.toArray();
        const gate = canContinueBudget(targetBudget, latest);
        if (!gate.ok) {
          setFormError(gate.error);
          setIsSubmitting(false);
          return;
        }
        const conflict = findOverlappingBudget(bounds, latest);
        if (conflict) {
          showOverlapConflict(conflict);
          setIsSubmitting(false);
          return;
        }

        const budgetId = continuationBudgetId(targetBudget.id);
        // add() only — never put()/overwrite an archived continuation row.
        await db.budgets.add({
          id: budgetId,
          name: name.trim(),
          amount: amountCheck.value,
          period: 'days',
          periodLength: bounds.periodLengthDays,
          startDate: bounds.startDate,
          endDate: bounds.endDate,
          status: 'active',
          updatedAt: now,
        });
        triggerSync('budgets', budgetId);
        setBudgetModalOpen(false);
        return;
      }

      // Create: replace actives + same-day Manual End handoff (clip to newStart-1).
      const budgetId = createId('bud');
      await db.transaction('rw', db.budgets, async () => {
        const all = await db.budgets.toArray();
        // Re-resolve at write time so handoff start matches clip (`now`).
        const handoff = isCreateHandoffContext(all, startDateStr, now);
        const writeBounds = resolveCreatePeriodBounds(startDateStr, endDateStr, now, handoff);
        if ('error' in writeBounds) {
          throw new Error(writeBounds.error);
        }

        const activeBudgets = all.filter(b => b.status === 'active');
        for (const b of activeBudgets) {
          await db.budgets.update(b.id, patchForReplacingBudget(b, writeBounds.startDate, now));
          endedIds.push(b.id);
        }
        for (const b of all) {
          if (isSameDayCreateHandoffEnded(b, writeBounds.startDate, all)) {
            await db.budgets.update(b.id, patchForCreateHandoffEnded(b, writeBounds.startDate, now));
            if (!endedIds.includes(b.id)) endedIds.push(b.id);
          }
        }

        const afterClip = budgetsWithActivesClippedForCreate(all, now, writeBounds.startDate);
        const conflict = findOverlappingBudget(writeBounds, afterClip);
        if (conflict) {
          throw new Error(
            describeBudgetOverlapConflict({
              minStartDateStr: startDateStr,
              endDateStr,
              budgets: all,
              checkMode: 'create',
              now,
              conflict,
            }).message,
          );
        }

        await db.budgets.add({
          id: budgetId,
          name: name.trim(),
          amount: amountCheck.value,
          period: 'days',
          periodLength: writeBounds.periodLengthDays,
          startDate: writeBounds.startDate,
          endDate: writeBounds.endDate,
          status: 'active',
          updatedAt: now,
        });
      });

      endedIds.forEach(id => triggerSync('budgets', id));
      triggerSync('budgets', budgetId);

      setBudgetModalOpen(false);
    } catch (error) {
      console.error('Failed to save budget', error);
      const msg = error instanceof Error ? error.message : 'Failed to save budget.';
      // Dexie ConstraintError on duplicate continuation id (retry / race).
      if (/ConstraintError|Key already exists|already existed/i.test(msg)) {
        setFormError('This budget period was already continued. Start a new budget instead.');
        setOverlapRecovery(null);
      } else if (/Dates overlap|no later start|No valid start/i.test(msg)) {
        // Create/continue submit path — excludeId unused (edit returns earlier).
        const details = describeBudgetOverlapConflict({
          minStartDateStr: startDateStr,
          endDateStr,
          budgets,
          checkMode: overlapCheckMode(),
        });
        setFormError(details.message || msg);
        setOverlapRecovery(details.earliestStartDateStr ? details : null);
      } else {
        setFormError(msg);
        setOverlapRecovery(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isBudgetModalOpen) return null;

  if ((mode === 'edit' || mode === 'continue') && targetId && budgets.length > 0 && !targetBudget) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm">
        <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl shadow-xl p-6">
          <p className="text-sm text-red-500">Budget not found.</p>
          <button
            type="button"
            onClick={() => setBudgetModalOpen(false)}
            className="mt-4 w-full py-3 bg-muted rounded-xl text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full duration-300">

        <div className="flex justify-between items-center p-5 border-b border-border">
          <h2 className="text-xl font-medium text-foreground">{title}</h2>
          <button
            type="button"
            onClick={() => setBudgetModalOpen(false)}
            className="p-2 bg-muted rounded-full text-muted-foreground active:scale-95"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <form id="budget-form" onSubmit={handleSubmit} className="p-6 space-y-6">

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Budget Name</label>
              <input
                type="text"
                autoFocus
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                placeholder="e.g. August Groceries"
              />
            </div>

            {mode === 'continue' && carryPreview && (
              <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-1.5 text-sm" aria-live="polite">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Carry forward from previous period
                </p>
                <div className="flex justify-between text-foreground">
                  <span className="text-muted-foreground">Original period limit</span>
                  <span className="tabular-nums">{formatMoney(carryPreview.priorLimit)}</span>
                </div>
                <div className="flex justify-between text-foreground">
                  <span className="text-muted-foreground">Spent in that period</span>
                  <span className="tabular-nums">{formatMoney(carryPreview.priorSpent)}</span>
                </div>
                <div className="flex justify-between font-medium text-foreground pt-1 border-t border-border/80">
                  <span>Opening available (carried)</span>
                  <span className="tabular-nums">{formatMoney(carryPreview.carriedForward)}</span>
                </div>
                {carryPreview.overspentBy > 0 && (
                  <p className="text-[11px] text-red-500 pt-1">
                    Previous period overspent by {formatMoney(carryPreview.overspentBy)}.
                    Nothing left to carry — set a new opening available amount below (not the old limit).
                  </p>
                )}
                {carryPreview.requiresNewLimit && carryPreview.overspentBy === 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1">
                    Previous period used its full limit. Set a new opening available amount to continue.
                  </p>
                )}
                {!carryPreview.requiresNewLimit && (
                  <p className="text-[11px] text-muted-foreground pt-1">
                    This is unused funds carried into the new period — not a reset of the original limit.
                    Prior spending stays on the ended period.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {mode === 'continue'
                  ? (carryPreview?.requiresNewLimit ? 'New opening available' : 'Opening available for new period')
                  : 'Amount'}
              </label>
              <div className="flex items-center text-5xl font-light">
                <span className="text-2xl text-muted-foreground mr-2">LKR</span>
                <input
                  type="number"
                  inputMode="decimal"
                  required
                  min="0.01"
                  step="any"
                  disabled={!amountEditable}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-60"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Start Date</label>
                <input
                  type="date"
                  required
                  disabled={!datesEditable}
                  value={startDateStr}
                  onChange={e => {
                    setStartDateStr(e.target.value);
                    setOverlapRecovery(null);
                    setFormError(null);
                  }}
                  className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground disabled:opacity-60"
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">End Date</label>
                <input
                  type="date"
                  required
                  disabled={!datesEditable}
                  value={endDateStr}
                  onChange={e => {
                    setEndDateStr(e.target.value);
                    setOverlapRecovery(null);
                    setFormError(null);
                  }}
                  className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground disabled:opacity-60"
                />
              </div>
            </div>

            {mode === 'edit' && targetBudget?.status === 'ended' && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Ended period dates are locked so historical spending stays tied to the original window.
                You can still correct the name or limit.
              </p>
            )}

            {mode === 'continue' && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Creates a new period. New spending only counts against opening available.
                Dates must not overlap another non-archived period. Requires no other active budget.
              </p>
            )}

            {mode === 'create' && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                A new budget starting today begins at local midnight (full calendar day). Replacing an
                active budget — or creating after ending one today — starts at the handoff time so
                earlier expenses stay on the prior period. Dates must not overlap other non-archived periods.
              </p>
            )}

            {formError && (
              <div className="space-y-2" role="alert">
                <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  {formError}
                </p>
                {overlapRecovery?.earliestStartDateStr && datesEditable && (
                  <button
                    type="button"
                    onClick={() => void applyOverlapRecovery()}
                    className="w-full py-3 px-4 rounded-xl border border-border bg-muted/50 text-sm font-medium text-foreground active:scale-[0.99]"
                  >
                    Use earliest start ({overlapRecovery.earliestStartDateStr})
                  </button>
                )}
              </div>
            )}

          </form>
        </div>

        <div className="p-5 border-t border-border bg-card">
          <button
            type="submit"
            form="budget-form"
            disabled={isSubmitting}
            className="w-full py-4 bg-accent text-accent-foreground rounded-xl font-medium text-lg active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {submitLabel}
          </button>
        </div>

      </div>
    </div>
  );
}
