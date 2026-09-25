export type SplitMode = 'equal' | 'custom';

export interface SplitInput {
  personId: string;
  baseAmount: number;
}

export interface SplitResult {
  personId: string;
  baseAmount: number;
  sharedAmount: number;
  finalAmount: number;
}

/**
 * Deterministically distributes the remainder to ensure exact sums.
 * The input array should already be sorted if you want deterministic results across calls.
 * We sort by personId internally for stability.
 */
export function calculateSplit(
  totalAmount: number,
  participants: SplitInput[],
  mode: SplitMode
): SplitResult[] {
  if (participants.length === 0) return [];
  if (totalAmount < 0) throw new Error('Total amount cannot be negative');

  // To ensure deterministic remainder distribution, sort by personId
  const sortedParticipants = [...participants].sort((a, b) => a.personId.localeCompare(b.personId));

  const results: SplitResult[] = sortedParticipants.map(p => ({
    personId: p.personId,
    baseAmount: p.baseAmount,
    sharedAmount: 0,
    finalAmount: p.baseAmount,
  }));

  let sharedRemainder = totalAmount;

  if (mode === 'custom') {
    const sumBase = results.reduce((sum, p) => sum + p.baseAmount, 0);
    if (sumBase > totalAmount) {
      throw new Error('Base amounts exceed total amount');
    }
    sharedRemainder = totalAmount - sumBase;
  } else {
    // In equal mode, base amounts are treated as 0 for the remainder calculation
    results.forEach(p => p.baseAmount = 0);
    sharedRemainder = totalAmount;
  }

  if (sharedRemainder > 0) {
    const participantCount = results.length;
    // Assume amounts are in their smallest unit (e.g. cents) or integers
    // We will do integer division based on Math.floor
    // If Finora uses standard number formatting, we should probably do rounding to 2 decimal places.
    // The prompt: "Use integer/minor-unit-safe split calculations. Do not assume two decimal places without verifying current currency handling."
    // Given JS numbers, working with integers multiplied by 100 is safest if it's fiat currency.
    // However, LKR might be stored as normal floats (e.g. 6000.50). 
    // Let's multiply by 100, do integer math, then divide by 100.
    
    const remainderCents = Math.round(sharedRemainder * 100);
    const perPersonCents = Math.floor(remainderCents / participantCount);
    let oddCents = remainderCents % participantCount;

    results.forEach(p => {
      let extraCent = 0;
      if (oddCents > 0) {
        extraCent = 1;
        oddCents--;
      }
      const sharedCents = perPersonCents + extraCent;
      p.sharedAmount = sharedCents / 100;
      p.finalAmount = Math.round((p.baseAmount + p.sharedAmount) * 100) / 100;
    });
  }

  // Restore original array order
  return participants.map(p => results.find(r => r.personId === p.personId)!);
}
