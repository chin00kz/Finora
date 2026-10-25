/**
 * Pure comparison / validation helpers for cloud reconciliation.
 * No Supabase or Dexie imports — safe for Node regression tests.
 */
import { BACKUP_TABLE_KEYS, type BackupTableKey } from '../utils/jsonBackup';

export const USE_CLOUD_CONFIRMATION_PHRASE = 'USE CLOUD';

/** Pure: whether Choice B may apply this fresh cloud snapshot against a preview. */
export function evaluateChoiceBCloudFreshness(params: {
  previewFingerprint: string;
  freshFingerprint: string;
  freshFetchOk: boolean;
  freshIntegrityOk: boolean;
}): { ok: true } | { ok: false; reason: 'incomplete_or_failed_fetch' | 'integrity_failed' | 'stale_preview' } {
  if (!params.freshFetchOk) {
    return { ok: false, reason: 'incomplete_or_failed_fetch' };
  }
  if (!params.freshIntegrityOk) {
    return { ok: false, reason: 'integrity_failed' };
  }
  if (params.freshFingerprint !== params.previewFingerprint) {
    return { ok: false, reason: 'stale_preview' };
  }
  return { ok: true };
}

const COMPARE_IGNORE_KEYS = new Set([
  'updatedAt',
  'updated_at',
  'user_id',
  'userId',
  'datasetEpoch',
  'dataset_epoch',
]);

export interface TableDiffSummary {
  table: BackupTableKey;
  localOnlyIds: string[];
  cloudOnlyIds: string[];
  differentIds: string[];
  equalCount: number;
  localCount: number;
  cloudCount: number;
}

export interface AccountTxnConsistencyWarning {
  accountId: string;
  accountName?: string;
  kind:
    | 'balance_mismatch'
    | 'linked_txn_set_mismatch'
    | 'missing_account_ref'
    | 'missing_transfer_ref';
  detail: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Strip sync-only metadata, then stable-serialize for whole-record compare. */
export function normalizeRecordForCompare(record: unknown): string {
  if (!record || typeof record !== 'object') return stableStringify(record);
  const src = record as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    if (COMPARE_IGNORE_KEYS.has(key)) continue;
    const v = src[key];
    if (v === undefined) continue;
    cleaned[key] = v;
  }
  return stableStringify(cleaned);
}

export function fingerprintPersonalSnapshot(
  data: Record<BackupTableKey, unknown[]>,
): string {
  const parts: string[] = [];
  for (const key of BACKUP_TABLE_KEYS) {
    const rows = [...(data[key] || [])] as { id?: string }[];
    rows.sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
    parts.push(key);
    for (const row of rows) {
      parts.push(String(row.id ?? ''), normalizeRecordForCompare(row));
    }
  }
  return `fp1:${parts.join('|')}`;
}

export function diffPersonalSnapshots(
  local: Record<BackupTableKey, unknown[]>,
  cloud: Record<BackupTableKey, unknown[]>,
): TableDiffSummary[] {
  return BACKUP_TABLE_KEYS.map(table => {
    const localRows = (local[table] || []) as { id: string }[];
    const cloudRows = (cloud[table] || []) as { id: string }[];
    const localMap = new Map(localRows.map(r => [r.id, r]));
    const cloudMap = new Map(cloudRows.map(r => [r.id, r]));

    const localOnlyIds: string[] = [];
    const cloudOnlyIds: string[] = [];
    const differentIds: string[] = [];
    let equalCount = 0;

    for (const id of localMap.keys()) {
      if (!cloudMap.has(id)) localOnlyIds.push(id);
    }
    for (const id of cloudMap.keys()) {
      if (!localMap.has(id)) cloudOnlyIds.push(id);
    }
    for (const [id, localRow] of localMap) {
      const cloudRow = cloudMap.get(id);
      if (!cloudRow) continue;
      if (normalizeRecordForCompare(localRow) === normalizeRecordForCompare(cloudRow)) {
        equalCount += 1;
      } else {
        differentIds.push(id);
      }
    }

    localOnlyIds.sort();
    cloudOnlyIds.sort();
    differentIds.sort();

    return {
      table,
      localOnlyIds,
      cloudOnlyIds,
      differentIds,
      equalCount,
      localCount: localRows.length,
      cloudCount: cloudRows.length,
    };
  });
}

