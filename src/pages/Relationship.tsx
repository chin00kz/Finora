import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { ChevronLeft, Clock } from 'lucide-react';
import { formatMoney } from '../utils/formatters';
import { useAuthStore } from '../store/authStore';
import { format } from 'date-fns';
import { useParticipantIdentities } from '../hooks/useParticipantIdentities';
import RecordPaymentModal from '../components/RecordPaymentModal';
import { getSharedIouSettlementStatus } from '../utils/sharedIouSettlementEngine';
import { supabase } from '../lib/supabase';
import { syncSharedIous } from '../sync/sharedIouSync';

export default function Relationship() {
  const { identityKey } = useParams();
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { identities } = useParticipantIdentities(user?.id);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);


  // Ensure fresh data when navigating directly (e.g. from a notification deep-link).
  useEffect(() => {
    if (user) {
      syncSharedIous().catch(err => console.warn('[Relationship] Background sync failed:', err));
    }
  }, [user]);

  const identity = identities.find(i => i.identityKey === identityKey);

  const debts = useLiveQuery(() => db.debts.toArray()) || [];
  const sharedIous = useLiveQuery(() => db.cacheSharedIous.toArray()) || [];
  const sharedIouSettlements = useLiveQuery(() => db.cacheSharedIouSettlements.toArray()) || [];
  const payments = useLiveQuery(() => db.sharedPayments.toArray()) || [];
  const profileId = identityKey?.startsWith('profile:') ? identityKey.replace('profile:', '') : null;

  const canRecordPayment = useMemo(() => {
    if (!identityKey) return false;
    if (identityKey.startsWith('local:')) return true;
    if (!user || !profileId) return false;

    return sharedIous.some(iou => {
      if (iou.status !== 'accepted' || iou.debtor_id !== user.id || iou.creditor_id !== profileId) {
        return false;
      }
      const settlements = sharedIouSettlements.filter(s => s.shared_iou_id === iou.id);
      return getSharedIouSettlementStatus(iou.amount, settlements).availableToPropose > 0;
    });
  }, [identityKey, profileId, sharedIous, sharedIouSettlements, user]);


  const handleActionSharedIou = async (iouId: string, action: 'accepted' | 'declined') => {
    if (!user || actioningId) return;
    setActioningId(iouId);
    setActionError(null);

    const rpcName = action === 'accepted' ? 'accept_shared_iou' : 'decline_shared_iou';

    try {
      const { error } = await supabase.rpc(rpcName, { p_iou_id: iouId });
      if (error) throw error;

      // Optimistic update locally
      await db.cacheSharedIous.update(iouId, { status: action });

      const res = await syncSharedIous();
      if (!res.success) {
        console.warn('Post-mutation cache refresh failed.', res.error);
      }
    } catch (err: any) {
      console.error(`Failed to ${action} shared IOU`, err);
      setActionError(err.message || `Failed to ${action} request. Please try again.`);
    } finally {
      setActioningId(null);
    }
  };

  const timeline = useMemo(() => {
    if (!user || !identityKey) return [];
    const events: any[] = [];

    if (identityKey.startsWith('local:')) {
      const localId = identityKey.replace('local:', '');
      debts.forEach(d => {
        if (d.personId === localId) {
          events.push({
            type: 'local_iou',
            date: d.date || 0,
            amount: d.amount,
            direction: d.direction,
            status: (d.settlements?.reduce((s, st) => s + st.amount, 0) || 0) >= d.amount ? 'settled' : 'active',
            notes: d.note || 'Manual debt',
            id: d.id
          });
        }
      });
    } else if (identityKey.startsWith('profile:')) {
      const profileId = identityKey.replace('profile:', '');
      sharedIous.forEach(iou => {
        if (iou.creditor_id === profileId || iou.debtor_id === profileId) {
          events.push({
            type: 'shared_iou',
            date: new Date(iou.created_at).getTime(),
            amount: iou.amount,
            direction: iou.creditor_id === user.id ? 'theyOweMe' : 'iOweThem',
            status: iou.status,
            notes: 'Shared Expense',
            id: iou.id
          });
        }
      });
      payments.forEach(p => {
        if (p.payer_id === profileId || p.payee_id === profileId) {
          events.push({
            type: 'payment',
            date: p.created_at,
            amount: p.amount,
            direction: p.payee_id === user.id ? 'theyPaidMe' : 'iPaidThem',
            status: p.status,
            notes: p.notes,
            id: p.id
          });
        }
      });
    }

    return events.sort((a, b) => b.date - a.date);
  }, [debts, sharedIous, payments, user, identityKey]);

  if (!identity) return <div className="p-4 text-center">Loading...</div>;

  return (
    <div className="max-w-md mx-auto pb-24">
      <div className="bg-card border-b border-border sticky top-0 z-10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-muted">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold text-sm">
              {identity.name.charAt(0).toUpperCase()}
            </div>
            <h2 className="font-semibold text-foreground">{identity.name}</h2>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {timeline.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No history with {identity.name}</p>
        ) : (
          timeline.map(event => (
            <div key={event.id} className="bg-card p-4 rounded-2xl border border-border flex flex-col">
              <div className="flex items-start justify-between w-full">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  {event.type === 'payment' ? (
                    <span className="text-sm font-medium text-foreground">
                      {event.direction === 'theyPaidMe' ? `${identity.name} paid you` : `You paid ${identity.name}`}
                    </span>
                  ) : (
                    <span className="text-sm font-medium text-foreground">
                      {event.direction === 'theyOweMe' ? `${identity.name} owes you` : `You owe ${identity.name}`}
                    </span>
                  )}
                  {event.status === 'pending' && <Clock size={12} className="text-orange-500" />}
                </div>
                <p className="text-xs text-muted-foreground">{event.notes}</p>
                <p className="text-[10px] text-muted-foreground mt-2">{format(event.date, 'MMM d, yyyy h:mm a')}</p>
              </div>
              <div className="text-right">
                <span className={`font-semibold ${event.direction.includes('theyOwe') || event.direction === 'theyPaidMe' ? 'text-green-500' : 'text-foreground'}`}>
                  {formatMoney(event.amount)}
                </span>
                {event.status === 'pending' && <div className="text-[10px] text-orange-500 font-medium mt-1">Pending</div>}
              </div>
              </div>

              {/* Actions for Incoming Pending Requests */}
              {event.type === 'shared_iou' && event.status === 'pending' && event.direction === 'iOweThem' && (
                <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
                  <button
                    onClick={() => handleActionSharedIou(event.id, 'declined')}
                    disabled={actioningId === event.id}
                    className="px-4 py-2 bg-secondary text-secondary-foreground text-xs rounded-xl font-medium disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => handleActionSharedIou(event.id, 'accepted')}
                    disabled={actioningId === event.id}
                    className="px-4 py-2 bg-primary text-primary-foreground text-xs rounded-xl font-medium disabled:opacity-50"
                  >
                    Accept
                  </button>
                </div>
              )}
              {actionError && actioningId === event.id && (
                <p className="text-xs text-red-500 mt-2 text-right">{actionError}</p>
              )}
            </div>
          ))
        )}
      </div>

      <div className="fixed bottom-[72px] left-0 right-0 p-4 max-w-md mx-auto pointer-events-none">
        <div className="flex gap-2 pointer-events-auto">
          {canRecordPayment && (
            <button
              onClick={() => setIsPaymentModalOpen(true)}
              className="flex-1 bg-foreground text-background py-3.5 rounded-xl font-semibold shadow-lg active:scale-95 transition-transform"
            >
              Record Payment
            </button>
          )}
        </div>
      </div>

      <RecordPaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        identityKey={identityKey!}
        name={identity.name}
      />
    </div>
  );
}

