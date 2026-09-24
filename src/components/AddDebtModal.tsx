import { createId } from '../utils/createId';
import React, { useState, useEffect } from 'react';
import { X, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { db, type DebtDirection } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { triggerSync } from '../sync/syncEngine';
import { supabase } from '../lib/supabase';
import { syncSharedIous } from '../sync/sharedIouSync';
import { useAuthStore } from '../store/authStore';
import { syncConnections } from '../sync/connectionSync';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultDirection?: DebtDirection;
}

interface RecipientChoice {
  type: 'friend' | 'local';
  id: string; // profileId or personId
  displayName: string;
  username?: string;
  localPersonId?: string;
}

export default function AddDebtModal({ isOpen, onClose, defaultDirection = 'theyOweMe' }: Props) {
  const user = useAuthStore(state => state.user);
  const people = useLiveQuery(() => db.people.toArray()) || [];
  const cacheConnections = useLiveQuery(() => db.cacheConnections.toArray()) || [];
  const cacheProfiles = useLiveQuery(() => db.cacheProfiles.toArray()) || [];

  const [direction, setDirection] = useState<DebtDirection>(defaultDirection);
  const [personName, setPersonName] = useState('');
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isSharedOptIn, setIsSharedOptIn] = useState(false);
  const [isPersonDropdownOpen, setIsPersonDropdownOpen] = useState(false);

  // Hydrate connections on open
  useEffect(() => {
    if (isOpen && user) {
      syncConnections(user.id).catch(console.error);
    }
  }, [isOpen, user]);

  // Compute available recipients
  const availableRecipients: RecipientChoice[] = [];
  const acceptedConns = cacheConnections.filter(c => c.status === 'accepted');

  acceptedConns.forEach(c => {
    const friendId = c.user_a === user?.id ? c.user_b : c.user_a;
    const prof = cacheProfiles.find(p => p.id === friendId);
    if (prof) {
      const linkedPerson = people.find(p => p.connection_id === c.id);
      availableRecipients.push({
        type: 'friend',
        id: friendId,
        displayName: prof.display_name || 'Unknown',
        username: prof.username,
        localPersonId: linkedPerson?.id
      });
    }
  });

  people.forEach(p => {
    if (p.connection_id) {
      const conn = cacheConnections.find(c => c.id === p.connection_id && c.status === 'accepted');
      if (conn) return; // already added above
    }
    availableRecipients.push({
      type: 'local',
      id: p.id,
      displayName: p.name,
    });
  });

  const search = personName.trim().toLowerCase();
  const filteredRecipients = availableRecipients.filter(r => {
    if (!search) return true;
    return r.displayName.toLowerCase().includes(search) || r.username?.toLowerCase().includes(search);
  });

  let finalRecipient: RecipientChoice | null = null;
  if (selectedRecipientId) {
    finalRecipient = availableRecipients.find(r => r.id === selectedRecipientId) || null;
  } else if (search) {
    const exactMatch = filteredRecipients.find(r => r.displayName.toLowerCase() === search || r.username?.toLowerCase() === search);
    if (exactMatch) {
      finalRecipient = exactMatch;
    }
  }

  const targetFriendId = finalRecipient?.type === 'friend' ? finalRecipient.id : null;
  const targetFriendUsername = finalRecipient?.type === 'friend' ? finalRecipient.username : null;
  const canShare = !!targetFriendId && direction === 'theyOweMe'; // Shared IOUs V1 only support "theyOweMe"

  useEffect(() => {
    if (!canShare) {
      setIsSharedOptIn(false);
    }
  }, [canShare]);

  const handleClose = () => {
    setPersonName('');
    setSelectedRecipientId(null);
    setAmount('');
    setNote('');
    setError('');
    setIsSharedOptIn(false);
    setDirection(defaultDirection);
    setIsPersonDropdownOpen(false);
    onClose();
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Number(amount);

    if (!personName.trim()) {
      setError('Please specify a person name.');
      return;
    }
    if (!numAmount || numAmount <= 0 || isNaN(numAmount)) {
      setError('Please enter a valid amount.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    if (canShare && isSharedOptIn) {
      if (!navigator.onLine) {
        setError('You must be online to send a Shared IOU request.');
        setIsSubmitting(false);
        return;
      }

      try {
        const { error: rpcError } = await supabase.rpc('create_shared_iou', {
          p_debtor_id: targetFriendId,
          p_amount: numAmount,
          p_currency: 'LKR',
          p_description: note.trim() || undefined
        });

        if (rpcError) throw rpcError;

        syncSharedIous().catch(e => console.error("Sync failed after creation", e));

        handleClose();
        return;
      } catch (err: any) {
        console.error('Failed to create shared IOU', err);
        setError(err?.message || 'Failed to send Shared IOU request. Please try again.');
        setIsSubmitting(false);
        return;
      }
    }

    // Local Debt Creation
    try {
      const now = Date.now();
      const selectedDate = date ? new Date(date).getTime() : now;

      // Find if we have a local person ID to use
      let localPersonIdToUse: string | null = null;
      if (finalRecipient?.type === 'local') {
        localPersonIdToUse = finalRecipient.id;
      } else if (finalRecipient?.type === 'friend' && finalRecipient.localPersonId) {
        localPersonIdToUse = finalRecipient.localPersonId;
      } else {
        // We might just be typing a random name that doesn't exactly match
        const existingByName = people.find(p => p.name.toLowerCase() === personName.trim().toLowerCase());
        if (existingByName) localPersonIdToUse = existingByName.id;
      }

      const newPersonId = localPersonIdToUse ?? createId('person');
      const newDebtId = createId('debt');

      await db.transaction('rw', [db.debts, db.people], async () => {
        if (!localPersonIdToUse) {
          // Find if we should link to a connection (they picked a friend but unselected share)
          let connectionIdToLink = undefined;
          if (finalRecipient?.type === 'friend') {
            const conn = cacheConnections.find(c => c.status === 'accepted' && (c.user_a === finalRecipient.id || c.user_b === finalRecipient.id));
            if (conn) connectionIdToLink = conn.id;
          }

          await db.people.add({
            id: newPersonId,
            name: personName.trim(),
            connection_id: connectionIdToLink,
            updatedAt: now,
          });
        }

        await db.debts.add({
          id: newDebtId,
          source: 'manual',
          direction,
          personId: newPersonId,
          personName: personName.trim(),
          amount: numAmount,
          note: note.trim() || undefined,
          date: selectedDate,
          settlements: [],
          updatedAt: now,
        });
      });

      triggerSync('debts', newDebtId);
      if (!localPersonIdToUse) triggerSync('people', newPersonId);
      handleClose();
    } catch (err: any) {
      console.error('Failed to create manual debt', err);
      setError(err?.message || 'Failed to save debt.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full duration-300">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-border shrink-0">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">IOUs & Debts</p>
            <h2 className="text-xl font-medium text-foreground">Record Debt</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 bg-muted rounded-full text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form id="add-debt-form" onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">

          {/* Direction Toggle */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Direction
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-muted/50 rounded-xl">
              <button
                type="button"
                onClick={() => setDirection('theyOweMe')}
                className={`py-2.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  direction === 'theyOweMe'
                    ? 'bg-card text-emerald-500 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ArrowDownLeft size={16} />
                <span>They owe me</span>
              </button>
              <button
                type="button"
                onClick={() => setDirection('iOweThem')}
                className={`py-2.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  direction === 'iOweThem'
                    ? 'bg-card text-amber-500 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ArrowUpRight size={16} />
                <span>I owe them</span>
              </button>
            </div>
          </div>

          {/* Person Name */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Person
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={personName}
                onChange={e => {
                  setPersonName(e.target.value);
                  setSelectedRecipientId(null);
                  setIsPersonDropdownOpen(true);
                  if (error) setError('');
                }}
                onFocus={() => setIsPersonDropdownOpen(true)}
                onBlur={() => setTimeout(() => setIsPersonDropdownOpen(false), 200)}
                placeholder="e.g. Alex, Maya"
                className="w-full p-3.5 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
              />
              {isPersonDropdownOpen && filteredRecipients.length > 0 && (
                <ul className="absolute z-10 top-full left-0 right-0 mt-2 max-h-48 overflow-y-auto bg-card border border-border rounded-xl shadow-lg p-1">
                  {filteredRecipients.map(r => (
                    <li
                      key={r.id}
                      onClick={() => {
                        setPersonName(r.displayName);
                        setSelectedRecipientId(r.id);
                        setIsPersonDropdownOpen(false);
                      }}
                      className="flex flex-col px-3 py-2.5 rounded-lg hover:bg-muted/50 cursor-pointer"
                    >
                      <span className="text-sm font-medium text-foreground">{r.displayName}</span>
                      {r.type === 'friend' ? (
                        <span className="text-[11px] text-emerald-500 font-medium">
                          @{r.username} · Finora friend
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground font-medium">
                          Local person
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!isPersonDropdownOpen && finalRecipient?.type === 'friend' && targetFriendUsername && (
              <p className="text-[11px] text-emerald-500 font-medium mt-2 ml-1">
                @{targetFriendUsername} · Finora friend
              </p>
            )}
          </div>

          {canShare && (
            <div className="flex items-start gap-3 p-3.5 bg-background border border-border rounded-xl mt-1 mb-2">
              <input
                type="checkbox"
                id="shareOptIn"
                checked={isSharedOptIn}
                onChange={(e) => setIsSharedOptIn(e.target.checked)}
                disabled={isSubmitting}
                className="mt-0.5 shrink-0 h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-background bg-background"
              />
              <div>
                <label htmlFor="shareOptIn" className="text-sm font-medium text-foreground block cursor-pointer leading-tight">
                  Send as shared IOU
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  @{targetFriendUsername} will be asked to confirm.
                </p>
              </div>
            </div>
          )}

          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
              Amount
            </label>
            <div className="flex items-center text-3xl font-light">
              <span className="text-lg text-muted-foreground mr-2 font-normal">LKR</span>
              <input
                type="number"
                inputMode="decimal"
                required
                min="0.01"
                step="any"
                value={amount}
                onChange={e => {
                  setAmount(e.target.value);
                  if (error) setError('');
                }}
                placeholder="0"
                className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/40 font-light"
              />
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full p-3.5 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
            />
          </div>

          {/* Note / Description */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Note (Optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Dinner Tuesday, they covered it"
              className="w-full p-3.5 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs font-medium">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="p-5 border-t border-border flex gap-3 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-3.5 bg-muted text-muted-foreground rounded-xl text-sm font-medium hover:text-foreground active:scale-95 transition-transform"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-debt-form"
            disabled={isSubmitting || !amount || !personName.trim()}
            className="flex-1 py-3.5 bg-accent text-accent-foreground rounded-xl text-sm font-medium shadow-sm active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save Debt'}
          </button>
        </div>
      </div>
    </div>
  );
}
