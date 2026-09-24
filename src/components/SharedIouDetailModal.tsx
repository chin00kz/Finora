import { Modal } from './Modal';
import { formatMoney } from '../utils/formatters';
import type { UnifiedIou } from '../pages/Debts';
import CreditorSettlementReview from './CreditorSettlementReview';
import { canProposePayment, canReviewPayment } from '../utils/sharedIouSettlementEngine';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  iou: UnifiedIou | null;
  onProposePayment: () => void;
}

export default function SharedIouDetailModal({ isOpen, onClose, iou, onProposePayment }: Props) {
  if (!isOpen || !iou) return null;

  const history = [...(iou.allSettlements || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const isDebtor = iou.direction === 'iOweThem';
  const isSettled = iou.status === 'settled';

  return (
    <Modal open={isOpen} onClose={onClose} variant="sheet">
      <div className="space-y-6 pt-2 pb-6 px-1">
        
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
          <p className="text-3xl font-medium tracking-tight text-foreground">
            {formatMoney(iou.amount, iou.currency)}
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
          
          {isSettled && (
            <div className="inline-block mt-3 px-2 py-1 bg-emerald-500/10 text-emerald-500 text-xs font-medium rounded">
              Settled
            </div>
          )}
        </div>

        {/* Actions */}
        {!isSettled && (
          <div className="space-y-3">
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
                  <CreditorSettlementReview key={s.id} settlement={s} currency={iou.currency} />
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
  );
}
