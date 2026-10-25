/**
 * Shared IOU settlement math + Mark-as-Paid remaining (P0 double-subtract fix).
 */
import type { CacheSharedIouSettlement } from '../../db/db';
import {
  canSubmitMarkPaid,
  getSharedIouSettlementStatus,
  resolveMarkPaidRemainingAmount,
} from '../sharedIouSettlementEngine';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function settlement(
  amount: number,
  status: CacheSharedIouSettlement['status'],
  id = `stl_${amount}_${status}`,
): CacheSharedIouSettlement {
  return {
    id,
    shared_iou_id: 'iou_test',
    amount,
    proposed_by: 'user_debtor',
    status,
    created_at: Date.now(),
  };
}

/** Mirrors Debts.tsx unified mapping: amount = remaining, originalAmount = principal. */
function mapUnifiedLike(originalAmount: number, settlements: CacheSharedIouSettlement[]) {
  const fin = getSharedIouSettlementStatus(originalAmount, settlements);
  return {
    amount: fin.remainingAmount,
    originalAmount,
    allSettlements: settlements,
    confirmedTotal: fin.confirmedTotal,
    pendingTotal: fin.pendingTotal,
  };
}

/**
 * Bug formula from SharedIouDetailModal before P0:
 * remainingAmount={iou.amount - confirmedTotal}
 */
function buggyMarkPaidRemaining(unified: ReturnType<typeof mapUnifiedLike>): number {
  return unified.amount - unified.confirmedTotal;
}

function runTests() {
  console.log('Running shared IOU settlement / Mark-as-Paid remaining tests...');

  // 1. No confirmed payments: 100 → remaining 100
  {
    const settlements: CacheSharedIouSettlement[] = [];
    const unified = mapUnifiedLike(100, settlements);
    assertEqual(unified.amount, 100, 'unified remaining with no confirms');
    const markPaid = resolveMarkPaidRemainingAmount({
      originalAmount: unified.originalAmount,
      unifiedRemainingAmount: unified.amount,
      settlements: unified.allSettlements,
    });
    assertEqual(markPaid, 100, 'Mark Paid remaining with no confirms');
    assert(canSubmitMarkPaid(markPaid), 'Mark Paid allowed when remaining 100');
  }

  // 2. Partial: confirmed 40 → remaining 60 (not 20)
  {
    const settlements = [settlement(40, 'confirmed')];
    const unified = mapUnifiedLike(100, settlements);
    assertEqual(unified.amount, 60, 'unified remaining after 40 confirmed');
    assertEqual(buggyMarkPaidRemaining(unified), 20, 'bug formula yields 20');
    const markPaid = resolveMarkPaidRemainingAmount({
      originalAmount: unified.originalAmount,
      unifiedRemainingAmount: unified.amount,
      settlements: unified.allSettlements,
    });
    assertEqual(markPaid, 60, 'Mark Paid remaining after partial must be 60');
    assert(markPaid !== buggyMarkPaidRemaining(unified), 'fix must disagree with double-subtract');
  }

  // 3. Multiple partials: 20 + 30 confirmed → remaining 50
  {
    const settlements = [settlement(20, 'confirmed', 'a'), settlement(30, 'confirmed', 'b')];
    const unified = mapUnifiedLike(100, settlements);
    assertEqual(unified.amount, 50, 'unified remaining after 20+30');
    const markPaid = resolveMarkPaidRemainingAmount({
      originalAmount: unified.originalAmount,
      unifiedRemainingAmount: unified.amount,
      settlements: unified.allSettlements,
    });
    assertEqual(markPaid, 50, 'Mark Paid remaining after multiple partials');
    assertEqual(buggyMarkPaidRemaining(unified), 0, 'bug formula collapses 50→0');
  }

  // 4. Fully paid: remaining 0; Mark Paid must not submit
  {
    const settlements = [settlement(100, 'confirmed')];
    const unified = mapUnifiedLike(100, settlements);
    assertEqual(unified.amount, 0, 'unified remaining when fully paid');
    const markPaid = resolveMarkPaidRemainingAmount({
      originalAmount: unified.originalAmount,
      unifiedRemainingAmount: unified.amount,
      settlements: unified.allSettlements,
    });
    assertEqual(markPaid, 0, 'Mark Paid remaining when fully paid');
    assert(!canSubmitMarkPaid(markPaid), 'Mark Paid must not permit submit at 0');
    assert(!canSubmitMarkPaid(-1), 'Mark Paid must not permit negative remaining');
  }

  // 5. Pending does not reduce Mark-as-Paid remaining (confirmed-only)
  {
    const settlements = [settlement(40, 'confirmed'), settlement(20, 'pending')];
    const fin = getSharedIouSettlementStatus(100, settlements);
    assertEqual(fin.remainingAmount, 60, 'confirmed remaining ignores pending');
    assertEqual(fin.availableToPropose, 40, 'available to propose subtracts pending');
    const unified = mapUnifiedLike(100, settlements);
    const markPaid = resolveMarkPaidRemainingAmount({
      originalAmount: unified.originalAmount,
      unifiedRemainingAmount: unified.amount,
      settlements: unified.allSettlements,
    });
    assertEqual(markPaid, 60, 'Mark Paid remaining stays 60 with pending 20');
  }

  // 6. Remap / re-resolve is idempotent (no second subtract on refresh)
  {
    const settlements = [settlement(40, 'confirmed')];
    const unified1 = mapUnifiedLike(100, settlements);
    const first = resolveMarkPaidRemainingAmount({
      originalAmount: unified1.originalAmount,
      unifiedRemainingAmount: unified1.amount,
      settlements: unified1.allSettlements,
    });
    const unified2 = mapUnifiedLike(100, settlements);
    const second = resolveMarkPaidRemainingAmount({
      originalAmount: unified2.originalAmount,
      unifiedRemainingAmount: unified2.amount,
      settlements: unified2.allSettlements,
    });
    // Simulate detail modal remount using already-remaining amount without original
    // (should still return 60, not 60 - 40)
    const fromUnifiedOnly = resolveMarkPaidRemainingAmount({
      unifiedRemainingAmount: unified2.amount,
      settlements: unified2.allSettlements,
    });
    assertEqual(first, 60, 'first resolve');
    assertEqual(second, 60, 'second resolve after remap');
    assertEqual(fromUnifiedOnly, 60, 'fallback must not re-subtract confirmed from remaining');
    assertEqual(first, second, 'idempotent across remaps');
  }

  console.log('All shared IOU settlement / Mark-as-Paid remaining tests passed.');
}

runTests();
