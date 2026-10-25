/**
 * Multi-period create overlap recovery (fixed end, jump-across conflicts).
 */
import {
  budgetsForOverlapCheck,
  budgetsWithActivesClippedForCreate,
  clippedEndDateForEndedBudget,
  describeBudgetOverlapConflict,
  findEarliestNonOverlappingPickerStart,
  findOverlappingBudget,
  parseBudgetDateBounds,
  patchForReplacingBudget,
  resolveOverlapRecoveryClick,
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
  console.log('Running budget create overlap-recovery tests...');

  const noon = new Date(2024, 5, 15, 12, 0, 0, 0).getTime();

  const asEnded = (b: BudgetLike, endDate: number): BudgetLike => ({
    ...b,
    status: 'ended',
    endDate,
  });

  // Manual End today
  const priorActive: BudgetLike = {
    id: 'old',
    name: 'June Spend',
    status: 'active',
    startDate: new Date(2024, 5, 1).getTime(),
    endDate: new Date(2024, 5, 30, 23, 59, 59, 999).getTime(),
    amount: 1000,
    periodLength: 30,
    updatedAt: 1,
  };
  const endedToday = asEnded(priorActive, clippedEndDateForEndedBudget(priorActive, noon));
  const endedSnapshot = { startDate: endedToday.startDate, endDate: endedToday.endDate };

  // Future period that overlaps the naive "tomorrow" suggestion
  const future: BudgetLike = {
    id: 'fut',
    name: 'Trip',
    status: 'ended',
    startDate: new Date(2024, 5, 16).getTime(),
    endDate: new Date(2024, 5, 20, 23, 59, 59, 999).getTime(),
    amount: 500,
    periodLength: 5,
    updatedAt: 2,
  };

  // 1) Manual End today + future covering first suggested start → jump past future
  const planMulti = findEarliestNonOverlappingPickerStart({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-07-15',
    budgets: [endedToday, future],
    checkMode: 'create',
    now: noon,
  });
  assert(planMulti.ok, 'multi-conflict plan ok');
  if (planMulti.ok) {
    assertEqual(planMulti.earliestStartDateStr, '2024-06-21', 'Skips same-day handoff + future Trip');
    // Same-day ended is handoff-clipped; first remaining blocker is Trip
    assert(planMulti.message.includes('Trip'), 'Names first real remaining conflict');
    assert(planMulti.message.includes('2024-06-21'), 'Message cites verified start');
  }

  const detailsMulti = describeBudgetOverlapConflict({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-07-15',
    budgets: [endedToday, future],
    checkMode: 'create',
    now: noon,
    conflict: endedToday,
  });
  assertEqual(detailsMulti.earliestStartDateStr, '2024-06-21', 'UI recovery start skips future');
  assert(!!detailsMulti.earliestStartDateStr, 'Recovery button eligible');

  // Applying recovery (start only) clears overlap; does not mutate ended rows
  const recoveredBounds = parseBudgetDateBounds('2024-06-21', '2024-07-15', noon);
  assert(!('error' in recoveredBounds), 'recovered bounds');
  if (!('error' in recoveredBounds)) {
    assertEqual(
      findOverlappingBudget(
        recoveredBounds,
        budgetsForOverlapCheck([endedToday, future], 'create', recoveredBounds.startDate, noon),
      ),
      undefined,
      'Recovered window free under create clip rules',
    );
  }
  assertEqual(endedToday.startDate, endedSnapshot.startDate, 'Ended start untouched');
  assertEqual(endedToday.endDate, endedSnapshot.endDate, 'Ended end untouched');
  assertEqual(future.startDate, new Date(2024, 5, 16).getTime(), 'Future start untouched');

  // 2) Multiple consecutive / adjacent conflicts
  const blockA: BudgetLike = {
    id: 'a',
    name: 'A',
    status: 'ended',
    startDate: new Date(2024, 5, 15).getTime(),
    endDate: new Date(2024, 5, 17, 23, 59, 59, 999).getTime(),
    amount: 1,
    periodLength: 3,
    updatedAt: 1,
  };
  const blockB: BudgetLike = {
    id: 'b',
    name: 'B',
    status: 'ended',
    startDate: new Date(2024, 5, 18).getTime(), // adjacent after A (inclusive-safe)
    endDate: new Date(2024, 5, 19, 23, 59, 59, 999).getTime(),
    amount: 1,
    periodLength: 2,
    updatedAt: 2,
  };
  const planAdj = findEarliestNonOverlappingPickerStart({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-07-01',
    budgets: [blockA, blockB],
    checkMode: 'create',
    now: noon,
  });
  assert(planAdj.ok, 'adjacent plan ok');
  if (planAdj.ok) {
    assertEqual(planAdj.earliestStartDateStr, '2024-06-20', 'Jumps past A then B');
  }

  // 3) No valid start before chosen end
  const covering: BudgetLike = {
    id: 'cover',
    name: 'Cover',
    status: 'ended',
    startDate: new Date(2024, 5, 10).getTime(),
    endDate: new Date(2024, 5, 30, 23, 59, 59, 999).getTime(),
    amount: 1,
    periodLength: 21,
    updatedAt: 1,
  };
  const planNone = findEarliestNonOverlappingPickerStart({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-06-20',
    budgets: [covering],
    checkMode: 'create',
    now: noon,
  });
  assert(!planNone.ok, 'no gap → ok:false');
  assert(planNone.message.includes('Extend the end date'), 'Unavailable explains extend end');
  const detailsNone = describeBudgetOverlapConflict({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-06-20',
    budgets: [covering],
    checkMode: 'create',
    now: noon,
    conflict: covering,
  });
  assertEqual(detailsNone.earliestStartDateStr, null, 'No recovery button when no gap');

  // 4) Archived does not block
  const archived: BudgetLike = {
    id: 'arch',
    name: 'Archived',
    status: 'archived',
    startDate: new Date(2024, 5, 16).getTime(),
    endDate: new Date(2024, 5, 25, 23, 59, 59, 999).getTime(),
    amount: 1,
    periodLength: 10,
    updatedAt: 3,
  };
  const planArch = findEarliestNonOverlappingPickerStart({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-07-15',
    budgets: [endedToday, archived],
    checkMode: 'create',
    now: noon,
  });
  assert(planArch.ok, 'archived ignored');
  if (planArch.ok) {
    assertEqual(
      planArch.earliestStartDateStr,
      '2024-06-15',
      'Same-day ended handoff-clipped; archived ignored; today valid',
    );
  }

  // 5) Active replacement clipping matches submit during recovery
  const stillActive: BudgetLike = {
    id: 'live',
    name: 'Live',
    status: 'active',
    startDate: new Date(2024, 5, 1).getTime(),
    endDate: new Date(2024, 6, 15, 23, 59, 59, 999).getTime(),
    amount: 2000,
    periodLength: 45,
    updatedAt: 9,
  };
  // Alone, create-replace should allow today midnight (active clipped to newStart-1)
  const planActiveOnly = findEarliestNonOverlappingPickerStart({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-07-15',
    budgets: [stillActive],
    checkMode: 'create',
    now: noon,
  });
  assert(planActiveOnly.ok, 'active-only create ok');
  if (planActiveOnly.ok) {
    assertEqual(
      planActiveOnly.earliestStartDateStr,
      '2024-06-15',
      'Active does not force later start under create clip',
    );
  }
  const createBounds = parseBudgetDateBounds('2024-06-15', '2024-07-15', noon);
  assert(!('error' in createBounds), 'create bounds');
  if (!('error' in createBounds)) {
    const recoveryPool = budgetsForOverlapCheck([stillActive], 'create', createBounds.startDate, noon);
    const submitPool = budgetsWithActivesClippedForCreate([stillActive], noon, createBounds.startDate);
    assertEqual(
      recoveryPool.find(b => b.id === 'live')?.endDate,
      submitPool.find(b => b.id === 'live')?.endDate,
      'Recovery clip end matches submit clip end',
    );
    assertEqual(
      recoveryPool.find(b => b.id === 'live')?.endDate,
      patchForReplacingBudget(stillActive, createBounds.startDate, noon).endDate,
      'Recovery clip matches patchForReplacingBudget',
    );
    assertEqual(
      findOverlappingBudget(createBounds, recoveryPool),
      undefined,
      'Create submit guard agrees with recovery pool',
    );
  }

  // Active + endedToday: still need June 16 (active clipped away; ended blocks today)
  const planActiveEnded = findEarliestNonOverlappingPickerStart({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-07-15',
    budgets: [stillActive, endedToday],
    checkMode: 'create',
    now: noon,
  });
  assert(planActiveEnded.ok, 'active+ended ok');
  if (planActiveEnded.ok) {
    assertEqual(
      planActiveEnded.earliestStartDateStr,
      '2024-06-15',
      'Active replace + same-day ended handoff allow today',
    );
  }

  // 6) Recovery never mutates historical rows / never implies auto-submit
  // (pure helpers only return strings; button path is start-field update + revalidate)
  assertEqual(endedToday.endDate, endedSnapshot.endDate, 'Historical end still unchanged at end');
  assert(
    detailsMulti.earliestStartDateStr !== null && detailsNone.earliestStartDateStr === null,
    'Recovery action is optional and gated on verified start',
  );

  // 7) Fresh list after LiveQuery snapshot: stale button date must not be trusted
  const staleSnapshot: BudgetLike[] = [endedToday, future];
  const stalePlan = describeBudgetOverlapConflict({
    minStartDateStr: '2024-06-15',
    endDateStr: '2024-07-15',
    budgets: staleSnapshot,
    checkMode: 'create',
    now: noon,
    conflict: future,
  });
  assertEqual(stalePlan.earliestStartDateStr, '2024-06-21', 'Stale snapshot suggests day after Trip');

  const addedLater: BudgetLike = {
    id: 'late',
    name: 'Added Later',
    status: 'ended',
    startDate: new Date(2024, 5, 21).getTime(),
    endDate: new Date(2024, 5, 22, 23, 59, 59, 999).getTime(),
    amount: 1,
    periodLength: 2,
    updatedAt: 99,
  };
  const freshClick = resolveOverlapRecoveryClick({
    latestBudgets: [endedToday, future, addedLater],
    startDateStr: '2024-06-15',
    endDateStr: '2024-07-15',
    checkMode: 'create',
    staleSuggestedStartDateStr: stalePlan.earliestStartDateStr!,
    now: noon,
  });
  assertEqual(freshClick.action, 'apply', 'Fresh read still finds a recoverable start');
  if (freshClick.action === 'apply') {
    assertEqual(freshClick.startDateStr, '2024-06-23', 'Recomputes past the newly added period');
    assertEqual(freshClick.suggestionUpdated, true, 'Detects stale button suggestion');
  }

  const staleBounds = parseBudgetDateBounds('2024-06-21', '2024-07-15', noon);
  assert(!('error' in staleBounds), 'stale bounds parse');
  if (!('error' in staleBounds)) {
    assertEqual(
      findOverlappingBudget(
        staleBounds,
        budgetsForOverlapCheck(
          [endedToday, future, addedLater],
          'create',
          staleBounds.startDate,
          noon,
        ),
      )?.id,
      'late',
      'Stale suggestion overlaps the budget added after the snapshot',
    );
  }

  assertEqual(endedToday.endDate, endedSnapshot.endDate, 'Fresh recovery path does not mutate ended rows');
  assertEqual(addedLater.endDate, new Date(2024, 5, 22, 23, 59, 59, 999).getTime(), 'Added row unchanged');

  console.log('All budget create overlap-recovery tests passed.');
}

runTests();
