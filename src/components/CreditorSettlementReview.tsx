import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatMoney } from '../utils/formatters';
import { syncSharedIouSettlements, syncSharedIous } from '../sync/sharedIouSync';
import type { CacheSharedIouSettlement } from '../db/db';

interface Props {
  settlement: CacheSharedIouSettlement;
  currency: string;
}

export default function CreditorSettlementReview({ settlement, currency }: Props) {
  const [actioning, setActioning] = useState<'confirm' | 'reject' | null>(null);
  const [error, setError] = useState('');

  const handleAction = async (action: 'confirm' | 'reject') => {
    setError('');
    setActioning(action);
    try {
      const rpcName = action === 'confirm' ? 'confirm_iou_payment' : 'reject_iou_payment';
      const { error: rpcError } = await supabase.rpc(rpcName, { p_settlement_id: settlement.id });

      if (rpcError) {
        setError(rpcError.message || `Failed to ${action} payment.`);
        setActioning(null);
        // Fire a background refresh just in case it's a stale state error
        syncSharedIouSettlements().catch(console.error);
        syncSharedIous().catch(console.error);
        return;
      }

      // Success! Fire both syncs since parent IOU might now be settled.
      // Leave actioning state true so it acts as a loading state until Dexie removes it from the pending list.
      Promise.all([
        syncSharedIouSettlements(),
        syncSharedIous()
      ]).catch(console.error);
      
    } catch (err: any) {
      setError(err.message || 'Network error.');
      setActioning(null);
    }
  };

  return (
    <div className="bg-muted/10 border border-border/40 rounded-xl p-3 mt-1">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-sm font-medium text-foreground">
          Payment claimed · {formatMoney(settlement.amount, currency)}
        </span>
      </div>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); handleAction('reject'); }}
          disabled={!!actioning}
          className="flex-1 px-3 py-1.5 text-xs font-medium text-red-500 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {actioning === 'reject' && (
            <div className="w-3 h-3 rounded-full border-2 border-red-500/30 border-t-red-500 animate-spin" />
          )}
          {actioning === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleAction('confirm'); }}
          disabled={!!actioning}
          className="flex-1 px-3 py-1.5 text-xs font-medium text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {actioning === 'confirm' && (
            <div className="w-3 h-3 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" />
          )}
          {actioning === 'confirm' ? 'Confirming...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
