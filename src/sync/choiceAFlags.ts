/**
 * Choice A kill-switch and pure preflight helpers (safe for Node tests).
 */
import { BACKUP_TABLE_KEYS, type BackupTableKey } from '../utils/jsonBackup';

/** Hard kill-switch. Do not flip without deploy verification + product approval. */
export const CHOICE_A_ENABLED = false;

export const KEEP_DEVICE_CONFIRMATION_PHRASE = 'KEEP DEVICE';

export const MAX_CHOICE_A_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_CHOICE_A_ROWS = 50_000;

export function isChoiceAAvailable(): boolean {
  return CHOICE_A_ENABLED;
}

export function choiceAUnavailableReason(): string {
  if (!CHOICE_A_ENABLED) {
    return (
      'Choice A (keep this device) is implemented but disabled until the Choice A ' +
      'database migrations are applied and enablement is explicitly approved. ' +
      'Client-side purge-and-repush is never used for reconciliation.'
    );
  }
  return 'Choice A is temporarily unavailable.';
}

export function evaluateChoiceAConfirmation(text: string): boolean {
  return text.trim() === KEEP_DEVICE_CONFIRMATION_PHRASE;
}

/** Pure preflight limits (also enforced server-side). */
export function evaluateChoiceAPayloadLimits(data: Record<BackupTableKey, unknown[]>): {
  ok: boolean;
  totalRows: number;
  approxBytes: number;
  reason?: 'empty' | 'too_many_rows' | 'too_large';
} {
  let totalRows = 0;
  for (const key of BACKUP_TABLE_KEYS) {
    totalRows += (data[key] || []).length;
  }
  const approxBytes = new TextEncoder().encode(JSON.stringify(data)).length;
  if (totalRows === 0) return { ok: false, totalRows, approxBytes, reason: 'empty' };
  if (totalRows > MAX_CHOICE_A_ROWS) {
    return { ok: false, totalRows, approxBytes, reason: 'too_many_rows' };
  }
  if (approxBytes > MAX_CHOICE_A_PAYLOAD_BYTES) {
    return { ok: false, totalRows, approxBytes, reason: 'too_large' };
  }
  return { ok: true, totalRows, approxBytes };
}
