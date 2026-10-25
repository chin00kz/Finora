/**
 * Today = local midnight + create-after-replace handoff (no stranding / no double-count).
 */
import {
  budgetRangesOverlap,
  budgetsWithActivesClippedForCreate,
  clippedEndDateForEndedBudget,
  clippedEndDateForReplacedBudget,
  findOverlappingBudget,
  parseBudgetDateBounds,
  patchForReplacingBudget,
  resolveContinuationBounds,
  type BudgetLike,
} from '../budgetLifecycle';
import {
  listBudgetCountedExpenses,
  sumBudgetSpending,
  type SpendTxn,
} from '../spendingAmount';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type Txn = SpendTxn & { id: string };

function txn(partial: Partial<Txn> & Pick<Txn, 'id' | 'type' | 'amount' | 'date'>): Txn {
  return { excludeFromBudget: false, ...partial };
}

function runTests() {
  console.log('Running budget handoff / midnight regression tests...');

  const noon = new Date(2024, 5, 15, 12, 0, 0, 0).getTime();
  const morning = new Date(2024, 5, 15, 9, 0, 0, 0).getTime();
  const afternoon = new Date(2024, 5, 15, 15, 0, 0, 0).getTime();
  const todayMidnight = new Date(2024, 5, 15).getTime();
  const dayPool: Txn[] = [
    txn({ id: 'am', type: 'expense', amount: 10, date: morning }),
    txn({ id: 'pm', type: 'expense', amount: 20, date: afternoon }),
  ];

  // 1) Morning + afternoon on selected start day both count when start = today
  const bounds = parseBudgetDateBounds('2024-06-15', '2024-06-30', noon);
  assert(!('error' in bounds), 'today bounds parse');
  if ('error' in bounds) return;
  assertEqual(bounds.startDate, todayMidnight, 'Today start = local midnight (not now)');
  assertEqual(
    listBudgetCountedExpenses(dayPool, bounds)
      .map(t => t.id)
      .join(','),
    'pm,am',
    'Morning and afternoon both listed',
  );
  assertEqual(sumBudgetSpending(dayPool, bounds), 30, 'Full start-day spend counted');

  // 2) Option C replace at noon: new starts at handoff; morning stays on old
  const priorActive: BudgetLike = {
    id: 'old',
    name: 'Prior',
    status: 'active',
    startDate: new Date(2024, 5, 1).getTime(),
    endDate: new Date(2024, 5, 30, 23, 59, 59, 999).getTime(),
    amount: 1000,
    periodLength: 30,
    updatedAt: 1,
  };
  const replacePatch = patchForReplacingBudget(priorActive, noon, noon);
  assertEqual(replacePatch.status, 'ended', 'Replaced prior → ended');
  assertEqual(replacePatch.endDate, noon - 1, 'Replace clips to handoff-1');
  assertEqual(
    clippedEndDateForReplacedBudget(priorActive, noon, noon),
    noon - 1,
    'Replace clip helper matches',
  );

  const oldWindow = { startDate: priorActive.startDate, endDate: replacePatch.endDate };
  const newWindow = { startDate: noon, endDate: bounds.endDate };
  assert(!budgetRangesOverlap(oldWindow, newWindow), 'Abutting replace windows do not overlap');
  assertEqual(sumBudgetSpending(dayPool, oldWindow), 10, 'Morning remains on old before handoff');
  assertEqual(sumBudgetSpending(dayPool, newWindow), 20, 'Afternoon only on new period');
  assertEqual(
    sumBudgetSpending(dayPool, oldWindow) + sumBudgetSpending(dayPool, newWindow),
    30,
    'Exactly-once across replace handoff',
  );

  const simulated = budgetsWithActivesClippedForCreate([priorActive], noon, noon);
  assertEqual(
    findOverlappingBudget(newWindow, simulated),
    undefined,
    'Create overlap guard allows replace at handoff now',
  );

  // 3) No double-count across periods (inclusive adjacency at handoff)
  assert(
    !budgetRangesOverlap(
      { startDate: 1, endDate: noon - 1 },
      { startDate: noon, endDate: noon + 1 },
    ),
    'Inclusive adjacent periods do not double-cover a ms',
  );
  const straddling: Txn[] = [
    txn({ id: 'edge-old', type: 'expense', amount: 1, date: noon - 1 }),
    txn({ id: 'edge-new', type: 'expense', amount: 2, date: noon }),
  ];
  assertEqual(sumBudgetSpending(straddling, oldWindow), 1, 'Edge ms on old only');
  assertEqual(sumBudgetSpending(straddling, newWindow), 2, 'Handoff ms on new only');

  // 4) Already-ended periods unchanged by replace clip helpers / manual end stays now-1
  const historicalEnded: BudgetLike = {
    id: 'hist',
    name: 'May',
    status: 'ended',
    startDate: new Date(2024, 4, 1).getTime(),
    endDate: new Date(2024, 4, 31, 23, 59, 59, 999).getTime(),
    amount: 800,
    periodLength: 31,
    updatedAt: 1,
  };
  const histEndBefore = historicalEnded.endDate;
  const histSpendBefore = sumBudgetSpending(
    [
      txn({ id: 'h1', type: 'expense', amount: 40, date: new Date(2024, 4, 10).getTime() }),
      txn({ id: 'h2', type: 'expense', amount: 60, date: morning }),
    ],
    { startDate: historicalEnded.startDate, endDate: historicalEnded.endDate },
  );
  // Replace path only maps actives — ended row identity preserved in clip preview
  const preview = budgetsWithActivesClippedForCreate(
    [priorActive, historicalEnded],
    noon,
    bounds.startDate,
  );
  const histAfter = preview.find(b => b.id === 'hist');
  assertEqual(histAfter?.endDate, histEndBefore, 'Ended period endDate untouched');
  assertEqual(histAfter?.startDate, historicalEnded.startDate, 'Ended period startDate untouched');
  assertEqual(histAfter?.status, 'ended', 'Ended status untouched');
  assertEqual(histSpendBefore, 40, 'Historical window totals ignore out-of-range today spend');

  // Manual End (not replace) still clips to now-1 — distinct from replace handoff
  assertEqual(
    clippedEndDateForEndedBudget(priorActive, noon),
    noon - 1,
    'Manual end still clips to now-1',
  );

  // Continue: bump start past source.end so prior spend stays on ended period
  const endedAtNoonMinus: BudgetLike = {
    ...priorActive,
    status: 'ended',
    endDate: noon - 1,
  };
  const contParsed = parseBudgetDateBounds('2024-06-15', '2024-06-28', noon);
  assert(!('error' in contParsed), 'continue parse ok');
  if (!('error' in contParsed)) {
    const cont = resolveContinuationBounds(endedAtNoonMinus, contParsed);
    assert(!('error' in cont), 'continue bounds ok');
    if (!('error' in cont)) {
      assertEqual(cont.startDate, noon, 'Continue starts at source.endDate+1');
      assert(
        !budgetRangesOverlap(
          { startDate: endedAtNoonMinus.startDate, endDate: endedAtNoonMinus.endDate },
          cont,
        ),
        'Continue does not overlap source',
      );
      assertEqual(sumBudgetSpending(dayPool, cont), 20, 'Continue keeps morning on prior ended period');
      assertEqual(
        sumBudgetSpending(dayPool, {
          startDate: endedAtNoonMinus.startDate,
          endDate: endedAtNoonMinus.endDate,
        }),
        10,
        'Morning remains on ended source after continue',
      );
    }
  }

  console.log('All budget handoff / midnight tests passed.');
}

runTests();
