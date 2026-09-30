import assert from 'assert';
import { calculateMainAmountChange } from '../paymentStateEngine';

function runTests() {
  console.log("Running automated regression test for partial payment explicit override bug...");

  // Scenario 1: Exact bug replication (500 -> 300)
  // IOU remaining amount starts at 500, payment defaults to 500
  // Pay from account is enabled. User has NOT manually touched the deposit amount (isDepositOverridden = false)
  // User changes payment amount to 300
  let currentDepositAmount = "500";
  let newAmount = "300";
  let isDepositOverridden = false;

  let result = calculateMainAmountChange(newAmount, currentDepositAmount, isDepositOverridden);

  assert.strictEqual(result.nextAmount, "300", "Submitted shared settlement amount must be 300");
  assert.strictEqual(result.nextDepositAmount, "300", "Queued local account transaction/outbox amount must also be 300 (synced)");
  
  console.log("? Scenario 1 passed: Modifying main amount correctly cascades to untouched deposit amount.");

  // Scenario 2: Intentional override
  // User explicitly changes the account amount themselves
  // This sets isDepositOverridden = true in the component
  isDepositOverridden = true;
  currentDepositAmount = "450"; // User explicitly changed this
  newAmount = "400"; // User now changes main amount

  result = calculateMainAmountChange(newAmount, currentDepositAmount, isDepositOverridden);

  assert.strictEqual(result.nextAmount, "400", "Submitted shared settlement amount updates to 400");
  assert.strictEqual(result.nextDepositAmount, "450", "Queued local outbox amount MUST NOT be overwritten if intentionally overridden");

  console.log("? Scenario 2 passed: Intentional deposit amount override is preserved.");

  console.log("All tests passed! Invariant proven: untouched account/outbox amount syncs, intentional overrides are explicitly preserved.");
}

runTests();
