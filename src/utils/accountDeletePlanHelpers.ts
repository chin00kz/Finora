/**
 * Pure helpers for account delete UX decisions (Node-test safe).
 */
import type { AccountDeletePlan } from './accountLifecycle';

export type AccountLinkCounts = Pick<
  AccountDeletePlan,
  | 'transactionCount'
  | 'recurringCount'
  | 'goalLinkCount'
  | 'settlementRefCount'
  | 'outboxCount'
  | 'balanceToMerge'
>;

/** Refs / balance that require the reassignment path even with zero transactions. */
export function accountDeleteNeedsReassignment(plan: AccountLinkCounts): boolean {
  return (
    plan.transactionCount > 0 ||
    plan.recurringCount > 0 ||
    plan.goalLinkCount > 0 ||
    plan.settlementRefCount > 0 ||
    plan.outboxCount > 0 ||
    plan.balanceToMerge !== 0
  );
}

/**
 * Sole-account delete is safe when no refs would be orphaned.
 * Non-zero balance alone is allowed (there is nowhere to merge it).
 */
export function soleAccountDeleteIsSafe(plan: AccountLinkCounts): boolean {
  return (
    plan.transactionCount === 0 &&
    plan.recurringCount === 0 &&
    plan.goalLinkCount === 0 &&
    plan.settlementRefCount === 0 &&
    plan.outboxCount === 0
  );
}
