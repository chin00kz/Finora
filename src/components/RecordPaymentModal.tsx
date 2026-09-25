import { useState } from 'react';
import { X } from 'lucide-react';
import { db } from '../db/db';
import { createId } from '../utils/createId';
import { triggerSync } from '../sync/syncEngine';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  identityKey: string;
  name: string;
}

export default function RecordPaymentModal({ isOpen, onClose, identityKey, name }: Props) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [direction, setDirection] = useState<'iPaidThem' | 'theyPaidMe'>('iPaidThem');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    setIsSubmitting(true);

    try {
      if (identityKey.startsWith('local:')) {
        // Local Payment -> just a debt settlement
        const personId = identityKey.replace('local:', '');
        const debtId = createId('debt');
        await db.debts.add({
          id: debtId,
          personId,
          amount: Number(amount),
          direction: direction === 'iPaidThem' ? 'theyOweMe' : 'iOweThem', // Payment they owe me if I paid them
          date: Date.now(),
          source: 'manual',
          personName: name,
          note: notes || 'Payment',
        });
        triggerSync('debts', debtId);
      } else {
        // Cloud Payment
        const profileId = identityKey.replace('profile:', '');
        const paymentId = createId('outbox');
        const idempotencyKey = createId('idem');
        
        await db.transaction('rw', [db.sharedOutbox, db.sharedPayments], async () => {
          // Pre-emptively show in UI as pending
          await db.sharedPayments.add({
            id: paymentId,
            idempotency_key: idempotencyKey,
            payer_id: direction === 'iPaidThem' ? 'local:me' : profileId,
            payee_id: direction === 'iPaidThem' ? profileId : 'local:me',
            amount: Number(amount),
            currency: 'LKR',
            status: 'pending',
            notes: notes || 'Payment',
            created_at: Date.now(),
            updated_at: Date.now()
          });

          // Queue in Outbox
          await db.sharedOutbox.add({
            id: paymentId,
            operation_type: 'record_payment',
            idempotency_key: idempotencyKey,
            payload: {
              payment_id: paymentId,
              recipient_id: profileId,
              amount: Number(amount),
              description: notes || 'Payment'
            },
            status: 'queued',
            retry_count: 0,
            created_at: Date.now()
          });
        });
      }
      onClose();
    } catch (e) {
      console.error('Failed to record payment', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in slide-in-from-bottom-full duration-200">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-lg font-semibold">Record Payment</h2>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-muted text-muted-foreground">
          <X size={20} />
        </button>
      </div>

      <div className="p-4 space-y-6 flex-1 overflow-y-auto">
        <div className="space-y-4">
          <div className="flex bg-muted p-1 rounded-xl">
            <button
              onClick={() => setDirection('iPaidThem')}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors ${direction === 'iPaidThem' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              You paid {name}
            </button>
            <button
              onClick={() => setDirection('theyPaidMe')}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors ${direction === 'theyPaidMe' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {name} paid you
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Amount</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">LKR</span>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-muted text-foreground outline-none rounded-2xl pl-14 pr-4 py-4 text-2xl font-bold"
              autoFocus
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Note (Optional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What was this for?"
            className="w-full bg-muted text-foreground outline-none rounded-xl px-4 py-3"
          />
        </div>
      </div>

      <div className="p-4 border-t border-border">
        <button
          onClick={handleSave}
          disabled={!amount || isNaN(Number(amount)) || Number(amount) <= 0 || isSubmitting}
          className="w-full py-4 bg-foreground text-background font-semibold rounded-xl disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : 'Save Payment'}
        </button>
      </div>
    </div>
  );
}
