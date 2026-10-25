# Stage 1 — Accounts & Transactions Checklist

> Master checklist (Stage 1 + Stage 2) lives in [STABILIZATION_CHECKLIST.md](./STABILIZATION_CHECKLIST.md).

Status key: **WORKING** · **FIXED** · **BROKEN** · **PARTIAL** · **NOT TESTED**

Choice A remains disabled / undeployed. Tracked separately as release blockers (fingerprint parity, live SQL security scenarios, generic upsert soak).

Last updated: local staging after Stage 1 stabilization fixes.

## Accounts

| Item | Status | Notes |
|------|--------|-------|
| Create account | WORKING | Via `createAccountWithOpeningBalance` |
| Opening balance (single apply) | WORKING | Covered by pure tests + lifecycle helper |
| Edit name/type/includeInTotal | WORKING | |
| Manual balance edit → `balance_adjustment` | WORKING | Signed delta |
| Delete sole empty account | WORKING | |
| Delete + reassign transactions | WORKING | Merge policy; self-transfer blocked |
| Delete zero-txn with recurring/goals/outbox | FIXED | Was simple-delete; now reassigns via plan |
| Sole account with orphanable refs | FIXED | Blocked until another account exists |
| Balance consolidation on delete | WORKING | `replacement += deleted` |

## Transactions — create / edit / delete

| Item | Status | Notes |
|------|--------|-------|
| Create expense/income | WORKING | Atomic Dexie + shared helpers |
| Create transfer | WORKING | Self-transfer rejected |
| Shared expense (full amount debit + debt) | WORKING | Personal share for IOU tracking only |
| Edit expense/income/transfer | WORKING | Reverse then apply |
| Edit negative `balance_adjustment` | FIXED | Save button no longer requires amount > 0 |
| Delete single (edit sheet) | WORKING | Reverse then delete |
| Bulk delete + balance reverse | WORKING | Pure tests for transfer nets |
| Invalid / missing account on create | WORKING | `prepareApplyBalance` |
| Missing category on create (modal) | WORKING | |
| Missing category on quick-add / repeat | FIXED | Category existence checked in Dexie txn |

## Undo / quick-add / history

| Item | Status | Notes |
|------|--------|-------|
| Quick-add 1-tap log | WORKING | |
| Global undo toast atomicity | FIXED | Reverse-then-delete via shared helpers |
| Undo transfer via toast | NOT TESTED | Intentionally unsupported; use edit delete |
| Activity repeat (expense/income) | WORKING | Transfers open edit sheet |
| Repeat preserves shared-expense fields | PARTIAL | Omits `isShared` / `personalAmount` |
| Transaction history display | WORKING | Opening/adjustment labels present |
| Desktop / mobile usability | PARTIAL | Code review only; manual check below |

## Persistence / sync (no live Supabase)

| Item | Status | Notes |
|------|--------|-------|
| Local Dexie persistence | WORKING | |
| Dirty tracking after writes | WORKING | |
| Sync LWW on `account.balance` | PARTIAL | Architectural risk if devices diverge |
| Restore isolation freeze | WORKING | Preserved; edits blocked while reconciling |

## Intentionally out of Stage 1

Budgets, recurring auto-post soak, CSV import UX, Shared IOU cloud settlements, Choice A, notifications.
