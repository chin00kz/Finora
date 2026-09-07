import React from 'react';
import { usePrivacyStore } from '../store/privacyStore';

interface FormatOptions {
  isMasked?: boolean;
  currency?: string;
  showSign?: boolean;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

/**
 * Pure helper function to format a number as currency, or return ••••• if masked.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  options: FormatOptions = {}
): string {
  const {
    isMasked = false,
    currency,
    showSign = false,
    decimals = 0,
    prefix = '',
    suffix = '',
  } = options;

  if (isMasked) {
    const currStr = currency ? `${currency} ` : '';
    return `${prefix}${currStr}•••••${suffix}`;
  }

  const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
  if (isNaN(num) || num === null || num === undefined) {
    return '—';
  }

  const sign = showSign && num > 0 ? '+' : num < 0 && !showSign ? '−' : '';
  const absFormatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const currStr = currency ? `${currency} ` : '';
  return `${prefix}${sign}${currStr}${absFormatted}${suffix}`;
}

interface MaskedAmountProps extends React.HTMLAttributes<HTMLSpanElement> {
  amount: number | string | null | undefined;
  currency?: string;
  showSign?: boolean;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

/**
 * React component that automatically listens to usePrivacyStore and renders formatted amount or •••••
 */
export default function MaskedAmount({
  amount,
  currency,
  showSign = false,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
  ...rest
}: MaskedAmountProps) {
  const isMasked = usePrivacyStore((state) => state.isMasked);

  const formatted = formatMoney(amount, {
    isMasked,
    currency,
    showSign,
    decimals,
    prefix,
    suffix,
  });

  return (
    <span className={`tabular-nums ${className}`} {...rest}>
      {formatted}
    </span>
  );
}

