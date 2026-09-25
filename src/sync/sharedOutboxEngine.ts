import { db } from '../db/db';
import { supabase } from '../lib/supabase';
import { triggerSync } from './syncEngine';

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
          // Fire bulk RPC
          const { error } = await supabase.rpc('propose_shared_ious_bulk', {
            payload: item.payload
          });

          if (error) {
            console.error('Outbox RPC error:', error);
            // Non-retriable vs retriable logic could go here
            await db.sharedOutbox.update(item.id, { 
              retry_count: item.retry_count + 1 
            });
            throw error;
          }

          // Success - remove from outbox and mark transaction synced
          await db.sharedOutbox.delete(item.id);
          const txnId = item.payload.transaction_id;
          if (txnId) {
            await db.transactions.update(txnId, { splitStatus: 'synced' });
            triggerSync('transactions', txnId);
          }
          
        } else if (item.operation_type === 'cancel_split') {
           const { error } = await supabase.rpc('cancel_shared_iou_bulk', {
             payload: item.payload
           });
           if (error) throw error;
           await db.sharedOutbox.delete(item.id);
        }
        
      } catch (err) {
        console.error('Failed to process outbox item', item.id, err);
        // Remains queued. Will retry on next loop.
      }
    }
  } finally {
    isProcessing = false;
  }
}

// Hook into window online event to trigger processing immediately upon reconnection
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    processSharedOutbox();
  });
}
