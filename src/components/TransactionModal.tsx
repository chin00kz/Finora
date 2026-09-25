import { useState, useEffect, useMemo, useRef } from 'react';
import { format, parse } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { X, ChevronDown, ChevronUp, Plus, Sparkles, AlertCircle } from 'lucide-react';
import { db } from '../db/db';
import type { TransactionType } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useUIStore } from '../store/uiStore';
import { triggerSync } from '../sync/syncEngine';
import { createId } from '../utils/createId';
import { formatMoney } from '../utils/formatters';
import QuickAddChips from './QuickAddChips';
import { useParticipantIdentities } from '../hooks/useParticipantIdentities';
import ParticipantPickerSheet from './ParticipantPickerSheet';
import { calculateSplit } from '../utils/splitEngine';
import { useVisualViewport } from '../hooks/useVisualViewport';

export default function TransactionModal() {
  const navigate = useNavigate();
  const {
    isAddTransactionModalOpen,
    setAddTransactionModalOpen,
    prefillData,
    setPrefillData,
  } = useUIStore();

  const { height: vvHeight, offsetTop, isKeyboardOpen } = useVisualViewport();

  const amountInputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prevent body scroll ONLY while modal is actually visible.
  // The component stays mounted when closed (returns null), so we must
  // gate on isAddTransactionModalOpen — not just component mount.
  useEffect(() => {
    if (!isAddTransactionModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isAddTransactionModalOpen]);

  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
  const [splitParticipants, setSplitParticipants] = useState<string[]>(['local:me']);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [isParticipantPickerOpen, setIsParticipantPickerOpen] = useState(false);
  const [excludeFromBudget, setExcludeFromBudget] = useState(false);
  const [txnDate, setTxnDate] = useState(() => format(Date.now(), 'yyyy-MM-dd'));
  const [txnTime, setTxnTime] = useState(() => format(Date.now(), 'HH:mm'));

  const [showNoteSuggestions, setShowNoteSuggestions] = useState(false);

  // Inline new-category form
  const PRESET_COLORS = ['#f43f5e', '#f97316', '#eab308', '#22c55e', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  const [newCatError, setNewCatError] = useState('');

  const accountsRaw = useLiveQuery(() => db.accounts.toArray());
  const accounts = accountsRaw || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const tags = useLiveQuery(() => db.tags.toArray()) || [];
  
  
  const { identities, groups, recentCombinations } = useParticipantIdentities();
  // Ensure "You" is always in the identities list
  const fullIdentities = [{ identityKey: 'local:me', name: 'You', isConnected: false }, ...identities];
  
  const allTransactions = useLiveQuery(() => db.transactions.toArray()) || [];

  const [autoFillIndicator, setAutoFillIndicator] = useState<string | null>(null);

  const splitMath = useMemo(() => {
    if (!isShared || splitParticipants.length === 0) return null;
    const numAmt = parseFloat(amount) || 0;
    
    const inputs = splitParticipants.map(id => ({
      personId: id,
      baseAmount: splitMode === 'custom' ? parseFloat(customAmounts[id]) || 0 : 0
    }));
    
    try {
      const results = calculateSplit(numAmt, inputs, splitMode);
      
      const myShare = results.find(r => r.personId === 'local:me')?.finalAmount || 0;
      const othersOwe = results.filter(r => r.personId !== 'local:me').reduce((s, r) => s + r.finalAmount, 0);
      const sharedRemainder = results[0]?.sharedAmount ? (results[0].sharedAmount * results.length) : 0;
      
      return { results, total: numAmt, myShare, othersOwe, sharedRemainder, error: null };
    } catch (err: any) {
      return { results: [], total: numAmt, myShare: 0, othersOwe: 0, sharedRemainder: 0, error: err.message };
    }
  }, [isShared, amount, splitParticipants, customAmounts, splitMode]);


  // Build merchant memory mapping: lowercased note -> most recent transaction details
  const merchantMemory = useMemo(() => {
    const map = new Map<string, {
      canonicalNote: string;
      txn: typeof allTransactions[0];
      category?: typeof categories[0];
      account?: typeof accounts[0];
      tagNames: string[];
    }>();

    // Sort transactions by date descending so the first entry for a note is the most recent
    const sorted = [...allTransactions].sort((a, b) => (b.date || 0) - (a.date || 0));

    for (const t of sorted) {
      const rawNote = t.notes?.trim();
      if (!rawNote) continue;
      const key = rawNote.toLowerCase();
      if (!map.has(key)) {
        const cat = categories.find(c => c.id === t.categoryId);
        const acc = accounts.find(a => a.id === t.accountId);
        const tagNames = (t.tagIds || [])
          .map(tid => tags.find(tag => tag.id === tid)?.name)
          .filter(Boolean) as string[];

        map.set(key, {
          canonicalNote: rawNote,
          txn: t,
          category: cat,
          account: acc,
          tagNames,
        });
      }
    }
    return map;
  }, [allTransactions, categories, accounts, tags]);

  const filteredSuggestions = useMemo(() => {
    if (!notes.trim()) return [];
    const query = notes.trim().toLowerCase();
    const results = [];
    for (const [key, item] of merchantMemory.entries()) {
      if (key.includes(query) && key !== query) {
        results.push(item);
      }
      if (results.length >= 6) break;
    }
    return results;
  }, [notes, merchantMemory]);

  const applyMerchantMemory = (item: {
    canonicalNote: string;
    txn: typeof allTransactions[0];
    category?: typeof categories[0];
    account?: typeof accounts[0];
    tagNames: string[];
  }) => {
    setNotes(item.canonicalNote);
    setShowNoteSuggestions(false);

    const filledDetails: string[] = [];

    // Auto-select category if valid
    if (item.category) {
      setCategoryId(item.category.id);
      filledDetails.push(item.category.name);
    }

    // Auto-select account if valid
    if (item.account) {
      setAccountId(item.account.id);
      filledDetails.push(item.account.name);
    }

    // Auto-set transaction type if not a transfer
    if (item.txn.type && item.txn.type !== 'transfer') {
      setType(item.txn.type);
    }

    // Auto-select tags if available
    if (item.tagNames && item.tagNames.length > 0) {
      setSelectedTags(item.tagNames);
      filledDetails.push(item.tagNames.map(t => `#${t}`).join(' '));
    }

    // Smart Amount Memory: Auto-fill amount if empty or 0
    if (item.txn.amount && (!amount || amount === '0')) {
      setAmount(item.txn.amount.toString());
      filledDetails.push(formatMoney(item.txn.amount));
      setTimeout(() => {
        amountInputRef.current?.select();
      }, 50);
    }

    if (filledDetails.length > 0) {
      setAutoFillIndicator(`Auto-filled: ${filledDetails.join(' • ')}`);
      setTimeout(() => setAutoFillIndicator(null), 3000);
    }
  };

  // Consume prefillData if opened via QuickAdd or Activity Repeat
  useEffect(() => {
    if (isAddTransactionModalOpen && prefillData) {
      if (prefillData.notes !== undefined) setNotes(prefillData.notes);
      if (prefillData.amount !== undefined) setAmount(prefillData.amount.toString());
      if (prefillData.categoryId !== undefined) setCategoryId(prefillData.categoryId);
      if (prefillData.accountId !== undefined) setAccountId(prefillData.accountId);
      if (prefillData.type !== undefined) setType(prefillData.type);
      if (prefillData.tagIds && prefillData.tagIds.length > 0) {
        const tagNames = prefillData.tagIds
          .map(tid => tags.find(t => t.id === tid)?.name)
          .filter(Boolean) as string[];
        setSelectedTags(tagNames);
      }
      setTimeout(() => {
        amountInputRef.current?.select();
      }, 80);
      setPrefillData(null);
    }
  }, [isAddTransactionModalOpen, prefillData, tags, setPrefillData]);

  useEffect(() => {
    if (!isAddTransactionModalOpen && blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    if (isAddTransactionModalOpen) {
      setTxnDate(format(Date.now(), 'yyyy-MM-dd'));
      setTxnTime(format(Date.now(), 'HH:mm'));
    }
  }, [isAddTransactionModalOpen]);

  const filteredCategories = categories.filter(c => c.type === (type === 'transfer' ? 'expense' : type));

  // Set sensible defaults once data arrives and reconcile stale selections
  useEffect(() => {
    if (accounts.length === 0) return;
    if (!accountId || !accounts.some(a => a.id === accountId)) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  useEffect(() => {
    if (type === 'transfer') return;
    if (filteredCategories.length === 0) {
      if (categoryId !== '') setCategoryId('');
      return;
    }
    if (!categoryId || !filteredCategories.some(c => c.id === categoryId)) {
      setCategoryId(filteredCategories[0].id);
    }
  }, [filteredCategories, categoryId, type]);

  // Shared helper for creating a new category inline.
  // Called by both the Enter-key handler and the Save button (was duplicated twice).
  const handleSaveNewCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    const catType = type as 'expense' | 'income';
    const dup = categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.type === catType);
    if (dup) { setNewCatError(`A ${catType} category named "${name}" already exists.`); return; }
    const id = createId('cat');
    await db.categories.add({ id, name, type: catType, icon: 'tag', color: newCatColor, updatedAt: Date.now() });
    triggerSync('categories', id);
    setCategoryId(id);
    setNewCatName('');
    setNewCatError('');
    setShowNewCat(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (accounts.length === 0 || !accountId) return;
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;

    // Strict submit-time validation for data integrity
    if (type !== 'transfer') {
      const validCategory = categories.find(c => c.id === categoryId);
      if (!validCategory || validCategory.type !== type) {
        return; // Reject invalid category state
      }
    }

    setIsSubmitting(true);
    const numAmount = Number(amount);

    try {
      const txnId = createId('txn');
      // Resolve tags (create if new)
      const tagsToProcess = [...selectedTags];
      if (tagInput.trim() && !tagsToProcess.includes(tagInput.trim())) {
        tagsToProcess.push(tagInput.trim());
      }

      await db.transaction('rw', [db.transactions, db.accounts, db.tags, db.debts, db.people, db.sharedOutbox], async () => {
        const resolvedTagIds: string[] = [];
        for (const tagName of tagsToProcess) {
          const allTags = await db.tags.toArray();
          const existingTag = allTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
          if (existingTag) {
            resolvedTagIds.push(existingTag.id);
          } else {
            const newId = createId('tag');
            await db.tags.add({ id: newId, name: tagName, updatedAt: Date.now() });
            resolvedTagIds.push(newId);
          }
        }

        let txDateObj = new Date();
        try {
          if (txnDate && txnTime) {
            txDateObj = parse(`${txnDate} ${txnTime}`, 'yyyy-MM-dd HH:mm', new Date());
          }
        } catch (e) {
          txDateObj = new Date();
        }
        const now = txDateObj.getTime();

        // 1. Add transaction record
          const finalSplitDetails = isShared && splitMath && !splitMath.error ? splitMath.results.map(r => ({
            personId: r.personId,
            participantNameSnapshot: fullIdentities.find(i => i.identityKey === r.personId)?.name || 'Unknown',
            baseAmount: r.baseAmount,
            sharedAmount: r.sharedAmount,
            finalAmount: r.finalAmount
          })) : undefined;

          const finalSyncStatus = isShared && splitMath && !splitMath.error ? 'pending' : 'none';

          await db.transactions.add({
            id: txnId,
            type,
            amount: numAmount,
            date: now,
            accountId,
            categoryId: type !== 'transfer' ? categoryId : undefined,
            notes,
            tagIds: resolvedTagIds.length > 0 ? resolvedTagIds : undefined,
            toAccountId: type === 'transfer' ? toAccountId : undefined,
            isShared,
            personalAmount: isShared && splitMath && !splitMath.error ? splitMath.myShare : undefined,
            splitDetails: finalSplitDetails,
            splitStatus: finalSyncStatus,
            excludeFromBudget: type === 'expense' ? excludeFromBudget : undefined,
            updatedAt: now,
          });

          // 2. Auto-generate shared obligations (Local Debts + Cloud Outbox)
          if (type === 'expense' && isShared && splitMath && !splitMath.error) {
            
            const cloudPayloads = [];

            for (const result of splitMath.results) {
              if (result.personId === 'local:me' || result.finalAmount <= 0) continue;

              const snapshotName = fullIdentities.find(i => i.identityKey === result.personId)?.name || 'Unknown';
              
              if (result.personId.startsWith('local:')) {
                const localId = result.personId.replace('local:', '');
                await db.debts.add({
                  id: createId('debt'),
                  source: 'shared_expense',
                  direction: 'theyOweMe',
                  personId: localId,
                  personName: snapshotName,
                  amount: result.finalAmount,
                  note: notes ? `Split: ${notes}` : 'Shared expense split',
                  date: now,
                  relatedTransactionId: txnId,
                  settlements: [],
                  updatedAt: now,
                });
              } else if (result.personId.startsWith('profile:')) {
                const profileId = result.personId.replace('profile:', '');
                cloudPayloads.push({
                  id: createId('siou'),
                  debtor_id: profileId,
                  amount: result.finalAmount,
                  description: notes ? `Split: ${notes}` : 'Shared expense split'
                });
              }
            }

            if (cloudPayloads.length > 0) {
              await db.sharedOutbox.add({
                id: createId('outbox'),
                operation_type: 'propose_split',
                idempotency_key: txnId,
                payload: {
                  transaction_id: txnId,
                  splits: cloudPayloads
                },
                status: 'queued',
                retry_count: 0,
                created_at: now
              });
            } else {
              await db.transactions.update(txnId, { splitStatus: 'synced' });
            }
          }

          // 3. Update account balances
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

      // Trigger cloud sync for this specific record
      triggerSync('transactions', txnId);
      triggerSync('accounts', accountId);
      if (type === 'transfer' && toAccountId) {
        triggerSync('accounts', toAccountId);
      }

      // Reset & close
      setAmount('');
      setNotes('');
      setSelectedTags([]);
      setTagInput('');
      setShowAdvanced(false);
      setIsShared(false);
      setSplitMode('equal');
      setSplitParticipants(['local:me']);
      setCustomAmounts({});
      setExcludeFromBudget(false);
      setAutoFillIndicator(null);
      setAddTransactionModalOpen(false);
    } catch (error) {
      console.error("Failed to save transaction", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAddTransactionModalOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="absolute w-full flex flex-col justify-end pointer-events-none"
        style={{
          height: vvHeight ? `${vvHeight}px` : '100%',
          top: offsetTop ? `${offsetTop}px` : 0,
        }}
      >
        <div
          className="pointer-events-auto bg-card w-full max-w-md mx-auto rounded-t-3xl shadow-xl flex flex-col max-h-full animate-in slide-in-from-bottom-full duration-300"
          style={{ height: isKeyboardOpen ? '100%' : '85vh' }}
        >
          {/* Header */}
          <div className="flex justify-between items-center p-5 border-b border-border shrink-0">
            <h2 className="text-xl font-medium text-foreground">New Transaction</h2>
            <button onClick={() => setAddTransactionModalOpen(false)} className="p-2 bg-muted rounded-full text-muted-foreground active:scale-95">
              <X size={20} />
            </button>
          </div>

          {/* Form Content - Scrollable */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            <form id="tx-form" onSubmit={handleSubmit} className="p-6 space-y-6">

            {/* Zero-accounts prompt */}
            {accountsRaw !== undefined && accounts.length === 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
                <AlertCircle size={18} className="text-amber-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground">No accounts found</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    You need at least one account (e.g. Cash, Bank) to record transactions and track balances.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAddTransactionModalOpen(false);
                      navigate('/accounts');
                    }}
                    className="mt-2.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-400 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                  >
                    <span>Create an Account</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            )}

            {/* Quick-Add Favorite Chips */}
            <QuickAddChips
              onSelectCandidate={(candidate) => {
                setNotes(candidate.canonicalNote);
                setAmount(candidate.amount.toString());
                if (candidate.categoryId) setCategoryId(candidate.categoryId);
                if (candidate.accountId) setAccountId(candidate.accountId);
                if (candidate.type) setType(candidate.type);
                if (candidate.tagIds && candidate.tagIds.length > 0) {
                  const tagNames = candidate.tagIds
                    .map(tid => tags.find(t => t.id === tid)?.name)
                    .filter(Boolean) as string[];
                  setSelectedTags(tagNames);
                }
                setAutoFillIndicator(`Selected: ${candidate.canonicalNote} · ${formatMoney(candidate.amount)}`);
                setTimeout(() => {
                  amountInputRef.current?.select();
                  setAutoFillIndicator(null);
                }, 100);
              }}
            />

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
                  ref={amountInputRef}
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

            {/* Notes with Merchant Memory */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  What is it for?
                </label>
                {autoFillIndicator && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-accent animate-in fade-in">
                    <Sparkles size={11} />
                    <span>{autoFillIndicator}</span>
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  onFocus={() => setShowNoteSuggestions(true)}
                  onBlur={() => {
                    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                    blurTimeoutRef.current = setTimeout(() => {
                      setShowNoteSuggestions(false);
                      const key = notes.trim().toLowerCase();
                      if (key && merchantMemory.has(key)) {
                        applyMerchantMemory(merchantMemory.get(key)!);
                      }
                    }, 200);
                  }}
                  className="w-full p-4 bg-background border border-border rounded-xl font-medium text-foreground outline-none focus:border-foreground"
                  placeholder="e.g. Keells, Uber, Coffee"
                />
                {showNoteSuggestions && filteredSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-xl z-20 max-h-52 overflow-y-auto divide-y divide-border/40">
                    {filteredSuggestions.map(item => (
                      <button
                        key={item.canonicalNote}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyMerchantMemory(item);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-muted/70 flex items-center justify-between transition-colors group"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-sm font-medium text-foreground group-hover:text-accent transition-colors truncate">
                            {item.canonicalNote}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                            {item.category && (
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.category.color }} />
                                <span>{item.category.name}</span>
                              </span>
                            )}
                            {item.account && (
                              <span>• {item.account.name}</span>
                            )}
                            {item.tagNames.length > 0 && (
                              <span className="text-accent/80">• {item.tagNames.map(t => `#${t}`).join(' ')}</span>
                            )}
                          </div>
                        </div>
                        <span className="shrink-0 text-[10px] font-semibold text-muted-foreground/70 bg-muted px-2 py-1 rounded-md">
                          Auto-fill
                        </span>
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
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {formatMoney(a.balance)}</option>)}
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
                  {accounts.filter(a => a.id !== accountId).map(a => <option key={a.id} value={a.id}>{a.name} — {formatMoney(a.balance)}</option>)}
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
                      onClick={() => { setCategoryId(c.id); setShowNewCat(false); }}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-colors ${
                        categoryId === c.id ? 'border-foreground bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground'
                      }`}
                    >
                      <span className="text-sm font-medium">{c.name}</span>
                    </button>
                  ))}
                  {/* ＋ New category tile */}
                  <button
                    type="button"
                    onClick={() => setShowNewCat(v => !v)}
                    className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-colors gap-1 ${
                      showNewCat ? 'border-foreground bg-accent text-accent-foreground' : 'border-dashed border-border text-muted-foreground'
                    }`}
                  >
                    <Plus size={16} />
                    <span className="text-xs font-medium">New</span>
                  </button>
                </div>

                {/* Inline new-category form */}
                {showNewCat && (
                  <div className="mt-3 p-4 bg-muted/50 border border-border rounded-xl space-y-3 animate-in slide-in-from-top-2 fade-in duration-200">
                    <input
                      type="text"
                      value={newCatName}
                      onChange={e => { setNewCatName(e.target.value); setNewCatError(''); }}
                      onKeyDown={async e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          await handleSaveNewCategory();
                        }
                      }}
                      autoFocus
                      placeholder="Category name…"
                      className="w-full p-3 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
                    />
                    <div className="flex gap-2 flex-wrap">
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => { setNewCatColor(c); setNewCatError(''); }}
                          className={`w-7 h-7 rounded-full transition-transform active:scale-90 ${newCatColor === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : ''}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    {newCatError && <p className="text-xs text-red-500 font-medium">{newCatError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!newCatName.trim()}
                        onClick={handleSaveNewCategory}
                        className="flex-1 py-2 bg-accent text-accent-foreground rounded-xl text-sm font-medium active:scale-[0.98] transition-transform disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowNewCat(false); setNewCatName(''); setNewCatError(''); }}
                        className="px-4 py-2 bg-background border border-border rounded-xl text-sm font-medium text-muted-foreground active:scale-[0.98] transition-transform"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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
                  <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Date & Time</label>
                  <div className="flex gap-3">
                    <input
                      type="date"
                      value={txnDate}
                      onChange={e => setTxnDate(e.target.value)}
                      className="flex-1 bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-foreground"
                    />
                    <input
                      type="time"
                      value={txnTime}
                      onChange={e => setTxnTime(e.target.value)}
                      className="flex-1 bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-foreground"
                    />
                  </div>
                </div>

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
                  <>
                    <div className="bg-amber-500/10 p-5 rounded-xl border border-amber-500/20">
                      <label className="flex items-start cursor-pointer">
                        <input
                          type="checkbox"
                          checked={excludeFromBudget}
                          onChange={e => setExcludeFromBudget(e.target.checked)}
                          className="w-5 h-5 mt-0.5 rounded border-border text-amber-500 focus:ring-amber-500"
                        />
                        <div className="ml-3">
                          <span className="font-medium text-foreground text-sm block">Exclude from Budget</span>
                          <span className="text-xs text-muted-foreground block mt-0.5">
                            Deducts from your account balance, but won't count against your active budget pace (for emergency/one-off expenses).
                          </span>
                        </div>
                      </label>
                    </div>

                    <div>
                      <label className="flex items-center cursor-pointer gap-3">
                        <input
                          type="checkbox"
                          checked={isShared}
                          onChange={e => setIsShared(e.target.checked)}
                          className="w-5 h-5 rounded border-border text-blue-500 focus:ring-blue-500 shrink-0"
                        />
                        <span className="font-medium text-foreground text-sm">Split this expense</span>
                      </label>

                      {isShared && (
                        <div className="mt-4 ml-8 animate-in fade-in slide-in-from-top-2">
                          {splitParticipants.filter(p => p !== 'local:me').length === 0 ? (
                            <div className="flex items-center gap-3">
                              <p className="text-sm text-muted-foreground flex-1">Split this with other people.</p>
                              <button
                                type="button"
                                onClick={() => setIsParticipantPickerOpen(true)}
                                className="text-sm font-medium text-blue-500 bg-blue-500/10 px-3 py-1.5 rounded-lg shrink-0"
                              >
                                Add People
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {/* Mode toggle + Add more */}
                              <div className="flex items-center justify-between">
                                <div className="flex bg-muted p-1 rounded-lg">
                                  <button type="button" onClick={() => setSplitMode('equal')} className={`px-3 py-1 text-xs font-medium rounded-md ${splitMode === 'equal' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}>Equal</button>
                                  <button type="button" onClick={() => setSplitMode('custom')} className={`px-3 py-1 text-xs font-medium rounded-md ${splitMode === 'custom' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}>Custom</button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setIsParticipantPickerOpen(true)}
                                  className="text-xs font-medium text-blue-500 px-2 py-1"
                                >
                                  + Add
                                </button>
                              </div>

                              {/* Participants list */}
                              <div className="space-y-2.5">
                                {splitParticipants.map(key => {
                                  const isMe = key === 'local:me';
                                  const iden = fullIdentities.find(i => i.identityKey === key);
                                  const name = isMe ? 'You' : (iden?.name || 'Unknown');
                                  const finalAmt = splitMath?.results?.find(r => r.personId === key)?.finalAmount || 0;
                                  return (
                                    <div key={key} className="flex items-center gap-2.5">
                                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs shrink-0 ${isMe ? 'bg-muted text-foreground' : 'bg-blue-500/10 text-blue-500'}`}>
                                        {name.charAt(0).toUpperCase()}
                                      </div>
                                      <p className="flex-1 text-sm font-medium text-foreground truncate min-w-0">{name}</p>
                                      {splitMode === 'custom' ? (
                                        <div className="w-24 shrink-0">
                                          <input
                                            type="number"
                                            inputMode="decimal"
                                            placeholder="Base"
                                            value={customAmounts[key] || ''}
                                            onChange={e => setCustomAmounts(prev => ({ ...prev, [key]: e.target.value }))}
                                            className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm font-medium text-right outline-none focus:border-blue-500"
                                          />
                                        </div>
                                      ) : (
                                        <span className="text-sm font-medium text-muted-foreground shrink-0">{formatMoney(finalAmt)}</span>
                                      )}
                                      {isMe ? (
                                        <div className="w-[26px] shrink-0" />
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => setSplitParticipants(prev => prev.filter(k => k !== key))}
                                          className="p-1.5 text-muted-foreground hover:bg-muted rounded-full shrink-0"
                                        >
                                          <X size={14} />
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Math summary — typography-focused, no nested card */}
                              {splitMath && !splitMath.error && (
                                <div className="pt-3 border-t border-border/50 space-y-1">
                                  {splitMode === 'equal' && (
                                    <p className="text-xs text-muted-foreground pb-1">{formatMoney(splitMath.results[0]?.finalAmount || 0)} each</p>
                                  )}
                                  {splitMode === 'custom' && splitMath.sharedRemainder > 0 && (
                                    <p className="text-xs text-muted-foreground pb-1">{formatMoney(splitMath.sharedRemainder)} shared fees split equally</p>
                                  )}
                                  <div className="flex justify-between items-baseline text-sm font-medium text-foreground">
                                    <span>Your share</span>
                                    <span>{formatMoney(splitMath.myShare)}</span>
                                  </div>
                                  <div className="flex justify-between items-baseline text-sm font-medium text-green-500">
                                    <span>Others owe you</span>
                                    <span>{formatMoney(splitMath.othersOwe)}</span>
                                  </div>
                                </div>
                              )}
                              {splitMath?.error && (
                                <p className="text-sm text-red-500 font-medium">{splitMath.error}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </form>

          {/* Footer stays permanently inside the scroll area, pushed to the bottom by the flex-1 form */}
          <div
            className="p-5 border-t border-border bg-card mt-auto shrink-0"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <button
              type="submit"
              form="tx-form"
              disabled={isSubmitting || accounts.length === 0 || !amount || isNaN(Number(amount)) || Number(amount) <= 0 || !accountId}
              className="w-full py-4 bg-accent text-accent-foreground rounded-xl font-medium text-lg active:scale-[0.98] transition-transform disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span className="w-5 h-5 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                  <span>Saving…</span>
                </>
              ) : (
                <span>Save Transaction</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
      <ParticipantPickerSheet
        isOpen={isParticipantPickerOpen}
        onClose={() => setIsParticipantPickerOpen(false)}
        identities={fullIdentities}
        groups={groups}
        recentCombinations={recentCombinations}
        selectedKeys={splitParticipants}
        onSelectMultiple={(keys) => {
            // Always keep 'local:me' at the front — group shortcuts must not eject the payer
            const others = keys.filter(k => k !== 'local:me');
            setSplitParticipants(['local:me', ...others]);
          }}
        onToggleSelection={(key) => {
          if (key === 'local:me') return; // payer cannot be removed via picker
          setSplitParticipants(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
          );
        }}
      />
    </>
  );
}