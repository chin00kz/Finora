/**
 * Exercises production gates from dirtyProtection.ts (called by syncEngine).
 * applyUpsertDirtyResult is tested with a mock clear callback — the same
 * function pushDirtyRecords uses to clear or retain dirty IDs.
 */
import {
  applyUpsertDirtyResult,
  shouldApplyRemoteUpsert,
  shouldTombstoneLocalOnPull,
} from '../dirtyProtection';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function runTests() {
  console.log('Running push dirty-protection regression tests...');

  const missingTableError = {
    code: '42P01',
    message: 'relation "public.transactions" does not exist',
  };

  // Scenario 1: Missing-table push failure preserves dirty IDs
  let cleared = false;
  assertEqual(
    applyUpsertDirtyResult(missingTableError, () => {
      cleared = true;
    }),
    'retained',
    'Missing-table upsert must retain dirty',
  );
  assertEqual(cleared, false, 'Missing-table upsert must not invoke clearDirty');

  cleared = false;
  assertEqual(
    applyUpsertDirtyResult({ message: 'Failed to fetch' }, () => {
      cleared = true;
    }),
    'retained',
    'Network upsert error must retain dirty',
  );
  assertEqual(cleared, false, 'Network upsert error must not invoke clearDirty');
  console.log('✓ Scenario 1 passed: failed upsert (incl. missing table) retains dirty.');

  // Scenario 2: Later pull cannot delete unsynced local record while dirty
  const now = 1_700_000_000_000;
  assertEqual(
    shouldTombstoneLocalOnPull({
      presentInRemote: false,
      isDirty: true,
      updatedAt: now - 120_000,
      now,
    }),
    false,
    'Dirty local row absent from cloud must not be tombstoned',
  );
  assertEqual(
    shouldTombstoneLocalOnPull({
      presentInRemote: false,
      isDirty: false,
      updatedAt: now - 120_000,
      now,
    }),
    true,
    'Non-dirty aged local row absent from cloud may still be tombstoned',
  );
  console.log('✓ Scenario 2 passed: dirty protects unsynced local row from pull delete.');

  // Scenario 3: Successful upsert still clears dirty IDs
  cleared = false;
  assertEqual(
    applyUpsertDirtyResult(null, () => {
      cleared = true;
    }),
    'cleared',
    'Successful upsert must clear dirty',
  );
  assertEqual(cleared, true, 'Successful upsert must invoke clearDirty');
  console.log('✓ Scenario 3 passed: successful upsert clears dirty.');

  // Scenario 4: Pending cloud-delete must not be revived by pull/realtime
  assertEqual(
    shouldApplyRemoteUpsert({
      id: 'acc-deleted',
      pendingDeleteIds: ['acc-deleted'],
      hasLocal: false,
      localUpdatedAt: 0,
      remoteUpdatedAt: now,
    }),
    false,
    'Pending-delete account must not be recreated from remote',
  );
  assertEqual(
    shouldApplyRemoteUpsert({
      id: 'acc-ok',
      pendingDeleteIds: ['acc-deleted'],
      hasLocal: false,
      localUpdatedAt: 0,
      remoteUpdatedAt: now,
    }),
    true,
    'Unrelated remote account may still be created',
  );
  assertEqual(
    shouldApplyRemoteUpsert({
      id: 'acc-ok',
      pendingDeleteIds: [],
      hasLocal: true,
      localUpdatedAt: now,
      remoteUpdatedAt: now - 1,
    }),
    false,
    'Older remote row must not overwrite newer local',
  );
  console.log('✓ Scenario 4 passed: pending deletes block remote revive.');

  console.log('All push dirty-protection tests passed.');
}

runTests();
