import { calculateSplit, SplitInput } from './src/utils/splitEngine.js';

function assertEqual(actual: any, expected: any, msg: string) {
  if (Math.abs(actual - expected) > 0.0001) {
    throw new Error(`Assertion failed: ${msg}. Expected ${expected}, got ${actual}`);
  }
}

console.log("Running comprehensive splitEngine tests...");

// Equal: 6000 / 4
let t: SplitInput[] = [
  { personId: 'A', baseAmount: 0 },
  { personId: 'B', baseAmount: 0 },
  { personId: 'C', baseAmount: 0 },
  { personId: 'D', baseAmount: 0 },
];
let r = calculateSplit(6000, t, 'equal');
assertEqual(r.length, 4, "4 people");
assertEqual(r[0].finalAmount, 1500, "Equal 6000/4 - A");
assertEqual(r.reduce((sum, p) => sum + p.finalAmount, 0), 6000, "Sum is 6000");

// Equal: 1000 / 3
t = [
  { personId: 'Z', baseAmount: 0 },
  { personId: 'A', baseAmount: 0 },
  { personId: 'X', baseAmount: 0 },
];
r = calculateSplit(1000, t, 'equal');
assertEqual(r.find(p => p.personId === 'A')!.finalAmount, 333.34, "A gets extra cent");
assertEqual(r.find(p => p.personId === 'Z')!.finalAmount, 333.33, "Z gets base");
assertEqual(r.reduce((sum, p) => sum + p.finalAmount, 0), 1000, "Sum is exactly 1000");

// Equal: 1 / 3 in smallest supported unit
t = [
  { personId: 'P1', baseAmount: 0 },
  { personId: 'P2', baseAmount: 0 },
  { personId: 'P3', baseAmount: 0 },
];
r = calculateSplit(0.01, t, 'equal');
assertEqual(r.find(p => p.personId === 'P1')!.finalAmount, 0.01, "P1 gets 1 cent");
assertEqual(r.find(p => p.personId === 'P2')!.finalAmount, 0, "P2 gets 0");
assertEqual(r.reduce((sum, p) => sum + p.finalAmount, 0), 0.01, "Sum is 0.01");

// Custom: 6000 with bases 1500 / 2000 / 1700
t = [
  { personId: 'A', baseAmount: 1500 },
  { personId: 'B', baseAmount: 2000 },
  { personId: 'C', baseAmount: 1700 },
];
r = calculateSplit(6000, t, 'custom');
assertEqual(r.find(p => p.personId === 'A')!.finalAmount, 1766.67, "Custom A");
assertEqual(r.find(p => p.personId === 'B')!.finalAmount, 2266.67, "Custom B");
assertEqual(r.find(p => p.personId === 'C')!.finalAmount, 1966.66, "Custom C");
assertEqual(r.reduce((sum, p) => sum + p.finalAmount, 0), 6000, "Sum is exactly 6000");

// Custom: selected base 0 participates
t = [
  { personId: 'A', baseAmount: 0 },
  { personId: 'B', baseAmount: 2000 },
  { personId: 'C', baseAmount: 2000 },
];
r = calculateSplit(4600, t, 'custom');
assertEqual(r.find(p => p.personId === 'A')!.finalAmount, 200, "A base 0 participates");
assertEqual(r.find(p => p.personId === 'B')!.finalAmount, 2200, "B gets 2200");
assertEqual(r.reduce((sum, p) => sum + p.finalAmount, 0), 4600, "Sum is 4600");

// Custom: bases exactly equal total
t = [
  { personId: 'A', baseAmount: 2000 },
  { personId: 'B', baseAmount: 4000 },
];
r = calculateSplit(6000, t, 'custom');
assertEqual(r.find(p => p.personId === 'A')!.finalAmount, 2000, "A gets 2000");
assertEqual(r.find(p => p.personId === 'B')!.finalAmount, 4000, "B gets 4000");

// Custom: bases exceed total -> rejected
t = [
  { personId: 'A', baseAmount: 4000 },
  { personId: 'B', baseAmount: 4000 },
];
let threw = false;
try { calculateSplit(6000, t, 'custom'); } catch (e) { threw = true; }
assertEqual(threw, true, "Should throw if bases exceed total");

console.log("All comprehensive tests passed!");
