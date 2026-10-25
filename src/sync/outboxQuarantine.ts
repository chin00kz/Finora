import { db } from '../db/db';
import type { PendingAccountOutbox } from '../db/db';

export const OUTBOX_QUARANTINE_REASON =
  'Quarantined after restore reconciliation. Review manually before applying settlement account effects.';

/** Whether settlement sync may auto-apply an outbox row. */
export function shouldAutoApplyOutboxEntry(entry: {
  quarantinedAt?: number;
}): boolean {
  return entry.quarantinedAt == null;
}

export async function quarantinePendingAccountOutbox(
  reason: string = OUTBOX_QUARANTINE_REASON,
): Promise<number> {
  const entries = await db.pendingAccountOutbox.toArray();
  const now = Date.now();
  let count = 0;
  for (const entry of entries) {
    if (entry.quarantinedAt) continue;
    await db.pendingAccountOutbox.put({
      ...entry,
      quarantinedAt: now,
      quarantineReason: reason,
    });
    count += 1;
  }
  return count;
}

export type OutboxBalanceEffectStatus =
  | 'already_recorded'
  | 'not_recorded'
  | 'account_missing';

export type OutboxCloudSettlementStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'not_in_cache'
  | 'unknown';

export interface OutboxReviewRow {
  outbox: PendingAccountOutbox;
  accountName: string | null;
  cloudSettlementStatus: OutboxCloudSettlementStatus;
  sharedIouId: string | null;
  balanceEffect: OutboxBalanceEffectStatus;
  existingTxnId: string | null;
  /** Human-readable summary — never implies auto-apply. */
  summary: string;
}

/**
 * Build a read-only review model for quarantined (and optionally all) outbox rows.
 * Does not mutate, replay, or delete anything.
 */
export async function buildOutboxReviewRows(options?: {
  quarantinedOnly?: boolean;
}): Promise<OutboxReviewRow[]> {
  const quarantinedOnly = options?.quarantinedOnly !== false;
  const entries = await db.pendingAccountOutbox.toArray();
  const filtered = quarantinedOnly
    ? entries.filter(e => e.quarantinedAt != null)
    : entries;

  const settlements = await db.cacheSharedIouSettlements.toArray();
  const settlementById = new Map(settlements.map(s => [s.id, s]));
  const accounts = await db.accounts.toArray();
  const accountById = new Map(accounts.map(a => [a.id, a]));

  const rows: OutboxReviewRow[] = [];
  for (const outbox of filtered) {
    const settlement = settlementById.get(outbox.id);
    const cloudSettlementStatus: OutboxCloudSettlementStatus = settlement
      ? settlement.status
      : 'not_in_cache';

    const existing = await db.transactions
      .where('debtSettlementId')
      .equals(outbox.id)
      .first();

    const account = accountById.get(outbox.accountId);
    let balanceEffect: OutboxBalanceEffectStatus = 'not_recorded';
    if (existing) balanceEffect = 'already_recorded';
    else if (!account) balanceEffect = 'account_missing';

    const direction = outbox.direction === 'credit' ? 'credit (deposit)' : 'debit (payment)';
    const summary = [
      `${direction} of ${outbox.amount} on account ${account?.name ?? outbox.accountId}`,
      `cloud settlement: ${cloudSettlementStatus}`,
      balanceEffect === 'already_recorded'
        ? `local txn already present (${existing!.id})`
        : balanceEffect === 'account_missing'
          ? 'target account missing on this device'
          : 'no local settlement txn recorded yet',
      'Auto-apply is disabled while quarantined — review only.',
    ].join(' · ');

    rows.push({
      outbox,
      accountName: account?.name ?? null,
      cloudSettlementStatus,
      sharedIouId: settlement?.shared_iou_id ?? null,
      balanceEffect,
      existingTxnId: existing?.id ?? null,
      summary,
    });
  }

  rows.sort((a, b) => (b.outbox.quarantinedAt ?? 0) - (a.outbox.quarantinedAt ?? 0));
  return rows;
}
