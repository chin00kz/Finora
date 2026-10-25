/**
 * Guarded Shared IOU / connection mutation RPCs.
 * All cloud-changing debt/social mutations must go through these wrappers
 * so restore isolation cannot be bypassed by UI call sites.
 */
import { getCloudMutationBlockError } from './restoreIsolation';

/** RPC names that must never run while restore-isolated. */
export const GUARDED_SHARED_CLOUD_RPCS = [
  'create_shared_iou',
  'accept_shared_iou',
  'decline_shared_iou',
  'cancel_shared_iou',
  'reject_shared_iou',
  'propose_iou_payment',
  'confirm_iou_payment',
  'reject_iou_payment',
  'mark_iou_paid',
  'send_connection_request',
  'respond_connection_request',
  'set_connection_auto_accept',
] as const;

export type GuardedSharedCloudRpc = (typeof GUARDED_SHARED_CLOUD_RPCS)[number];

type RpcResult<T = unknown> = Promise<{ data: T | null; error: { message: string } | null }>;

async function guardedRpc<T = unknown>(
  name: GuardedSharedCloudRpc,
  args?: Record<string, unknown>,
): RpcResult<T> {
  const blocked = getCloudMutationBlockError();
  if (blocked) return { data: null, error: blocked };
  // Lazy import so isolation short-circuit does not require Supabase env at module load.
  const { supabase } = await import('../lib/supabase');
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { data: null, error: { message: error.message } };
  return { data: data as T, error: null };
}

export function createSharedIou(args: {
  p_debtor_id: string;
  p_amount: number;
  p_currency: string;
  p_description?: string;
}) {
  return guardedRpc('create_shared_iou', args);
}

export function acceptSharedIou(p_iou_id: string) {
  return guardedRpc('accept_shared_iou', { p_iou_id });
}

export function declineSharedIou(p_iou_id: string) {
  return guardedRpc('decline_shared_iou', { p_iou_id });
}

export function cancelSharedIou(p_iou_id: string) {
  return guardedRpc('cancel_shared_iou', { p_iou_id });
}

export function rejectSharedIou(p_iou_id: string, p_reason: string | null) {
  return guardedRpc('reject_shared_iou', { p_iou_id, p_reason });
}

export function proposeIouPayment(args: {
  p_iou_id: string;
  p_amount: number;
  p_note?: string;
  p_settlement_id: string;
}) {
  return guardedRpc('propose_iou_payment', args);
}

export function confirmIouPayment(p_settlement_id: string) {
  return guardedRpc('confirm_iou_payment', { p_settlement_id });
}

export function rejectIouPayment(p_settlement_id: string) {
  return guardedRpc('reject_iou_payment', { p_settlement_id });
}

export function markIouPaid(args: {
  p_iou_id: string;
  p_note: string | null;
  p_settlement_id: string;
}) {
  return guardedRpc('mark_iou_paid', args);
}

export function sendConnectionRequest(target_user_id: string) {
  return guardedRpc('send_connection_request', { target_user_id });
}

export function respondConnectionRequest(conn_id: string, response_status: 'accepted' | 'declined') {
  return guardedRpc('respond_connection_request', { conn_id, response_status });
}

export function setConnectionAutoAccept(p_connection_id: string, p_auto_accept: boolean) {
  return guardedRpc('set_connection_auto_accept', { p_connection_id, p_auto_accept });
}
