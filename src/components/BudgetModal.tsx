import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { db } from '../db/db';
import { useUIStore } from '../store/uiStore';
import { triggerSync } from '../sync/syncEngine';
import { createId } from '../utils/createId';
import {
  formatLocalDateInput,
  parseBudgetDateBounds,
  patchForEndingBudget,
} from '../utils/budgetLifecycle';

export default function BudgetModal() {
  const { isBudgetModalOpen, setBudgetModalOpen } = useUIStore();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [startDateStr, setStartDateStr] = useState('');
  const [endDateStr, setEndDateStr] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isBudgetModalOpen) {
      const today = new Date();
      setStartDateStr(formatLocalDateInput(today));

      const defaultEnd = new Date();
      defaultEnd.setDate(defaultEnd.getDate() + 30);
      setEndDateStr(formatLocalDateInput(defaultEnd));

      setName('');
      setAmount('');
      setFormError(null);
      setIsSubmitting(false);
    }
  }, [isBudgetModalOpen]);

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
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setFormError('Amount must be greater than zero.');
      return;
    }

    const bounds = parseBudgetDateBounds(startDateStr, endDateStr);
    if ('error' in bounds) {
      setFormError(bounds.error);
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      const now = Date.now();
      const budgetId = createId('bud');
      const endedIds: string[] = [];

      await db.transaction('rw', db.budgets, async () => {
        const activeBudgets = await db.budgets.filter(b => b.status === 'active').toArray();
        for (const b of activeBudgets) {
          await db.budgets.update(b.id, patchForEndingBudget(b, now));
          endedIds.push(b.id);
        }

        await db.budgets.add({
          id: budgetId,
          name: name.trim(),
          amount: numAmount,
          period: 'days',
          periodLength: bounds.periodLengthDays,
          startDate: bounds.startDate,
          endDate: bounds.endDate,
          status: 'active',
          updatedAt: now,
        });
      });

      endedIds.forEach(id => triggerSync('budgets', id));
      triggerSync('budgets', budgetId);

      setName('');
      setAmount('');
      setBudgetModalOpen(false);
    } catch (error) {
      console.error('Failed to save budget', error);
      setFormError(error instanceof Error ? error.message : 'Failed to save budget.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isBudgetModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full duration-300">

        <div className="flex justify-between items-center p-5 border-b border-border">
          <h2 className="text-xl font-medium text-foreground">New Budget Period</h2>
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

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Amount</label>
              <div className="flex items-center text-5xl font-light">
                <span className="text-2xl text-muted-foreground mr-2">LKR</span>
                <input
                  type="number"
                  inputMode="decimal"
                  required
                  min="0.01"
                  step="any"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/50"
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
                  value={startDateStr}
                  onChange={e => setStartDateStr(e.target.value)}
                  className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">End Date</label>
                <input
                  type="date"
                  required
                  value={endDateStr}
                  onChange={e => setEndDateStr(e.target.value)}
                  className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Starting today begins now (local time), so earlier today&apos;s expenses stay outside this period.
              Ending a previous active budget freezes its end date so periods do not overlap.
            </p>

            {formError && (
              <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                {formError}
              </p>
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
            {isSubmitting ? 'Starting…' : 'Start Budget'}
          </button>
        </div>

      </div>
    </div>
  );
}