export function validatePersonalSnapshotIntegrity(
  data: Record<BackupTableKey, unknown[]>,
): { ok: boolean; errors: string[]; warnings: AccountTxnConsistencyWarning[] } {
  const errors: string[] = [];
  const warnings: AccountTxnConsistencyWarning[] = [];
  const accounts = (data.accounts || []) as {
    id: string;
    name?: string;
    balance?: number;
  }[];
  const transactions = (data.transactions || []) as {
    id: string;
    accountId?: string;
    toAccountId?: string;
    type?: string;
  }[];
  const accountIds = new Set(accounts.map(a => a.id));
  const accountName = (id: string) => accounts.find(a => a.id === id)?.name;

  for (const txn of transactions) {
    if (!txn.accountId || !accountIds.has(txn.accountId)) {
      const detail = `Transaction ${txn.id} references missing account ${txn.accountId ?? '(none)'}.`;
      errors.push(detail);
      warnings.push({
        accountId: txn.accountId || '(none)',
        accountName: accountName(txn.accountId || ''),
        kind: 'missing_account_ref',
        detail,
      });
    }
    if (txn.type === 'transfer' || txn.toAccountId) {
      if (!txn.toAccountId || !accountIds.has(txn.toAccountId)) {
        const detail = `Transaction ${txn.id} transfer target missing (${txn.toAccountId ?? 'none'}).`;
        errors.push(detail);
        warnings.push({
          accountId: txn.toAccountId || '(none)',
          kind: 'missing_transfer_ref',
          detail,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Compare accounts+transactions jointly between local and cloud (no balance replay). */
export function buildAccountTxnConsistencyWarnings(
  local: Record<BackupTableKey, unknown[]>,
  cloud: Record<BackupTableKey, unknown[]>,
): AccountTxnConsistencyWarning[] {
  const warnings: AccountTxnConsistencyWarning[] = [];
  const localAccounts = (local.accounts || []) as { id: string; name?: string; balance?: number }[];
  const cloudAccounts = (cloud.accounts || []) as { id: string; name?: string; balance?: number }[];
  const localTxns = (local.transactions || []) as {
    id: string;
    accountId?: string;
    toAccountId?: string;
  }[];
  const cloudTxns = (cloud.transactions || []) as {
    id: string;
    accountId?: string;
    toAccountId?: string;
  }[];

  const localAccMap = new Map(localAccounts.map(a => [a.id, a]));
  const cloudAccMap = new Map(cloudAccounts.map(a => [a.id, a]));
  const allIds = new Set([...localAccMap.keys(), ...cloudAccMap.keys()]);

  const linkedTxnIds = (
    txns: { id: string; accountId?: string; toAccountId?: string }[],
    accountId: string,
  ) =>
    txns
      .filter(t => t.accountId === accountId || t.toAccountId === accountId)
      .map(t => t.id)
      .sort()
      .join(',');

  for (const id of allIds) {
    const la = localAccMap.get(id);
    const ca = cloudAccMap.get(id);
    if (la && ca) {
      if (Number(la.balance) !== Number(ca.balance)) {
        warnings.push({
          accountId: id,
          accountName: ca.name || la.name,
          kind: 'balance_mismatch',
          detail: `Account "${ca.name || la.name || id}" balance differs (local ${la.balance} vs cloud ${ca.balance}). Treated as whole-dataset choice — balances are not recomputed.`,
        });
      }
      const localSet = linkedTxnIds(localTxns, id);
      const cloudSet = linkedTxnIds(cloudTxns, id);
      if (localSet !== cloudSet) {
        warnings.push({
          accountId: id,
          accountName: ca.name || la.name,
          kind: 'linked_txn_set_mismatch',
          detail: `Account "${ca.name || la.name || id}" has a different linked transaction set locally vs cloud.`,
        });
      }
    }
  }

  return warnings;
}

/** Pure completeness check for paginated cloud fetches. */
export function isPaginatedFetchComplete(fetchedCount: number, expectedCount: number): boolean {
  return fetchedCount === expectedCount && expectedCount >= 0;
}
