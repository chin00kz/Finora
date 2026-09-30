/**
 * Pure state logic for the Propose Payment flow.
 * Ensures deposit amount securely tracks the payment amount unless explicitly overridden.
 */
export function calculateMainAmountChange(
  newAmount: string,
  currentDepositAmount: string,
  isDepositOverridden: boolean
): { nextAmount: string; nextDepositAmount: string } {
  return {
    nextAmount: newAmount,
    nextDepositAmount: isDepositOverridden ? currentDepositAmount : newAmount
  };
}
