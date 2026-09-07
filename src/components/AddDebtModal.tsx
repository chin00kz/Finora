import React, { useState } from 'react';
import { X, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { db, type DebtDirection } from '../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { triggerSync } from '../sync/syncEngine';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultDirection?: DebtDirection;
}

export default function AddDebtModal({ isOpen, onClose, defaultDirection = 'theyOweMe' }: Props) {
  const people = useLiveQuery(() => db.people.toArray()) || [];

  const [direction, setDirection] = useState<DebtDirection>(defaultDirection);
  const [personName, setPersonName] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Number(amount);
    const trimmedPerson = personName.trim();

    if (!trimmedPerson) {
      setError('Please specify a person name.');
      return;
    }
    if (!numAmount || numAmount <= 0 || isNaN(numAmount)) {
      setError('Please enter a valid amount.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const now = Date.now();
      const selectedDate = date ? new Date(date).getTime() : now;

      await db.transaction('rw', [db.debts, db.people], async () => {
        // Resolve or create person
        const existingPerson = people.find(
          p => p.name.toLowerCase() === trimmedPerson.toLowerCase()
        );
        let personId = existingPerson?.id;
        if (!existingPerson) {
          personId = `person-${now}-${Math.random().toString(36).substring(2, 6)}`;
          await db.people.add({
            id: personId,
            name: trimmedPerson,
            updatedAt: now,
          });
        }

        const newDebtId = `debt-${now}-${Math.random().toString(36).substring(2, 7)}`;
        await db.debts.add({
          id: newDebtId,
          source: 'manual',
          direction,
          personId,
          personName: trimmedPerson,
          amount: numAmount,
          note: note.trim() || undefined,
          date: selectedDate,
          settlements: [],
          updatedAt: now,
        });
      });

      triggerSync();
      handleClose();
    } catch (err: any) {
      console.error('Failed to create manual debt', err);
      setError(err?.message || 'Failed to save debt.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setPersonName('');
    setAmount('');
    setNote('');
    setDate(new Date().toISOString().split('T')[0]);
    setError('');
    onClose();
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
          {/* Direction toggle */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Direction
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-xl">
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
            <input
              type="text"
              required
              list="people-list-options"
              value={personName}
              onChange={e => {
                setPersonName(e.target.value);
                if (error) setError('');
              }}
              placeholder="e.g. Alex, Maya"
              className="w-full p-3.5 bg-background border border-border rounded-xl text-sm font-medium text-foreground outline-none focus:border-foreground"
            />
            <datalist id="people-list-options">
              {people.map(p => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>

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
            {isSubmitting ? 'Saving…' : 'Save Debt'}
          </button>
        </div>
      </div>
    </div>
  );
}
