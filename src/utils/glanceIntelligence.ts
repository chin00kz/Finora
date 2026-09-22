import type { Transaction } from '../db/db';

export function getBudgetGlanceColors(percent: number, isEnabled: boolean) {
  if (!isEnabled) {
    return {
      barColor: 'bg-foreground',
      textColor: 'text-muted-foreground',
    };
  }

  if (percent < 25) {
    return {
      barColor: 'bg-muted-foreground',
      textColor: 'text-muted-foreground',
    };
  } else if (percent < 50) {
    return {
      barColor: 'bg-emerald-500',
      textColor: 'text-emerald-500',
    };
  } else if (percent < 75) {
    return {
      barColor: 'bg-amber-500',
      textColor: 'text-amber-500',
    };
  } else if (percent < 90) {
    return {
      barColor: 'bg-orange-500',
      textColor: 'text-orange-500',
    };
  } else {
    return {
      barColor: 'bg-red-500',
      textColor: 'text-red-500',
    };
  }
}

export function getTransactionBaseline(transactions: Transaction[]): number | null {
  const recentExpenses = transactions
    .filter(t => t.type === 'expense' && !t.excludeFromBudget && (Date.now() - t.date < 90 * 24 * 60 * 60 * 1000))
    .map(t => Math.abs(t.amount))
    .sort((a, b) => a - b);
    
  if (recentExpenses.length < 5) return null; // Fallback to neutral if not enough data
  
  const mid = Math.floor(recentExpenses.length / 2);
  const median = recentExpenses.length % 2 !== 0 
    ? recentExpenses[mid] 
    : (recentExpenses[mid - 1] + recentExpenses[mid]) / 2;
    
  // Avoid returning a baseline of 0 if they recorded 0 amount transactions
  return median > 0 ? median : null;
}

export function getTransactionGlanceColor(amount: number, type: string, baseline: number | null, isEnabled: boolean): string {
  // Income retains positive semantic color
  if (type === 'income') return 'text-emerald-500';
  
  // Transfers or disabled features remain neutral
  if (type === 'transfer' || !isEnabled || !baseline) return 'text-foreground';
  
  const ratio = Math.abs(amount) / baseline;
  
  if (ratio <= 1.5) return 'text-foreground';         // Normal
  if (ratio <= 2.5) return 'text-amber-500';          // Somewhat unusual
  if (ratio <= 4.0) return 'text-orange-500';         // Large
  return 'text-red-500';                              // Exceptional
}
