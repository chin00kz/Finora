import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { SavingsGoal } from '../db/db';
import {
  Target,
  Plus,
  Edit2,
  Trash2,
  Sparkles,
  Link as LinkIcon,
  X,
  PlusCircle,
  MinusCircle,
} from 'lucide-react';
import { format, differenceInDays, differenceInMonths } from 'date-fns';
import { triggerSync } from '../sync/syncEngine';

const GOAL_COLORS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f59e0b', // amber
  '#06b6d4', // cyan
];

export default function Goals() {
  const goals = useLiveQuery(() => db.savingsGoals.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);

  // Funds adjust modal
  const [adjustModalGoal, setAdjustModalGoal] = useState<SavingsGoal | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustType, setAdjustType] = useState<'deposit' | 'withdraw'>('deposit');

  // Form states
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [currentAmount, setCurrentAmount] = useState('');
  const [targetDateStr, setTargetDateStr] = useState('');
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [color, setColor] = useState(GOAL_COLORS[0]);

  const openAddModal = () => {
    setEditingGoal(null);
    setName('');
    setTargetAmount('');
    setCurrentAmount('');
    setTargetDateStr('');
    setLinkedAccountId('');
    setColor(GOAL_COLORS[0]);
    setIsModalOpen(true);
  };

  const openEditModal = (goal: SavingsGoal) => {
    setEditingGoal(goal);
    setName(goal.name);
    setTargetAmount(String(goal.targetAmount));
    setCurrentAmount(String(goal.currentAmount));
    setTargetDateStr(goal.targetDate ? format(new Date(goal.targetDate), 'yyyy-MM-dd') : '');
    setLinkedAccountId(goal.linkedAccountId || '');
    setColor(goal.color || GOAL_COLORS[0]);
    setIsModalOpen(true);
  };

  const handleSaveGoal = async () => {
    const numTarget = parseFloat(targetAmount);
    const numCurrent = linkedAccountId ? 0 : parseFloat(currentAmount) || 0;
    if (!name.trim() || isNaN(numTarget) || numTarget <= 0) return;

    let targetDate: number | undefined = undefined;
    if (targetDateStr) {
      const [y, m, d] = targetDateStr.split('-').map(Number);
      targetDate = new Date(y, m - 1, d, 12, 0, 0).getTime();
    }

    if (editingGoal) {
      await db.savingsGoals.update(editingGoal.id, {
        name: name.trim(),
        targetAmount: numTarget,
        currentAmount: numCurrent,
        targetDate,
        linkedAccountId: linkedAccountId || undefined,
        color,
        updatedAt: Date.now(),
      });
    } else {
      const rand = Math.random().toString(36).substring(2, 7);
      await db.savingsGoals.add({
        id: `goal-${Date.now()}-${rand}`,
        name: name.trim(),
        targetAmount: numTarget,
        currentAmount: numCurrent,
        targetDate,
        linkedAccountId: linkedAccountId || undefined,
        color,
        updatedAt: Date.now(),
      });
    }

    triggerSync();
    setIsModalOpen(false);
  };

  const handleDeleteGoal = async (goal: SavingsGoal) => {
    if (!confirm(`Delete savings goal "${goal.name}"?`)) return;
    await db.savingsGoals.delete(goal.id);
    triggerSync();
  };

  const handleAdjustFunds = async () => {
    if (!adjustModalGoal) return;
    const delta = parseFloat(adjustAmount);
    if (isNaN(delta) || delta <= 0) return;

    const newAmount =
      adjustType === 'deposit'
        ? adjustModalGoal.currentAmount + delta
        : Math.max(0, adjustModalGoal.currentAmount - delta);

    await db.savingsGoals.update(adjustModalGoal.id, {
      currentAmount: newAmount,
      updatedAt: Date.now(),
    });

    triggerSync();
    setAdjustModalGoal(null);
    setAdjustAmount('');
  };

  const getEffectiveAmount = (goal: SavingsGoal) => {
    if (goal.linkedAccountId) {
      const acc = accounts.find(a => a.id === goal.linkedAccountId);
      return Math.max(0, acc?.balance || 0);
    }
    return goal.currentAmount;
  };

  return (
    <div className="p-6 pb-28 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-medium text-foreground">Savings Goals</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track targets, emergency funds, and major milestones
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-accent text-accent-foreground rounded-xl text-xs font-medium active:scale-95 transition-transform shadow-sm"
        >
          <Plus size={16} />
          <span>New Goal</span>
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="p-10 bg-card border border-border rounded-2xl text-center">
          <Target size={36} className="mx-auto text-muted-foreground opacity-40 mb-3" />
          <p className="text-base font-medium text-foreground">No savings goals yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Set up a target for an emergency fund, gadget, vacation, or link a dedicated savings
            account.
          </p>
          <button
            onClick={openAddModal}
            className="mt-4 px-4 py-2 bg-accent text-accent-foreground rounded-xl text-xs font-medium active:scale-95 transition-transform"
          >
            Create First Goal
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map(goal => {
            const current = getEffectiveAmount(goal);
            const target = goal.targetAmount;
            const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
            const isCompleted = current >= target;
            const linkedAcc = goal.linkedAccountId
              ? accounts.find(a => a.id === goal.linkedAccountId)
              : null;

            // Target date calculations
            let timeRemainingText = '';
            let monthlyNeededText = '';
            if (goal.targetDate && !isCompleted) {
              const days = differenceInDays(new Date(goal.targetDate), new Date());
              const months = Math.max(1, differenceInMonths(new Date(goal.targetDate), new Date()));
              if (days > 0) {
                timeRemainingText = `${days} days left (${format(new Date(goal.targetDate), 'MMM yyyy')})`;
                const remainingAmount = target - current;
                const monthly = Math.round(remainingAmount / months);
                monthlyNeededText = `~LKR ${monthly.toLocaleString()}/mo needed`;
              } else {
                timeRemainingText = 'Target date reached';
              }
            }

            return (
              <div
                key={goal.id}
                className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col justify-between relative overflow-hidden"
              >
                {/* 100% Celebration Banner */}
                {isCompleted && (
                  <div className="mb-3 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                    <Sparkles size={16} />
                    <span>Goal Completed! 100% Achieved</span>
                  </div>
                )}

                <div>
                  {/* Title & Actions */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: goal.color || GOAL_COLORS[0] }}
                      />
                      <div>
                        <h3 className="font-medium text-foreground text-base">{goal.name}</h3>
                        {linkedAcc ? (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <LinkIcon size={12} />
                            <span>Linked to {linkedAcc.name} (auto-tracked)</span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground mt-0.5">Manual tracking</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(goal)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteGoal(goal)}
                        className="p-1.5 text-muted-foreground hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Amount Progress */}
                  <div className="flex justify-between items-baseline mb-2">
                    <div>
                      <span className="text-2xl font-light text-foreground">
                        LKR {current.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1.5">
                        of LKR {target.toLocaleString()}
                      </span>
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        isCompleted ? 'text-emerald-500' : 'text-foreground'
                      }`}
                    >
                      {pct}%
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: goal.color || GOAL_COLORS[0],
                      }}
                    />
                  </div>

                  {/* Target Date Details */}
                  {timeRemainingText && (
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
                      <span>{timeRemainingText}</span>
                      {monthlyNeededText && <span>{monthlyNeededText}</span>}
                    </div>
                  )}
                </div>

                {/* Manual Goal Action Buttons */}
                {!goal.linkedAccountId && (
                  <div className="flex gap-2 pt-3 border-t border-border mt-2">
                    <button
                      onClick={() => {
                        setAdjustModalGoal(goal);
                        setAdjustType('deposit');
                        setAdjustAmount('');
                      }}
                      className="flex-1 py-1.5 px-3 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors active:scale-95"
                    >
                      <PlusCircle size={14} />
                      <span>Add Funds</span>
                    </button>
                    <button
                      onClick={() => {
                        setAdjustModalGoal(goal);
                        setAdjustType('withdraw');
                        setAdjustAmount('');
                      }}
                      className="py-1.5 px-3 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors active:scale-95"
                    >
                      <MinusCircle size={14} />
                      <span>Withdraw</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit Goal Modal ────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="text-lg font-medium text-foreground">
                {editingGoal ? 'Edit Savings Goal' : 'New Savings Goal'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Goal Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Emergency Fund, Laptop, Japan Trip"
                  className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                  autoFocus
                />
              </div>

              {/* Target Amount */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Target Amount (LKR)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={targetAmount}
                  onChange={e => setTargetAmount(e.target.value)}
                  placeholder="0"
                  className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                />
              </div>

              {/* Link to Account (Optional) */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Link to Account (Optional)
                </label>
                <select
                  value={linkedAccountId}
                  onChange={e => setLinkedAccountId(e.target.value)}
                  className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                >
                  <option value="">No linked account (Manual tracking)</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} (Balance: LKR {a.balance.toLocaleString()})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  If linked, progress automatically tracks that account's live balance.
                </p>
              </div>

              {/* Initial Amount (Only if not linked) */}
              {!linkedAccountId && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Current Saved Amount (LKR)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={currentAmount}
                    onChange={e => setCurrentAmount(e.target.value)}
                    placeholder="0"
                    className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                  />
                </div>
              )}

              {/* Target Date */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Target Date (Optional)
                </label>
                <input
                  type="date"
                  value={targetDateStr}
                  onChange={e => setTargetDateStr(e.target.value)}
                  className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                />
              </div>

              {/* Color Swatches */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Goal Color
                </label>
                <div className="flex gap-2.5">
                  {GOAL_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${
                        color === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 p-5 border-t border-border bg-muted/30">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex-1 py-2.5 px-4 border border-border bg-background text-muted-foreground rounded-xl text-sm font-medium hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveGoal}
                disabled={!name.trim() || !targetAmount || parseFloat(targetAmount) <= 0}
                className="flex-1 py-2.5 px-4 bg-accent text-accent-foreground rounded-xl text-sm font-medium shadow-sm active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                Save Goal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Adjust Funds Quick Modal ────────────────────────────────────── */}
      {adjustModalGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border w-full max-w-sm rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-base font-medium text-foreground">
                {adjustType === 'deposit' ? 'Add Funds' : 'Withdraw Funds'} &middot;{' '}
                {adjustModalGoal.name}
              </h3>
              <button
                onClick={() => setAdjustModalGoal(null)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-lg"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Current progress: LKR {adjustModalGoal.currentAmount.toLocaleString()} of LKR{' '}
                {adjustModalGoal.targetAmount.toLocaleString()}
              </p>
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Amount (LKR)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={adjustAmount}
                  onChange={e => setAdjustAmount(e.target.value)}
                  placeholder="0"
                  className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex gap-2 p-4 border-t border-border bg-muted/30">
              <button
                onClick={() => setAdjustModalGoal(null)}
                className="flex-1 py-2 px-3 border border-border bg-background text-muted-foreground rounded-xl text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAdjustFunds}
                disabled={!adjustAmount || parseFloat(adjustAmount) <= 0}
                className="flex-1 py-2 px-3 bg-accent text-accent-foreground rounded-xl text-xs font-medium disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
