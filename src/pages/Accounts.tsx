import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { AccountType } from '../db/db';
import { Plus, X, Trash2 } from 'lucide-react';
import { useConfirm } from '../components/ConfirmDialog';
import MaskedAmount from '../components/MaskedAmount';
import NotificationBell from '../components/NotificationBell';
import {
  applyManualBalanceAdjustment,
  createAccountWithOpeningBalance,
  executeAccountDeletion,
  getAccountLinkCounts,
  planAccountDeletion,
  type AccountDeletePlan,
} from '../utils/accountLifecycle';
import {
  accountDeleteNeedsReassignment,
  soleAccountDeleteIsSafe,
} from '../utils/accountDeletePlanHelpers';
import { deleteFromCloud } from '../sync/syncEngine';
import { formatMoney } from '../utils/formatters';

const ACCOUNT_TYPES: { id: AccountType; label: string; icon: string }[] = [
  { id: 'cash', label: 'Cash', icon: '💵' },
  { id: 'wallet', label: 'Wallet', icon: '👛' },
  { id: 'bank', label: 'Bank', icon: '🏦' },
  { id: 'card', label: 'Card', icon: '💳' },
  { id: 'savings', label: 'Savings', icon: '🐷' },
  { id: 'other', label: 'Other', icon: '📦' },
];

