# Finora Stabilization Checklist

Status key: **WORKING** · **FIXED** · **BROKEN** · **PARTIAL** · **NOT TESTED**

Choice A remains disabled / undeployed. Release blockers: fingerprint parity, live SQL security scenarios, generic upsert soak.

## Stage 1 — Accounts & Transactions

See also historical notes in `STAGE1_CHECKLIST.md` (superseded by this master list).

| Item | Status |
|------|--------|
| Account create / opening / edit / delete+reassign | WORKING / FIXED (zero-txn reassignment) |
| Expense / income / transfer / adjustments | WORKING / FIXED (negative adjustment Save, atomic undo) |
| Shared expense cash vs personalAmount | WORKING |
| Desktop/mobile account & txn UI | PARTIAL (manual) |

## Stage 2 — Budget Planner

| Item | Status | Notes |
|------|--------|-------|
| Create budget (name, amount, custom dates) | FIXED | Atomic create; ends prior actives with clipped `endDate` |
| One active budget rule | FIXED | Resolver + heal (runtime + Dexie v15); create ends others |
| Edit budget amount/dates | PARTIAL | Rename only by design; amount/date edit not offered |
| End budget early | FIXED | Clips `endDate` to freeze window |
| Local midnight / today-start = now | WORKING | Centralized in `parseBudgetDateBounds` + tests |
| Overlapping periods after replace/end | FIXED | Clip to `now-1` on end |
| Category allocation caps | PARTIAL | Distribution charts only; no per-category limits (by design) |
| Progress / remaining / overspend | WORKING | `getBudgetStatus`; detail now passes period for pace |
| `excludeFromBudget` | WORKING | Excluded from budget sums |
| Shared `personalAmount` incl. 0 | WORKING | `spendingAmount` tests |
| Recalc after txn create/edit/delete/undo | WORKING | LiveQuery + `sumBudgetSpending` |
| Dashboard budget card | WORKING | Uses `resolveActiveBudget` + pace period |
| Analytics current w/o active | FIXED | Falls back to This Month; not all-time budget mode |
| Analytics past-budget daily chart | FIXED | Uses budget start/end dates |
| Historical multi-active from v3 migration | FIXED | Dexie v15 heal + runtime heal |
| Sync missing status → active | FIXED | Infer ended if window passed |
| Empty / validation / errors | FIXED | Modal form errors; amount > 0 |
| Desktop/mobile budget UI | NOT TESTED | No browser run this session |
| Budget delete per period | PARTIAL | No per-budget delete UI (Settings clear only) |

## Mobile shell / home-screen (manifest-only)

| Item | Status | Notes |
|------|--------|-------|
| Bottom white bar / home-indicator gap | FIXED (emulation) | Cause: shell/`main` grew with content → document scrolled; mobile now locks document scroll, `main` is sole scroll owner |
| Safe-area bottom on nav / FAB / undo toast | FIXED | `env(..., 0px)` fallbacks; opaque nav bg through inset |
| Pinch-zoom viewport lock removed | FIXED | Dropped `user-scalable=no` / `maximum-scale=1.0` |
| Web app manifest (standalone, icons) | WORKING | `public/manifest.webmanifest`; no service worker |
| iOS Home Screen meta | WORKING | status-bar + title; real-device still NOT TESTED |
| Android Chrome tab / Home Screen | NOT TESTED | Manual checklist required |
| iPhone Safari / Home Screen | NOT TESTED | Manual checklist required |

## Shared IOU P0 — Mark as Paid remaining

| Item | Status | Notes |
|------|--------|-------|
| Mark Paid remaining after partials | FIXED (unit-tested) | `UnifiedIou.amount` is already remaining; caller was subtracting `confirmedTotal` again → e.g. 100−40→60 shown as 20. Fix: `resolveMarkPaidRemainingAmount` from original + settlements (or unified remaining without re-subtract). Files: `sharedIouSettlementEngine.ts`, `SharedIouDetailModal.tsx`, `MarkPaidModal.tsx` |
| Pending vs Mark Paid remaining | WORKING | Pending does not reduce Mark Paid remaining (confirmed-only); matches `mark_iou_paid` server math |
| Zero remaining submit blocked | FIXED (client) | `canSubmitMarkPaid`; server still rejects `iou_already_settled` |
| Live two-user Mark Paid soak | NOT TESTED | Staging device check outstanding |

### Integration touchpoints (later stages — not done here)
- M1 Shared Expense → Shared IOU: `TransactionModal.tsx` (personal debt only today)
- M2 overpay / reverse IOU: `confirm_iou_payment` SQL + `CreditorSettlementReview.tsx`
- M3 shared-expense edit/delete debt sync: `TransactionEditSheet.tsx`, `debtSettlementEngine.ts`

## Out of scope (later stages)

Recurring auto-post soak, CSV UX, Shared IOU cloud (beyond Mark Paid P0), Choice A enablement, notifications, service-worker / offline app-shell caching.
