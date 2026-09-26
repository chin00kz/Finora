import { db } from '../db/db';
import type { Transaction } from '../db/db';
import { supabase } from '../lib/supabase';
import { triggerSync } from './syncEngine';
import { createId } from '../utils/createId';

let isProcessing = false;

export async function processSharedOutbox() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const queuedItems = await db.sharedOutbox
      .filter(item => item.status === 'queued')
      .toArray();

    if (queuedItems.length === 0) return;

    const { data: session } = await supabase.auth.getSession();
    if (!session.session?.user) {
      console.log('Outbox: User not authenticated, skipping');
      return;
    }

    for (const item of queuedItems) {
      try {
        await db.sharedOutbox.update(item.id, { last_attempt: Date.now() });

        if (item.operation_type === 'propose_split') {
          const payload = item.payload as {
            transaction_id: string;
            splits: unknown[];
          };
          const { error } = await supabase.rpc('propose_shared_ious_bulk', {
            p_idempotency_key: item.idempotency_key,
            p_transaction_id: payload.transaction_id,
            p_splits: payload.splits,
          });

          if (error) {
            console.error('Outbox RPC error:', error);
            await db.sharedOutbox.update(item.id, {
              retry_count: item.retry_count + 1,
            });
            throw error;
          }

          await db.sharedOutbox.delete(item.id);
          const txnId = payload.transaction_id;
          if (txnId) {
            await db.transactions.update(txnId, { splitStatus: 'synced' });
            triggerSync('transactions', txnId);
          }
        } else if (item.operation_type === 'record_payment') {
          const payload = item.payload as {
            recipient_id: string;
            amount: number;
            description?: string;
          };
          const { error } = await supabase.rpc('propose_shared_payment', {
            p_idempotency_key: item.idempotency_key,
            p_payee_id: payload.recipient_id,
            p_amount: payload.amount,
            p_currency: 'LKR',
            p_notes: payload.description,
          });
          if (error) throw error;
          await db.sharedOutbox.delete(item.id);
        } else if (item.operation_type === 'cancel_split') {
          const payload = item.payload as { transaction_id?: string; ids?: string[] };
          const transactionId = payload.transaction_id || payload.ids?.[0];
          if (!transactionId) throw new Error('cancel_split missing transaction_id');
          const { error } = await supabase.rpc('cancel_shared_iou_bulk', {
            p_transaction_id: transactionId,
          });
          if (error) throw error;
          await db.sharedOutbox.delete(item.id);
        }
      } catch (err) {
        console.error('Failed to process outbox item', item.id, err);
      }
    }
  } finally {
    isProcessing = false;
  }
}

export async function enqueueCancelSplit(
  transaction: Pick<Transaction, 'id' | 'isShared' | 'splitStatus'>,
): Promise<void> {
  if (!transaction.isShared || transaction.splitStatus !== 'synced') return;
  await db.sharedOutbox.add({
    id: createId('outbox'),
    operation_type: 'cancel_split',
    idempotency_key: `cancel-${transaction.id}`,
    payload: { transaction_id: transaction.id },
    status: 'queued',
    retry_count: 0,
    created_at: Date.now(),
  });
  void processSharedOutbox();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    processSharedOutbox();
  });
}