export default function Accounts() {
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const totalBalance = accounts.filter(a => a.includeInTotal).reduce((sum, acc) => sum + acc.balance, 0);
  const { confirmDialog, requestConfirm } = useConfirm();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [balance, setBalance] = useState('');
  const [includeInTotal, setIncludeInTotal] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Delete / reassign UI
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const [deletePlan, setDeletePlan] = useState<AccountDeletePlan | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const openModal = (acc?: (typeof accounts)[0]) => {
    setFormError(null);
    if (acc) {
      setEditingId(acc.id);
      setName(acc.name);
      setType(acc.type);
      setBalance(acc.balance.toString());
      setIncludeInTotal(acc.includeInTotal);
    } else {
      setEditingId(null);
      setName('');
      setType('bank');
      setBalance('');
      setIncludeInTotal(true);
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || isNaN(Number(balance))) return;
    const { getPersonalFinanceEditBlockError } = await import('../sync/restoreIsolation');
    const editBlock = getPersonalFinanceEditBlockError();
    if (editBlock) {
      setFormError(editBlock.message);
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await applyManualBalanceAdjustment({
          accountId: editingId,
          newBalance: Number(balance),
          name: name.trim(),
          type,
          includeInTotal,
        });
      } else {
        await createAccountWithOpeningBalance({
          name: name.trim(),
          type,
          openingBalance: Number(balance) || 0,
          includeInTotal,
        });
      }
      setIsModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save account.');
    } finally {
      setIsSaving(false);
    }
  };

  const openDeleteFlow = async (id: string) => {
    setDeleteError(null);
    setDeletePlan(null);
    setDeleteTargetId(id);
    const others = accounts.filter(a => a.id !== id);
    setReplacementId(others[0]?.id || '');

    if (others.length === 0) {
      try {
        const links = await getAccountLinkCounts(id);
        if (!soleAccountDeleteIsSafe(links)) {
          setDeleteError(
            'This account has linked data but no other account to reassign it to. Create another account first.',
          );
        }
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : 'Could not plan deletion.');
      }
      return;
    }
    // Always plan when a replacement exists — zero-txn accounts may still have
    // recurring/goal/outbox/settlement refs or a non-zero cached balance to merge.
    try {
      const plan = await planAccountDeletion(id, others[0]!.id);
      if (accountDeleteNeedsReassignment(plan)) {
        setDeletePlan(plan);
      } else {
        setDeletePlan(null);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not plan deletion.');
    }
  };

  const onReplacementChange = async (id: string) => {
    setReplacementId(id);
    setDeleteError(null);
    if (!deleteTargetId || !id) {
      setDeletePlan(null);
      return;
    }
    try {
      setDeletePlan(await planAccountDeletion(deleteTargetId, id));
    } catch (err) {
      setDeletePlan(null);
      setDeleteError(err instanceof Error ? err.message : 'Could not plan deletion.');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const others = accounts.filter(a => a.id !== deleteTargetId);

      // Sole account: only allow when nothing would be orphaned
      if (others.length === 0) {
        const links = await getAccountLinkCounts(deleteTargetId);
        if (!soleAccountDeleteIsSafe(links)) {
          setDeleteError(
            'This account has linked data but no other account to reassign it to. Create another account first.',
          );
          return;
        }
        const ok = await requestConfirm({
          title: 'Delete account?',
          body: 'This account will be removed.',
          danger: true,
        });
        if (!ok) return;
        await db.accounts.delete(deleteTargetId);
        await deleteFromCloud('accounts', deleteTargetId);
      } else {
        if (!replacementId) {
          setDeleteError('Select a replacement account.');
          return;
        }
        const plan = deletePlan ?? (await planAccountDeletion(deleteTargetId, replacementId));

        if (!accountDeleteNeedsReassignment(plan)) {
          const ok = await requestConfirm({
            title: 'Delete account?',
            body: 'This account has no transactions or linked refs. It will be removed.',
            danger: true,
          });
          if (!ok) return;
          await db.accounts.delete(deleteTargetId);
          await deleteFromCloud('accounts', deleteTargetId);
        } else {
          if (plan.conflicts.length > 0) {
            setDeletePlan(plan);
            setDeleteError(
              `${plan.conflicts.length} transfer(s) between these accounts would become self-transfers. Edit or delete those transfers in Activity first.`,
            );
            return;
          }
          const ok = await requestConfirm({
            title: 'Delete and reassign?',
            body: `Move ${plan.transactionCount} transaction(s) to the replacement account and add ${formatMoney(plan.balanceToMerge)} from this account’s balance onto it. Recurring rules, goals, and settlement refs are retargeted. History amounts are unchanged.`,
            danger: true,
          });
          if (!ok) return;
          await executeAccountDeletion(plan);
        }
      }

      setDeleteTargetId(null);
      setDeletePlan(null);
      setIsModalOpen(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setIsDeleting(false);
    }
  };

  const getIcon = (t: string) => ACCOUNT_TYPES.find(a => a.id === t)?.icon || '📦';
  const deleteTarget = accounts.find(a => a.id === deleteTargetId);
  const replacementOptions = accounts.filter(a => a.id !== deleteTargetId);

  return (
    <>
      {confirmDialog}
      <div className="p-6 pb-28 max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-medium text-foreground">Accounts</h2>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              onClick={() => openModal()}
              className="bg-muted text-foreground px-3 py-2 rounded-xl text-sm font-medium flex items-center active:scale-95 transition-transform"
            >
              <Plus size={16} className="mr-1" /> Add
            </button>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-6 border border-border shadow-sm mb-8">
          <p className="text-sm text-muted-foreground font-medium mb-1">Net Worth</p>
          <p className="text-4xl font-light text-foreground">
            <span className="text-2xl mr-1">LKR</span>
            <MaskedAmount amount={totalBalance} />
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Only includes accounts marked &quot;Include in Total&quot;
          </p>
        </div>

        <div className="space-y-3">
          {accounts.map(acc => (
            <div
              key={acc.id}
              onClick={() => openModal(acc)}
              className={`p-4 bg-card border rounded-xl shadow-sm flex justify-between items-center cursor-pointer hover:bg-muted/50 transition-colors ${!acc.includeInTotal ? 'border-dashed border-border opacity-70' : 'border-border'}`}
            >
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg mr-3 border border-border">
                  {getIcon(acc.type)}
                </div>
                <div>
                  <p className="font-medium text-foreground flex items-center">
                    {acc.name}
                    {!acc.includeInTotal && (
                      <span className="ml-2 text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-medium uppercase tracking-wider">
                        Excluded
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">{acc.type}</p>
                </div>
              </div>
              <div className="font-medium text-foreground">
                <MaskedAmount amount={acc.balance} prefix="LKR " />
              </div>
            </div>
          ))}
        </div>

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full duration-300">
              <div className="flex justify-between items-center p-5 border-b border-border">
                <h2 className="text-xl font-medium text-foreground">
                  {editingId ? 'Edit Account' : 'New Account'}
                </h2>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 bg-muted rounded-full text-muted-foreground active:scale-95"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-5 flex-1 overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                    placeholder="e.g. HNB Savings"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    Type
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {ACCOUNT_TYPES.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setType(t.id)}
                        className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-colors ${
                          type === t.id
                            ? 'border-foreground bg-accent text-accent-foreground'
                            : 'border-border bg-card text-muted-foreground'
                        }`}
                      >
                        <span className="text-xl mb-1">{t.icon}</span>
                        <span className="text-xs font-medium">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    {editingId ? 'Current Balance (LKR)' : 'Opening Balance (LKR)'}
                  </label>
                  <input
                    type="number"
                    required
                    value={balance}
                    onChange={e => setBalance(e.target.value)}
                    className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    {editingId
                      ? 'Changing this creates a Balance Adjustment in Activity (not income/expense).'
                      : 'Saved as an Opening Balance history record. Not counted as income or budget spending.'}
                  </p>
                </div>

                <div className="bg-muted/50 p-4 rounded-xl border border-border">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="block font-medium text-foreground">Include in Total Balance</span>
                      <span className="block text-xs text-muted-foreground mt-1">
                        If unchecked, this account won&apos;t show in the dashboard&apos;s main number.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={includeInTotal}
                      onChange={e => setIncludeInTotal(e.target.checked)}
                      className="w-5 h-5 rounded border-border text-accent focus:ring-accent ml-4"
                    />
                  </label>
                </div>

                {formError && (
                  <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    {formError}
                  </p>
                )}

                <div className="pt-4 flex space-x-3">
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => openDeleteFlow(editingId)}
                      className="px-4 py-4 bg-red-500/10 text-red-500 rounded-xl font-medium active:scale-[0.98] transition-transform"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 py-4 bg-accent text-accent-foreground rounded-xl font-medium text-lg active:scale-[0.98] transition-transform disabled:opacity-60"
                  >
                    {isSaving ? 'Saving…' : 'Save Account'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {deleteTargetId && deleteTarget && (
          <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50 backdrop-blur-sm">
            <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl shadow-xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-medium text-foreground">Delete {deleteTarget.name}?</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Historical amounts stay the same. Remaining balance is added to the replacement
                    account.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTargetId(null);
                    setDeletePlan(null);
                    setDeleteError(null);
                  }}
                  className="p-2 bg-muted rounded-full text-muted-foreground"
                >
                  <X size={18} />
                </button>
              </div>

              {replacementOptions.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    Reassign linked data to
                  </label>
                  <select
                    value={replacementId}
                    onChange={e => void onReplacementChange(e.target.value)}
                    className="w-full p-3 bg-background border border-border rounded-xl text-foreground"
                  >
                    {replacementOptions.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} — {formatMoney(a.balance)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {deletePlan && (
                <div className="text-xs text-muted-foreground space-y-1 bg-muted/40 border border-border rounded-xl p-3">
                  <p>{deletePlan.transactionCount} transaction(s) will be reassigned.</p>
                  <p>Balance to merge: {formatMoney(deletePlan.balanceToMerge)}</p>
                  {deletePlan.recurringCount > 0 && (
                    <p>{deletePlan.recurringCount} recurring rule(s) retargeted.</p>
                  )}
                  {deletePlan.goalLinkCount > 0 && (
                    <p>{deletePlan.goalLinkCount} savings goal link(s) retargeted.</p>
                  )}
                  {deletePlan.outboxCount > 0 && (
                    <p>{deletePlan.outboxCount} pending settlement outbox row(s) retargeted.</p>
                  )}
                  {deletePlan.settlementRefCount > 0 && (
                    <p>{deletePlan.settlementRefCount} personal settlement ref(s) retargeted.</p>
                  )}
                  {deletePlan.conflicts.length > 0 && (
                    <div className="text-red-500 pt-2 space-y-1">
                      <p className="font-medium">
                        {deletePlan.conflicts.length} conflicting transfer(s) between these accounts:
                      </p>
                      {deletePlan.conflicts.slice(0, 5).map(c => (
                        <p key={c.id}>
                          · {formatMoney(c.amount)}
                          {c.notes ? ` — ${c.notes}` : ''} ({c.direction.replace('_', ' ')})
                        </p>
                      ))}
                      {deletePlan.conflicts.length > 5 && (
                        <p>…and {deletePlan.conflicts.length - 5} more</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {deleteError && (
                <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  {deleteError}
                </p>
              )}

              <button
                type="button"
                disabled={
                  isDeleting ||
                  !!deleteError?.includes('no other account') ||
                  (deletePlan != null && deletePlan.conflicts.length > 0)
                }
                onClick={() => void confirmDelete()}
                className="w-full py-3.5 bg-red-500 text-white rounded-xl font-medium disabled:opacity-50"
              >
                {isDeleting ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
