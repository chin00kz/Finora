/**
 * Audit fixes: overlap guards, same-day edit stability, archive/restore,
 * natural expiry, continuation integrity.
 */
import {
  activeBudgetIdsPastEnd,
  budgetRangesOverlap,
  budgetsWithActivesClippedForCreate,
  canContinueBudget,
  canRestoreArchivedBudget,
  clippedEndDateForEndedBudget,
  computeContinuationCarryForward,
  continuationBudgetId,
  findOverlappingBudget,
  formatLocalDateInput,
  hasContinuationOf,
  patchForNaturalBudgetExpiry,
  patchForRestoringArchivedBudget,
  resolveBudgetEditBounds,
  type BudgetLike,
} from '../budgetLifecycle';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function runTests() {
  console.log('Running budget audit-fix regression tests...');

  const noon = new Date(2024, 5, 15, 12, 0, 0, 0).getTime();

  // Overlap boundaries (inclusive)
  assert(budgetRangesOverlap({ startDate: 1, endDate: 10 }, { startDate: 10, endDate: 20 }), 'Touching end/start overlaps');
  assert(budgetRangesOverlap({ startDate: 1, endDate: 10 }, { startDate: 5, endDate: 8 }), 'Contained overlaps');
  assert(!budgetRangesOverlap({ startDate: 1, endDate: 10 }, { startDate: 11, endDate: 20 }), 'Adjacent non-overlap');

  const ended: BudgetLike = {
    id: 'e1',
    name: 'May',
    status: 'ended',
    startDate: 100,
    endDate: 200,
    amount: 1000,
    periodLength: 10,
    updatedAt: 1,
  };
  const archived: BudgetLike = {
    id: 'a1',
    name: 'Old',
    status: 'archived',
    startDate: 150,
    endDate: 180,
    amount: 500,
    periodLength: 5,
    updatedAt: 2,
  };
  assertEqual(
    findOverlappingBudget({ startDate: 150, endDate: 160 }, [ended, archived])?.id,
    'e1',
    'Overlap finds ended, ignores archived',
  );
  assertEqual(
    findOverlappingBudget({ startDate: 150, endDate: 160 }, [ended, archived], 'e1'),
    undefined,
    'excludeId skips self',
  );

  // Create replace: clipped active ends before new period start (today midnight)
  const todayMidnight = new Date(2024, 5, 15).getTime();
  const active: BudgetLike = {
    id: 'act',
    name: 'Current',
    status: 'active',
    startDate: noon - 7 * 86400000,
    endDate: noon + 7 * 86400000,
    amount: 1000,
    periodLength: 14,
    updatedAt: 3,
  };
  const clipped = budgetsWithActivesClippedForCreate([active, ended], noon, todayMidnight);
  assertEqual(
    clipped.find(b => b.id === 'act')?.endDate,
    todayMidnight - 1,
    'Active clipped to newStart-1 on replace',
  );
  assertEqual(
    findOverlappingBudget({ startDate: todayMidnight, endDate: noon + 10 * 86400000 }, clipped),
    undefined,
    'New period at today midnight does not overlap clipped prior active',
  );
  assert(
    !!findOverlappingBudget({ startDate: 120, endDate: 180 }, clipped),
    'Create still blocked when overlapping another ended period',
  );

  // Same-day edit stability (today start preserved)
  const todayStart = noon;
  const editSameDay = resolveBudgetEditBounds(
    { startDate: todayStart, endDate: noon + 10 * 86400000 },
    formatLocalDateInput(new Date(noon)),
    formatLocalDateInput(new Date(noon + 20 * 86400000)),
    noon + 3 * 3600000, // later same day
  );
  assert(!('error' in editSameDay), 'edit bounds ok');
  if (!('error' in editSameDay)) {
    assertEqual(editSameDay.startDate, todayStart, 'Unchanged today start keeps exact timestamp');
    assert(editSameDay.endDate > editSameDay.startDate, 'end after preserved start');
  }

  // Changing start day still uses parse rules (past → midnight)
  const editMoved = resolveBudgetEditBounds(
    { startDate: todayStart, endDate: noon + 10 * 86400000 },
    '2024-06-01',
    '2024-06-30',
    noon,
  );
  assert(!('error' in editMoved), 'moved start ok');
  if (!('error' in editMoved)) {
    assertEqual(editMoved.startDate, new Date(2024, 5, 1).getTime(), 'Changed start uses local midnight');
  }

  // Archive → restore (no id overwrite)
  const restorePatch = patchForRestoringArchivedBudget(noon);
  assertEqual(restorePatch.status, 'ended', 'Restore returns ended');
  assert(!('startDate' in restorePatch), 'Restore does not rewrite dates');
  assertEqual(canRestoreArchivedBudget(archived, [archived]).ok, true, 'Restore ok when alone');
  assert(
    !canRestoreArchivedBudget(archived, [archived, ended]).ok,
    'Restore blocked when window overlaps ended',
  );
  assert(!canRestoreArchivedBudget(ended, [ended]).ok, 'Non-archived cannot restore');

  // Natural expiry keeps planned endDate
  const nat = patchForNaturalBudgetExpiry(noon);
  assertEqual(nat.status, 'ended', 'Natural expiry status');
  assert(!('endDate' in nat), 'Natural expiry does not clip endDate');
  assertEqual(
    activeBudgetIdsPastEnd(
      [{ ...active, endDate: noon - 1 }],
      noon,
    ).join(','),
    'act',
    'Past-end active detected for expiry',
  );
  assertEqual(
    clippedEndDateForEndedBudget(active, noon),
    noon - 1,
    'Manual end still clips',
  );

  // Continuation integrity: archived continuation still occupies id; no reuse
  const source: BudgetLike = {
    id: 'bud-1',
    name: 'June',
    status: 'ended',
    startDate: noon - 20 * 86400000,
    endDate: noon - 86400000,
    amount: 1000,
    periodLength: 14,
    updatedAt: 1,
  };
  const contArchived: BudgetLike = {
    id: continuationBudgetId(source.id),
    name: 'June',
    status: 'archived',
    startDate: noon,
    endDate: noon + 14 * 86400000,
    amount: 900,
    periodLength: 14,
    updatedAt: 2,
  };
  assert(hasContinuationOf(source.id, [source, contArchived]), 'Archived cont occupies slot');
  assert(!canContinueBudget(source, [source, contArchived]).ok, 'Cannot continue over archived cont id');
  // Restore continuation → ended; still cannot continue (id remains)
  const contRestored = { ...contArchived, status: 'ended' as const };
  assert(!canContinueBudget(source, [source, contRestored]).ok, 'Restored cont still blocks continue');
  // Carry math unchanged
  assertEqual(computeContinuationCarryForward(1000, 100).carriedForward, 900, 'Carry 900 intact');

  console.log('All budget audit-fix tests passed.');
}

runTests();
