/**
 * createId.ts
 *
 * Single source of truth for generating local record IDs.
 * Replaces the inline `${prefix}-${Date.now()}-${Math.random()...}` pattern
 * that was copy-pasted across 11+ call sites.
 *
 * Uses a monotonic counter so rapid successive calls never produce the same
 * timestamp component — eliminates the `Date.now() + 1` hack in syncEngine.ts.
 */

let _last = 0;

export function createId(prefix: string): string {
  const now = Date.now();
  _last = now <= _last ? _last + 1 : now;
  return `${prefix}-${_last}-${Math.random().toString(36).substring(2, 9)}`;
}
