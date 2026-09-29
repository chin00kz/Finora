import { useState } from 'react';
import { Modal } from './Modal';
import { X } from 'lucide-react';
import { formatMoney } from '../utils/formatters';
import type { UnifiedIou } from '../pages/Debts';
import CreditorSettlementReview from './CreditorSettlementReview';
import { canProposePayment, canReviewPayment } from '../utils/sharedIouSettlementEngine';
import { supabase } from '../lib/supabase';
import { syncSharedIous, syncSharedIouSettlements } from '../sync/sharedIouSync';
import MarkPaidModal from './MarkPaidModal';
import { useAuthStore } from '../store/authStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  iou: UnifiedIou | null;
  onProposePayment: () => void;
}

export default function SharedIouDetailModal({ isOpen, onClose, iou, onProposePayment }: Props) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isMarkPaidOpen, setIsMarkPaidOpen] = useState(false);
  const user = useAuthStore(state => state.user);

  if (!isOpen || !iou) return null;

  const history = [...(iou.allSettlements || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this IOU?')) return;
    setIsCancelling(true);
    try {
      await supabase.rpc('cancel_shared_iou', { p_iou_id: iou.id });
      await Promise.all([syncSharedIous(), syncSharedIouSettlements()]);
      onClose();
    } catch (e) {
      console.error('Failed to cancel IOU:', e);
      alert('Failed to cancel IOU. Please try again.');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleReject = async () => {
    const reason = prompt('Are you sure you want to reject this IOU?\n\nOptional reason:');
    if (reason === null) return;
    setIsRejecting(true);
    try {
      await supabase.rpc('reject_shared_iou', { p_iou_id: iou.id, p_reason: reason.trim() || null });
      await Promise.all([syncSharedIous(), syncSharedIouSettlements()]);
      onClose();
    } catch (e: any) {
      console.error('Failed to reject IOU:', e);
      alert(e.message || 'Failed to reject IOU. Please try again.');
    } finally {
      setIsRejecting(false);
    }
  };

  const isDebtor = iou.direction === 'iOweThem';
  const isSettled = iou.status === 'settled';
  const isCancelled = iou.status === 'cancelled';
  const isRejected = iou.status === 'rejected';

  const confirmedTotal = (iou.allSettlements || [])
    .filter(s => s.status === 'confirmed')
    .reduce((sum, s) => sum + s.amount, 0);
  
  const originalAmt = iou.originalAmount !== undefined ? iou.originalAmount : iou.amount;
  const calculatedRemaining = originalAmt - confirmedTotal;
  const isOverpaid = calculatedRemaining < 0;
  const overpaymentAmount = isOverpaid ? Math.abs(calculatedRemaining) : 0;

  return (
    <>
    <Modal open={isOpen} onClose={onClose} variant="sheet">
      <div className="space-y-6 pt-2 pb-6 px-1 relative">
        {/* Explicit Close */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-1 right-1 p-2 text-muted-foreground hover:bg-muted/50 rounded-full transition-colors z-10"
        >
          <X size={20} />
        </button>
        
        {/* Header Section */}
        <div className="text-center space-y-1">
          <h2 className="text-xl font-medium text-foreground tracking-tight truncate">
            {iou.personName}
          </h2>
          {iou.username && (
            <p className="text-sm text-muted-foreground truncate">@{iou.username}</p>
          )}
          <p className="text-sm font-medium mt-1">
            {isDebtor ? 'I owe them' : 'They owe me'}
          </p>
        </div>

        {/* Financial Summary */}
        <div className="bg-muted/20 border border-border/40 rounded-xl p-4 text-center space-y-1">
          <p className="text-sm text-muted-foreground">Remaining balance</p>
          <p className={`text-3xl font-medium tracking-tight ${isOverpaid ? 'text-amber-500' : 'text-foreground'}`}>
            {isOverpaid ? '-' : ''}{formatMoney(Math.abs(calculatedRemaining), iou.currency)}
          </p>
          
          {(iou.originalAmount !== undefined && iou.originalAmount !== iou.amount) && (
            <p className="text-xs text-muted-foreground mt-2">
              Original: {formatMoney(iou.originalAmount, iou.currency)}
            </p>
          )}

          {iou.pendingTotal !== undefined && iou.pendingTotal > 0 && (
            <p className="text-xs text-amber-500 font-medium mt-1">
              Pending confirmation: {formatMoney(iou.pendingTotal, iou.currency)}
            </p>
          )}
          
          {isCancelled && (
            <div className="mt-3 flex flex-col items-center gap-1.5">
              <div className="inline-block px-2 py-1 bg-muted-foreground/10 text-muted-foreground text-xs font-medium rounded">
                Cancelled
              </div>
            </div>
          )}
          {isRejected && (
            <div className="mt-3 flex flex-col items-center gap-1.5">
              <div className="inline-block px-2 py-1 bg-red-500/10 text-red-500 text-xs font-medium rounded">
                Rejected
              </div>
              {iou.statusReason && (
                <p className="text-xs text-muted-foreground text-center mt-1">
                  Reason: {iou.statusReason}
                </p>
              )}
            </div>
          )}
          {isSettled && (
            <div className="mt-3 flex flex-col items-center gap-1.5">
              <div className="inline-block px-2 py-1 bg-emerald-500/10 text-emerald-500 text-xs font-medium rounded">
                Settled
              </div>
              {overpaymentAmount > 0 && (
                <p className="text-xs font-medium text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-md mt-1">
                  {isDebtor 
                    ? `${iou.personName} now owes you ${formatMoney(overpaymentAmount, iou.currency)}`
                    : `You now owe ${iou.personName} ${formatMoney(overpaymentAmount, iou.currency)}`}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {(!isSettled && !isCancelled && !isRejected) && (
          <div className="space-y-3">
            {!isDebtor && iou.source === 'shared' && (
              <button
                onClick={() => setIsMarkPaidOpen(true)}
                className="w-full py-2.5 bg-foreground text-background font-medium rounded-xl hover:opacity-90 transition-opacity"
              >
                Mark as paid
              </button>
            )}

            {iou.source === 'shared' && iou.creatorId === user?.id && (
              <button
                onClick={handleCancel}
                disabled={isCancelling}
                className="w-full py-2.5 bg-red-500/10 text-red-500 font-medium rounded-xl hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {isCancelling ? 'Cancelling...' : 'Cancel IOU'}
              </button>
            )}

            {iou.source === 'shared' && isDebtor && iou.status === 'active' && confirmedTotal === 0 && (
              <button
                onClick={handleReject}
                disabled={isRejecting}
                className="w-full py-2.5 bg-red-500/10 text-red-500 font-medium rounded-xl hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {isRejecting ? 'Rejecting...' : 'Reject IOU'}
              </button>
            )}

            {canProposePayment(iou.source, iou.status, iou.direction, iou.availableToPropose || 0) && (
              <button
                onClick={() => {
                  onClose();
                  onProposePayment();
                }}
                className="w-full py-2.5 bg-foreground text-background font-medium rounded-xl hover:opacity-90 transition-opacity"
              >
                I paid
              </button>
            )}

            {canReviewPayment(iou.source, iou.status, iou.direction) && iou.pendingSettlements && iou.pendingSettlements.length > 0 && (
              <div className="space-y-2">
                {iou.pendingSettlements.map((s: any) => (
                  <CreditorSettlementReview 
                    key={s.id} 
                    settlement={s} 
                    currency={iou.currency} 
                    remainingAmount={iou.amount} 
                    personName={iou.personName} 
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* History Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Payment history</h3>
          
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center bg-muted/10 rounded-xl">
              No payments yet
            </p>
          ) : (
            <div className="space-y-2">
              {history.map(s => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/10">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {formatMoney(s.amount, iou.currency)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right">
                    {s.status === 'confirmed' && (
                      <span className="text-[11px] font-medium text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
                        Confirmed
                      </span>
                    )}
                    {s.status === 'pending' && (
                      <span className="text-[11px] font-medium text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
                        Pending
                      </span>
                    )}
                    {s.status === 'rejected' && (
                      <span className="text-[11px] font-medium text-red-500/70 bg-red-500/10 px-2 py-1 rounded">
                        Rejected
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-center pt-2">
          <p className="text-[10px] text-muted-foreground">
            Created {new Date(iou.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>

      </div>
    </Modal>
    {iou.source === 'shared' && isMarkPaidOpen && (
      <MarkPaidModal
        isOpen={isMarkPaidOpen}
        onClose={() => setIsMarkPaidOpen(false)}
        iouId={iou.id}
        remainingAmount={iou.amount - confirmedTotal}
        currency={iou.currency}
      />
    )}
    </>
  );
}

