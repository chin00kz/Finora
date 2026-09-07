import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { RecurringTransaction, RecurringFrequency } from '../db/db';
import { Plus, Repeat, Pause, Play, Edit2, Trash2, X, Clock } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { processDueRecurringTransactions } from '../utils/recurringEngine';
import { triggerSync, deleteFromCloud } from '../sync/syncEngine';

export default function Recurring() {
  const recurringRules = useLiveQuery(() => db.recurringTransactions.toArray()) || [];
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurringTransaction | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dueDateStr, setDueDateStr] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Run engine on screen visit to make sure upcoming bills are up to date
  useEffect(() => {
    processDueRecurringTransactions();
  }, []);

  const openAddModal = () => {
    setEditingRule(null);
    setName('');
    setAmount('');
    setType('expense');
    setFrequency('monthly');
    setAccountId(accounts[0]?.id || '');
    setCategoryId('');
    setDueDateStr(format(new Date(), 'yyyy-MM-dd'));
    setIsModalOpen(true);
  };

  const openEditModal = (rule: RecurringTransaction) => {
    setEditingRule(rule);
    setName(rule.name);
    setAmount(String(rule.amount));
    setType(rule.type);
    setFrequency(rule.frequency);
    setAccountId(rule.accountId);
    setCategoryId(rule.categoryId || '');
    setDueDateStr(format(new Date(rule.nextDueDate), 'yyyy-MM-dd'));
    setIsModalOpen(true);
  };

  const handleSaveRule = async () => {
    const numAmount = parseFloat(amount);
    if (!name.trim() || isNaN(numAmount) || numAmount <= 0 || !accountId) return;

    // Parse date in local time
    const [y, m, d] = dueDateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);
    const nextDueDate = dateObj.getTime();

    if (editingRule) {
      await db.recurringTransactions.update(editingRule.id, {
        name: name.trim(),
        amount: numAmount,
        type,
        frequency,
        accountId,
        categoryId: categoryId || undefined,
        nextDueDate,
        updatedAt: Date.now(),
      });
    } else {
      const rand = Math.random().toString(36).substring(2, 7);
      await db.recurringTransactions.add({
        id: `rec-${Date.now()}-${rand}`,
        name: name.trim(),
        amount: numAmount,
        type,
        frequency,
        accountId,
        categoryId: categoryId || undefined,
        nextDueDate,
        active: true,
        updatedAt: Date.now(),
      });
    }

    triggerSync();
    setIsModalOpen(false);
    // Process if user picked today or a past date
    processDueRecurringTransactions();
  };

  const handleToggleActive = async (rule: RecurringTransaction) => {
    await db.recurringTransactions.update(rule.id, {
      active: !rule.active,
      updatedAt: Date.now(),
    });
    triggerSync();
  };

  const handleDeleteRule = async (rule: RecurringTransaction) => {
    if (!confirm(`Delete recurring rule "${rule.name}"? Past generated transactions will stay safe.`)) return;
    await db.recurringTransactions.delete(rule.id);
    await deleteFromCloud('recurring_transactions', rule.id);
    triggerSync();
  };

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || 'Unknown Account';
  const getCategory = (id?: string) => categories.find(c => c.id === id);

  // Upcoming bills calculations (next 7 and 30 days)
  const now = Date.now();
  const activeRules = recurringRules.filter(r => r.active);

  const upcomingNext7 = activeRules
    .filter(r => {
      const diff = differenceInDays(new Date(r.nextDueDate), new Date(now));
      return diff >= 0 && diff <= 7;
    })
    .sort((a, b) => a.nextDueDate - b.nextDueDate);

  const upcomingNext30 = activeRules
    .filter(r => {
      const diff = differenceInDays(new Date(r.nextDueDate), new Date(now));
      return diff > 7 && diff <= 30;
    })
    .sort((a, b) => a.nextDueDate - b.nextDueDate);

  return (
    <div className="p-6 pb-28 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-medium text-foreground">Recurring & Subscriptions</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Automate scheduled bills and recurring income</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-accent text-accent-foreground rounded-xl text-xs font-medium active:scale-95 transition-transform shadow-sm"
        >
          <Plus size={16} />
          <span>New Rule</span>
        </button>
      </div>

      {/* ── Upcoming Schedule Glance ────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Clock size={14} />
          <span>Upcoming (Next 30 Days)</span>
        </h2>

        {upcomingNext7.length === 0 && upcomingNext30.length === 0 ? (
          <div className="p-6 bg-card border border-border rounded-2xl text-center text-muted-foreground text-sm">
            No bills due in the next 30 days.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Due in 7 days */}
            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-amber-500 mb-3 tracking-wider">
                Due within 7 days ({upcomingNext7.length})
              </p>
              {upcomingNext7.length === 0 ? (
                <p className="text-xs text-muted-foreground">All clear for the week.</p>
              ) : (
                <div className="space-y-2">
                  {upcomingNext7.map(r => {
                    const days = differenceInDays(new Date(r.nextDueDate), new Date(now));
                    const cat = getCategory(r.categoryId);
                    return (
                      <div key={r.id} className="flex items-center justify-between p-2.5 bg-muted/40 rounded-xl">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: cat?.color || '#64748b' }}
                          />
                          <div>
                            <p className="text-sm font-medium text-foreground">{r.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {days === 0 ? 'Due today' : `Due in ${days}d`} &middot; {getAccountName(r.accountId)}
                            </p>
                          </div>
                        </div>
                        <span className={`text-sm font-medium ${r.type === 'expense' ? 'text-foreground' : 'text-emerald-500'}`}>
                          {r.type === 'expense' ? '-' : '+'}LKR {r.amount.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Due in 8-30 days */}
            <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-3 tracking-wider">
                Later this month ({upcomingNext30.length})
              </p>
              {upcomingNext30.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming bills later this month.</p>
              ) : (
                <div className="space-y-2">
                  {upcomingNext30.map(r => {
                    const days = differenceInDays(new Date(r.nextDueDate), new Date(now));
                    const cat = getCategory(r.categoryId);
                    return (
                      <div key={r.id} className="flex items-center justify-between p-2.5 bg-muted/40 rounded-xl">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: cat?.color || '#64748b' }}
                          />
                          <div>
                            <p className="text-sm font-medium text-foreground">{r.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              Due in {days}d ({format(new Date(r.nextDueDate), 'MMM dd')}) &middot; {getAccountName(r.accountId)}
                            </p>
                          </div>
                        </div>
                        <span className={`text-sm font-medium ${r.type === 'expense' ? 'text-foreground' : 'text-emerald-500'}`}>
                          {r.type === 'expense' ? '-' : '+'}LKR {r.amount.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── All Recurring Rules ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Repeat size={14} />
          <span>All Recurring Rules ({recurringRules.length})</span>
        </h2>

        {recurringRules.length === 0 ? (
          <div className="p-8 bg-card border border-border rounded-2xl text-center">
            <Repeat size={32} className="mx-auto text-muted-foreground opacity-40 mb-2" />
            <p className="text-sm font-medium text-foreground">No recurring rules yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Add your monthly rent, subscriptions, or recurring salary to have them auto-logged.
            </p>
            <button
              onClick={openAddModal}
              className="mt-4 px-4 py-2 bg-accent text-accent-foreground rounded-xl text-xs font-medium active:scale-95 transition-transform"
            >
              Add First Rule
            </button>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden shadow-sm">
            {recurringRules.map(rule => {
              const cat = getCategory(rule.categoryId);
              return (
                <div key={rule.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleToggleActive(rule)}
                      title={rule.active ? 'Pause Rule' : 'Resume Rule'}
                      className={`p-2 rounded-xl transition-colors ${
                        rule.active
                          ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {rule.active ? <Play size={16} className="fill-current" /> : <Pause size={16} />}
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground text-sm">{rule.name}</span>
                        {!rule.active && (
                          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">
                            Paused
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span className="capitalize">{rule.frequency}</span>
                        <span>&middot;</span>
                        <span>Next: {format(new Date(rule.nextDueDate), 'MMM dd, yyyy')}</span>
                        <span>&middot;</span>
                        <span>{getAccountName(rule.accountId)}</span>
                        {cat && (
                          <>
                            <span>&middot;</span>
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                              {cat.name}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-0 border-border/50">
                    <span className={`text-base font-semibold ${rule.type === 'expense' ? 'text-foreground' : 'text-emerald-500'}`}>
                      {rule.type === 'expense' ? '-' : '+'}LKR {rule.amount.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(rule)}
                        className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule)}
                        className="p-2 text-muted-foreground hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Add / Edit Modal ──────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="text-lg font-medium text-foreground">
                {editingRule ? 'Edit Recurring Rule' : 'New Recurring Rule'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Type Toggle */}
              <div className="flex bg-muted p-1 rounded-xl">
                {(['expense', 'income'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                      type === t ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Rule Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Netflix, Gym, Rent, Monthly Salary"
                  className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                  autoFocus
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Amount (LKR)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                />
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Frequency
                </label>
                <select
                  value={frequency}
                  onChange={e => setFrequency(e.target.value as RecurringFrequency)}
                  className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground capitalize"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              {/* Account & Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Account
                  </label>
                  <select
                    value={accountId}
                    onChange={e => setAccountId(e.target.value)}
                    className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Category
                  </label>
                  <select
                    value={categoryId}
                    onChange={e => setCategoryId(e.target.value)}
                    className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                  >
                    <option value="">None</option>
                    {categories
                      .filter(c => c.type === type)
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Next Due Date */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Next Due Date
                </label>
                <input
                  type="date"
                  value={dueDateStr}
                  onChange={e => setDueDateStr(e.target.value)}
                  className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                />
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
                onClick={handleSaveRule}
                disabled={!name.trim() || !amount || parseFloat(amount) <= 0 || !accountId}
                className="flex-1 py-2.5 px-4 bg-accent text-accent-foreground rounded-xl text-sm font-medium shadow-sm active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                Save Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
