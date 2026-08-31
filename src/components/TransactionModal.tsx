import { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { db } from '../db/db';
import type { TransactionType } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useUIStore } from '../store/uiStore';
import { triggerSync } from '../sync/syncEngine';

export default function TransactionModal() {
  const { isAddTransactionModalOpen, setAddTransactionModalOpen } = useUIStore();
  
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [notes, setNotes] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  
  const [toAccountId, setToAccountId] = useState(''); // For transfers
  const [isShared, setIsShared] = useState(false);
  const [personalAmount, setPersonalAmount] = useState(''); // For shared expenses

  const [showNoteSuggestions, setShowNoteSuggestions] = useState(false);

  const accounts = useLiveQuery(() => db.accounts.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const tags = useLiveQuery(() => db.tags.toArray()) || [];
  const allTransactions = useLiveQuery(() => db.transactions.toArray()) || [];
  
  const pastNotes = Array.from(new Set(allTransactions.map(t => t.notes?.trim()).filter(Boolean))) as string[];
  const filteredNotes = notes
    ? pastNotes.filter(n => n.toLowerCase().includes(notes.toLowerCase()) && n.toLowerCase() !== notes.toLowerCase())
    : [];

  const filteredCategories = categories.filter(c => c.type === (type === 'transfer' ? 'expense' : type));

  // Set sensible defaults once data arrives — must be in useEffect, not during render
  useEffect(() => {
    if (accounts.length > 0 && !accountId) setAccountId(accounts[0].id);
  }, [accounts]);

  useEffect(() => {
    if (filteredCategories.length > 0 && !categoryId && type !== 'transfer') {
      setCategoryId(filteredCategories[0].id);
    }
  }, [filteredCategories.length, type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return;

    const numAmount = Number(amount);

    try {
      await db.transaction('rw', db.transactions, db.accounts, db.tags, async () => {
        // Resolve tags (create if new)
        const tagsToProcess = [...selectedTags];
        if (tagInput.trim() && !tagsToProcess.includes(tagInput.trim())) {
          tagsToProcess.push(tagInput.trim());
        }

        const resolvedTagIds: string[] = [];
        for (const tagName of tagsToProcess) {
          const allTags = await db.tags.toArray();
          const existingTag = allTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
          if (existingTag) {
            resolvedTagIds.push(existingTag.id);
          } else {
            const newId = `tag-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            await db.tags.add({ id: newId, name: tagName, updatedAt: Date.now() });
            resolvedTagIds.push(newId);
          }
        }

        const now = Date.now();

        // 1. Add transaction record
        await db.transactions.add({
          id: `txn-${now}`,
          type,
          amount: numAmount,
          date: now,
          accountId,
          categoryId: type !== 'transfer' ? categoryId : undefined,
          notes,
          tagIds: resolvedTagIds.length > 0 ? resolvedTagIds : undefined,
          toAccountId: type === 'transfer' ? toAccountId : undefined,
          isShared,
          personalAmount: isShared ? Number(personalAmount) : undefined,
          updatedAt: now,
        });

        // 2. Update account balances
        const fromAcc = await db.accounts.get(accountId);
        if (fromAcc) {
          if (type === 'expense') {
            await db.accounts.update(accountId, { balance: fromAcc.balance - numAmount, updatedAt: now });
          } else if (type === 'income') {
            await db.accounts.update(accountId, { balance: fromAcc.balance + numAmount, updatedAt: now });
          } else if (type === 'transfer' && toAccountId) {
            const toAcc = await db.accounts.get(toAccountId);
            if (toAcc) {
              await db.accounts.update(accountId, { balance: fromAcc.balance - numAmount, updatedAt: now });
              await db.accounts.update(toAccountId, { balance: toAcc.balance + numAmount, updatedAt: now });
            }
          }
        }
      });

      // Trigger cloud sync in background
      triggerSync();

      // Reset & close
      setAmount('');
      setNotes('');
      setSelectedTags([]);
      setTagInput('');
      setShowAdvanced(false);
      setIsShared(false);
      setPersonalAmount('');
      setAddTransactionModalOpen(false);
    } catch (error) {
      console.error("Failed to save transaction", error);
    }
  };

  if (!isAddTransactionModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col h-[85vh] animate-in slide-in-from-bottom-full duration-300">
        
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-border">
          <h2 className="text-xl font-medium text-foreground">New Transaction</h2>
          <button onClick={() => setAddTransactionModalOpen(false)} className="p-2 bg-muted rounded-full text-muted-foreground active:scale-95">
            <X size={20} />
          </button>
        </div>

        {/* Form Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          <form id="tx-form" onSubmit={handleSubmit} className="p-6 space-y-6">
            
            {/* Type Selector */}
            <div className="flex bg-muted p-1 rounded-xl">
              {(['expense', 'income', 'transfer'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg capitalize transition-colors ${
                    type === t ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Amount</label>
              <div className="flex items-center text-5xl font-light">
                <span className="text-2xl text-muted-foreground mr-2">LKR</span>
                <input
                  type="number"
                  inputMode="decimal"
                  autoFocus
                  required
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/50"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">What is it for?</label>
              <div className="relative">
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  onFocus={() => setShowNoteSuggestions(true)}
                  onBlur={() => setShowNoteSuggestions(false)}
                  className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                  placeholder="Optional description"
                />
                {showNoteSuggestions && filteredNotes.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                    {filteredNotes.map(n => (
                      <button
                        key={n}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault(); // prevent blur before click
                          setNotes(n);
                          setShowNoteSuggestions(false);
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-muted text-foreground text-sm"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* From Account */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                {type === 'transfer' ? 'From Account' : 'Account'}
              </label>
              <select 
                value={accountId} 
                onChange={e => setAccountId(e.target.value)}
                className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
              >
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — LKR {a.balance.toLocaleString()}</option>)}
              </select>
            </div>

            {/* To Account (Transfers) */}
            {type === 'transfer' && (
              <div className="animate-in fade-in slide-in-from-top-2">
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">To Account</label>
                <select 
                  value={toAccountId} 
                  onChange={e => setToAccountId(e.target.value)}
                  className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                >
                  <option value="">Select destination...</option>
                  {accounts.filter(a => a.id !== accountId).map(a => <option key={a.id} value={a.id}>{a.name} — LKR {a.balance.toLocaleString()}</option>)}
                </select>
              </div>
            )}

            {/* Category */}
            {type !== 'transfer' && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Category</label>
                <div className="grid grid-cols-3 gap-2">
                  {filteredCategories.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategoryId(c.id)}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-colors ${
                        categoryId === c.id ? 'border-foreground bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground'
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
                className="flex items-center justify-center w-full py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAdvanced ? <ChevronUp size={16} className="mr-2" /> : <ChevronDown size={16} className="mr-2" />}
                More options
              </button>
            </div>

            {/* Advanced Options */}
            {showAdvanced && (
              <div className="space-y-6 pt-2 pb-6 animate-in slide-in-from-top-4 fade-in duration-300 border-t border-border">

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Tags</label>
                  <div className="p-3 bg-background border border-border rounded-xl min-h-[56px] flex flex-wrap gap-2 items-center focus-within:border-foreground">
                    {selectedTags.map(tag => (
                      <span key={tag} className="flex items-center bg-muted text-foreground px-2 py-1 rounded-md text-sm">
                        #{tag}
                        <button type="button" onClick={() => setSelectedTags(selectedTags.filter(t => t !== tag))} className="ml-1 text-muted-foreground hover:text-foreground">
                          <X size={14} />
                        </button>
                      </span>
                    ))}
                    <div className="relative flex-1 min-w-[120px]">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && tagInput.trim()) {
                            e.preventDefault();
                            if (!selectedTags.includes(tagInput.trim())) {
                              setSelectedTags([...selectedTags, tagInput.trim()]);
                            }
                            setTagInput('');
                          }
                        }}
                        className="w-full bg-transparent text-foreground outline-none text-sm"
                        placeholder={selectedTags.length === 0 ? "Add tags..." : ""}
                      />
                      {tagInput && tags.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                          {tags
                            .filter(t => t.name.toLowerCase().includes(tagInput.toLowerCase()) && !selectedTags.includes(t.name))
                            .map(t => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  setSelectedTags([...selectedTags, t.name]);
                                  setTagInput('');
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-muted text-foreground text-sm"
                              >
                                #{t.name}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {type === 'expense' && (
                  <div className="bg-blue-500/10 p-5 rounded-xl border border-blue-500/20">
                    <label className="flex items-center mb-4">
                      <input 
                        type="checkbox" 
                        checked={isShared} 
                        onChange={e => setIsShared(e.target.checked)}
                        className="w-5 h-5 rounded border-border text-blue-500 focus:ring-blue-500"
                      />
                      <span className="ml-3 font-medium text-foreground">Shared Expense (Split)</span>
                    </label>
                    
                    {isShared && (
                      <div className="pl-8 animate-in fade-in slide-in-from-top-2">
                        <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">My Share (LKR)</label>
                        <input
                          type="number"
                          value={personalAmount}
                          onChange={e => setPersonalAmount(e.target.value)}
                          className="w-full p-3 bg-card border border-border rounded-xl font-medium text-foreground outline-none focus:border-blue-500"
                          placeholder="How much is actually yours?"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
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
        <div className="p-5 border-t border-border bg-card">
          <button 
            type="submit" 
            form="tx-form"
            className="w-full py-4 bg-accent text-accent-foreground rounded-xl font-medium text-lg active:scale-[0.98] transition-transform"
          >
            Save Transaction
          </button>
        </div>

      </div>
    </div>
  );
}
