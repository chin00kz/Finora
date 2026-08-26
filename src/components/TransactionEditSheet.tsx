import { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { db, type Transaction, type TransactionType } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';

interface Props {
  transaction: Transaction;
  onClose: () => void;
}

export default function TransactionEditSheet({ transaction, onClose }: Props) {
  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const tags = useLiveQuery(() => db.tags.toArray()) || [];

  // Form state — initialise from the transaction
  const [amount, setAmount] = useState(String(transaction.amount));
  const [type] = useState<TransactionType>(transaction.type); // type changes are too complex; read-only
  const [accountId, setAccountId] = useState(transaction.accountId);
  const [toAccountId, setToAccountId] = useState(transaction.toAccountId || '');
  const [categoryId, setCategoryId] = useState(transaction.categoryId || '');
  const [notes, setNotes] = useState(transaction.notes || '');
  const [isShared, setIsShared] = useState(transaction.isShared || false);
  const [personalAmount, setPersonalAmount] = useState(String(transaction.personalAmount || ''));
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(transaction.tagIds || []);
  const [tagInput, setTagInput] = useState('');

  const filteredCategories = categories.filter(c => c.type === (type === 'transfer' ? 'expense' : type));

  // ── Reverse balance effect of the OLD transaction ───────────────────────────
  const reverseBalance = async () => {
    const oldAmount = transaction.amount;
    const fromAcc = await db.accounts.get(transaction.accountId);
    if (!fromAcc) return;

    if (transaction.type === 'expense') {
      await db.accounts.update(transaction.accountId, { balance: fromAcc.balance + oldAmount });
    } else if (transaction.type === 'income') {
      await db.accounts.update(transaction.accountId, { balance: fromAcc.balance - oldAmount });
    } else if (transaction.type === 'transfer' && transaction.toAccountId) {
      const toAcc = await db.accounts.get(transaction.toAccountId);
      if (toAcc) {
        await db.accounts.update(transaction.accountId, { balance: fromAcc.balance + oldAmount });
        await db.accounts.update(transaction.toAccountId, { balance: toAcc.balance - oldAmount });
      }
    }
  };

  // ── Apply balance effect of the NEW transaction ─────────────────────────────
  const applyBalance = async (newAmount: number, newAccountId: string, newToAccountId?: string) => {
    const fromAcc = await db.accounts.get(newAccountId);
    if (!fromAcc) return;

    if (type === 'expense') {
      await db.accounts.update(newAccountId, { balance: fromAcc.balance - newAmount });
    } else if (type === 'income') {
      await db.accounts.update(newAccountId, { balance: fromAcc.balance + newAmount });
    } else if (type === 'transfer' && newToAccountId) {
      const toAcc = await db.accounts.get(newToAccountId);
      if (toAcc) {
        await db.accounts.update(newAccountId, { balance: fromAcc.balance - newAmount });
        await db.accounts.update(newToAccountId, { balance: toAcc.balance + newAmount });
      }
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const numAmount = Number(amount);
    if (!numAmount || isNaN(numAmount)) return;

    try {
      await db.transaction('rw', db.transactions, db.accounts, db.tags, async () => {
        // Resolve any new tags
        const resolvedTagIds: string[] = [];
        for (const tid of selectedTagIds) {
          // tid may be an existing id OR a raw name (from inline input)
          const existing = await db.tags.get(tid);
          if (existing) {
            resolvedTagIds.push(tid);
          } else {
            // treat as name, find or create
            const byName = await db.tags.where('name').equalsIgnoreCase(tid).first();
            if (byName) {
              resolvedTagIds.push(byName.id);
            } else {
              const newId = `tag-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
              await db.tags.add({ id: newId, name: tid });
              resolvedTagIds.push(newId);
            }
          }
        }

        // Reverse old balance effect then apply new
        await reverseBalance();
        await applyBalance(numAmount, accountId, toAccountId || undefined);

        // Update transaction record
        await db.transactions.update(transaction.id, {
          amount: numAmount,
          accountId,
          toAccountId: type === 'transfer' ? toAccountId : undefined,
          categoryId: type !== 'transfer' ? categoryId : undefined,
          notes,
          tagIds: resolvedTagIds.length > 0 ? resolvedTagIds : undefined,
          isShared,
          personalAmount: isShared ? Number(personalAmount) : undefined,
        });
      });
      onClose();
    } catch (err) {
      console.error('Failed to save transaction edit', err);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!confirm('Delete this transaction? The account balance will be reversed.')) return;
    try {
      await db.transaction('rw', db.transactions, db.accounts, async () => {
        await reverseBalance();
        await db.transactions.delete(transaction.id);
      });
      onClose();
    } catch (err) {
      console.error('Failed to delete transaction', err);
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    );
  };

  const addTagFromInput = async () => {
    const name = tagInput.trim();
    if (!name) return;
    // Find or stage by name — we'll resolve to real ID on save
    const existing = tags.find(t => t.name.toLowerCase() === name.toLowerCase());
    const idToAdd = existing ? existing.id : name; // use name as placeholder id if new
    if (!selectedTagIds.includes(idToAdd)) {
      setSelectedTagIds(prev => [...prev, idToAdd]);
    }
    setTagInput('');
  };

  const getTagDisplay = (tid: string) => {
    const t = tags.find(t => t.id === tid);
    return t ? t.name : tid; // fallback to raw value (new tag name)
  };

  const typeLabel = type === 'expense' ? 'Expense' : type === 'income' ? 'Income' : 'Transfer';

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full duration-300">

        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">{typeLabel}</p>
            <h2 className="text-xl font-medium text-gray-900">Edit Transaction</h2>
          </div>
          <button onClick={onClose} className="p-2 bg-gray-100 rounded-full text-gray-500 active:scale-95">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wider">Amount</label>
            <div className="flex items-center text-4xl font-light">
              <span className="text-xl text-gray-400 mr-2">LKR</span>
              <input
                type="number"
                inputMode="decimal"
                required
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full bg-transparent outline-none placeholder:text-gray-200"
              />
            </div>
          </div>

          {/* Account */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
              {type === 'transfer' ? 'From Account' : 'Account'}
            </label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 outline-none"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} — LKR {a.balance.toLocaleString()}</option>
              ))}
            </select>
          </div>

          {/* To Account (transfers) */}
          {type === 'transfer' && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">To Account</label>
              <select
                value={toAccountId}
                onChange={e => setToAccountId(e.target.value)}
                className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 outline-none"
              >
                <option value="">Select destination...</option>
                {accounts.filter(a => a.id !== accountId).map(a => (
                  <option key={a.id} value={a.id}>{a.name} — LKR {a.balance.toLocaleString()}</option>
                ))}
              </select>
            </div>
          )}

          {/* Category */}
          {type !== 'transfer' && filteredCategories.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Category</label>
              <div className="grid grid-cols-3 gap-2">
                {filteredCategories.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryId(c.id)}
                    className={`p-3 rounded-xl border text-sm font-medium transition-colors ${
                      categoryId === c.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 outline-none focus:border-gray-900"
              placeholder="What was this for?"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Tags</label>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex flex-wrap gap-2 items-center min-h-[48px]">
              {selectedTagIds.map(tid => (
                <span key={tid} className="flex items-center bg-gray-200 text-gray-800 px-2 py-0.5 rounded-md text-sm">
                  #{getTagDisplay(tid)}
                  <button type="button" onClick={() => toggleTag(tid)} className="ml-1 text-gray-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(); } }}
                placeholder={selectedTagIds.length === 0 ? 'Add tags...' : ''}
                className="flex-1 min-w-[80px] bg-transparent text-sm outline-none"
              />
            </div>
            {/* Tag suggestions */}
            {tagInput && (
              <div className="mt-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {tags.filter(t => t.name.toLowerCase().includes(tagInput.toLowerCase()) && !selectedTagIds.includes(t.id)).map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { toggleTag(t.id); setTagInput(''); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                  >
                    #{t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Shared expense */}
          {type === 'expense' && (
            <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
              <label className="flex items-center mb-3">
                <input
                  type="checkbox"
                  checked={isShared}
                  onChange={e => setIsShared(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600"
                />
                <span className="ml-3 text-sm font-medium text-gray-900">Shared Expense (Split)</span>
              </label>
              {isShared && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wider">My Share (LKR)</label>
                  <input
                    type="number"
                    value={personalAmount}
                    onChange={e => setPersonalAmount(e.target.value)}
                    className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm font-medium outline-none"
                    placeholder="Your personal share"
                  />
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 flex gap-3 shrink-0">
          <button
            onClick={handleDelete}
            className="p-4 bg-red-50 text-red-500 rounded-xl active:scale-95 transition-transform"
            title="Delete transaction"
          >
            <Trash2 size={20} />
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-4 bg-gray-900 text-white rounded-xl font-medium text-base active:scale-[0.98] transition-transform"
          >
            Save Changes
          </button>
        </div>

      </div>
    </div>
  );
}
