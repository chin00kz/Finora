import {
  analyzeCSVRows,
  csvImportFingerprint,
  parseCSV,
} from '../csvImporter';
import { computeApplyBalanceDeltas } from '../accountBalanceEffects';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function runTests() {
  console.log('Running CSV importer regression tests...');

  const csv = [
    'Date,Time,Type,Amount (LKR),Category,Account,To Account,Notes',
    '2024-01-15,10:00 AM,expense,100,Food,Cash,,Lunch',
    '2024-01-16,11:00 AM,transfer,500,,Cash,Bank,Move',
    '2024-01-17,12:00 PM,transfer,200,,Cash,,Missing dest',
    '2024-01-18,1:00 PM,transfer,50,,Cash,Cash,Self',
    '2024-01-19,2:00 PM,transfer,0,,Cash,Bank,Zero',
    '2024-01-20,3:00 PM,opening_balance,1000,,Cash,,Open',
    '2024-01-16,11:00 AM,transfer,500,,Cash,Bank,Move',
  ].join('\n');

  const rows = parseCSV(csv);
  const analysis = analyzeCSVRows(rows, {
    existingAccountNames: new Set(['cash', 'bank']),
    existingCategoryKeys: new Set(),
    existingTagNames: new Set(),
  });

  assertEqual(analysis.validRows.length, 2, 'Expense + valid transfer imported');
  assertEqual(analysis.transferCount, 1, 'One valid transfer counted');
  assertEqual(
    analysis.skippedRows.some(s => s.reason.includes('destination')),
    true,
    'Missing destination skipped with reason',
  );
  assertEqual(
    analysis.skippedRows.some(s => s.reason.includes('different')),
    true,
    'Self-transfer skipped',
  );
  assertEqual(
    analysis.skippedRows.some(s => s.reason.includes('Invalid or zero')),
    true,
    'Zero amount skipped',
  );
  assertEqual(
    analysis.skippedRows.some(s => s.reason.includes('Opening balance')),
    true,
    'Opening balance CSV rows skipped',
  );
  assertEqual(
    analysis.skippedRows.some(s => s.reason.includes('Duplicate')),
    true,
    'Duplicate transfer in file skipped',
  );

  const transfer = analysis.validRows.find(r => r.type === 'transfer')!;
  assertEqual(transfer.accountName, 'Cash', 'Transfer source');
  assertEqual(transfer.toAccountName, 'Bank', 'Transfer destination');

  // Balance apply for transfer: debit source, credit dest once
  const deltas = computeApplyBalanceDeltas({
    type: 'transfer',
    amount: transfer.amount,
    accountId: 'cash-id',
    toAccountId: 'bank-id',
  });
  assertEqual(deltas.get('cash-id'), -500, 'Transfer debit source once');
  assertEqual(deltas.get('bank-id'), 500, 'Transfer credit destination once');
  assertEqual(deltas.size, 2, 'Transfer touches exactly two accounts');

  // Legacy CSV without To Account column still imports expenses
  const legacy = parseCSV(
    ['Date,Type,Amount,Account', '2024-02-01,expense,20,Wallet'].join('\n'),
  );
  const legacyAnalysis = analyzeCSVRows(legacy, {
    existingAccountNames: new Set(),
    existingCategoryKeys: new Set(),
    existingTagNames: new Set(),
  });
  assertEqual(legacyAnalysis.validRows.length, 1, 'Legacy expense CSV still works');
  assertEqual(legacyAnalysis.accountsToCreate[0], 'Wallet', 'Missing account queued for create');

  // Fingerprint stability
  const fp = csvImportFingerprint({
    timestamp: 1,
    type: 'transfer',
    amount: 10,
    accountName: 'A',
    toAccountName: 'B',
    notes: 'x',
  });
  assertEqual(
    fp,
    csvImportFingerprint({
      timestamp: 1,
      type: 'transfer',
      amount: 10,
      accountName: 'a',
      toAccountName: 'b',
      notes: 'X',
    }),
    'Fingerprint is case-insensitive on names/notes',
  );

  console.log('All CSV importer tests passed.');
}

runTests();
