import { useState } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { db, type TransactionType } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useUIStore } from '../store/uiStore';

export default function TransactionModal() {
  const { isAddTransactionModalOpen, setAddTransactionModalOpen } = useUIStore();
  
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  
  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [notes, setNotes] = useState('');
  const [toAccountId, setToAccountId] = useState(''); // For transfers
  const [isShared, setIsShared] = useState(false);
  const [personalAmount, setPersonalAmount] = useState(''); // For shared expenses

  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];

  const filteredCategories = categories.filter(c => c.type === (type === 'transfer' ? 'expense' : type));

  // Set defaults when data loads
  if (accounts.length > 0 && !accountId) setAccountId(accounts[0].id);
  if (filteredCategories.length > 0 && !categoryId && type !== 'transfer') setCategoryId(filteredCategories[0].id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return;

    const numAmount = Number(amount);

    try {
      await db.transaction('rw', db.transactions, db.accounts, async () => {
        // 1. Add transaction record
        await db.transactions.add({
          id: `txn-${Date.now()}`,
          type,
          amount: numAmount,
          date: Date.now(),
          accountId,
          categoryId: type !== 'transfer' ? categoryId : undefined,
          notes,
          toAccountId: type === 'transfer' ? toAccountId : undefined,
          isShared,
          personalAmount: isShared ? Number(personalAmount) : undefined,
        });

        // 2. Update account balances
        const fromAcc = await db.accounts.get(accountId);
        if (fromAcc) {
          if (type === 'expense') {
            await db.accounts.update(accountId, { balance: fromAcc.balance - numAmount });
          } else if (type === 'income') {
            await db.accounts.update(accountId, { balance: fromAcc.balance + numAmount });
          } else if (type === 'transfer' && toAccountId) {
            const toAcc = await db.accounts.get(toAccountId);
            if (toAcc) {
              await db.accounts.update(accountId, { balance: fromAcc.balance - numAmount });
              await db.accounts.update(toAccountId, { balance: toAcc.balance + numAmount });
            }
          }
        }
      });

      // Reset & close
      setAmount('');
      setNotes('');
      setShowAdvanced(false);
      setIsShared(false);
      setAddTransactionModalOpen(false);
    } catch (error) {
      console.error("Failed to save transaction", error);
    }
  };

  if (!isAddTransactionModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col h-[85vh] animate-in slide-in-from-bottom-full duration-300">
        
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100">
          <h2 className="text-xl font-medium text-gray-900">New Transaction</h2>
          <button onClick={() => setAddTransactionModalOpen(false)} className="p-2 bg-gray-100 rounded-full text-gray-500 active:scale-95">
            <X size={20} />
          </button>
        </div>

        {/* Form Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          <form id="tx-form" onSubmit={handleSubmit} className="p-6 space-y-6">
            
            {/* Type Selector */}
            <div className="flex bg-gray-100 p-1 rounded-xl">
              {(['expense', 'income', 'transfer'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg capitalize transition-colors ${
                    type === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Amount</label>
              <div className="flex items-center text-5xl font-light">
                <span className="text-2xl text-gray-400 mr-2">LKR</span>
                <input
                  type="number"
                  inputMode="decimal"
                  autoFocus
                  required
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full bg-transparent outline-none placeholder:text-gray-300"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* From Account */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                {type === 'transfer' ? 'From Account' : 'Account'}
              </label>
              <select 
                value={accountId} 
                onChange={e => setAccountId(e.target.value)}
                className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-none focus:border-gray-900"
              >
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.balance})</option>)}
              </select>
            </div>

            {/* To Account (Transfers) */}
            {type === 'transfer' && (
              <div className="animate-in fade-in slide-in-from-top-2">
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">To Account</label>
                <select 
                  value={toAccountId} 
                  onChange={e => setToAccountId(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-none focus:border-gray-900"
                >
                  <option value="">Select destination...</option>
                  {accounts.filter(a => a.id !== accountId).map(a => <option key={a.id} value={a.id}>{a.name} ({a.balance})</option>)}
                </select>
              </div>
            )}

            {/* Category */}
            {type !== 'transfer' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Category</label>
                <div className="grid grid-cols-3 gap-2">
                  {filteredCategories.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategoryId(c.id)}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-colors ${
                        categoryId === c.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600'
                      }`}
                    >
                      <span className="text-sm font-medium">{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Advanced Toggle */}
            <div className="pt-2">
              <button 
                type="button" 
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center justify-center w-full py-3 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
              >
                {showAdvanced ? <ChevronUp size={16} className="mr-2" /> : <ChevronDown size={16} className="mr-2" />}
                More options
              </button>
            </div>

            {/* Advanced Options */}
            {showAdvanced && (
              <div className="space-y-6 pt-2 pb-6 animate-in slide-in-from-top-4 fade-in duration-300 border-t border-gray-100">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Notes</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-900 outline-none focus:border-gray-900"
                    placeholder="What was this for?"
                  />
                </div>

                {type === 'expense' && (
                  <div className="bg-blue-50/50 p-5 rounded-xl border border-blue-100">
                    <label className="flex items-center mb-4">
                      <input 
                        type="checkbox" 
                        checked={isShared} 
                        onChange={e => setIsShared(e.target.checked)}
                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-3 font-medium text-gray-900">Shared Expense (Split)</span>
                    </label>
                    
                    {isShared && (
                      <div className="pl-8 animate-in fade-in slide-in-from-top-2">
                        <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">My Share (LKR)</label>
                        <input
                          type="number"
                          value={personalAmount}
                          onChange={e => setPersonalAmount(e.target.value)}
                          className="w-full p-3 bg-white border border-gray-200 rounded-xl font-medium text-gray-900 outline-none focus:border-blue-300"
                          placeholder="How much is actually yours?"
                        />
                        <p className="text-xs text-gray-500 mt-2">
                          The full {amount || '0'} will be deducted from your account, but only your share will count against your budget.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 bg-white">
          <button 
            type="submit" 
            form="tx-form"
            className="w-full py-4 bg-gray-900 text-white rounded-xl font-medium text-lg active:scale-[0.98] transition-transform"
          >
            Save Transaction
          </button>
        </div>

      </div>
    </div>
  );
}
