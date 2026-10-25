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

## Shared IOU — immediate usability + acknowledgement (Phase 9)

| Item | Status | Notes |
|------|--------|-------|
| Create usable without debtor accept | IMPLEMENTED (client + SQL file) | `status=accepted` on create; `recipient_acknowledged_at` NULL until ack / set on auto-accept. Migration: `supabase-schema-migration-phase9-immediate-active-ack.sql` **not applied by agent** |
| UI awaiting badge | IMPLEMENTED (unit-tested gates) | Amber `Awaiting recipient acknowledgement` — does not say recipient agreed |
| Acknowledge / Reject | IMPLEMENTED (client) | `accept_shared_iou` sets ack; `reject_shared_iou` allows pending/accepted with **zero** confirmed payments. Live RPC **NOT VERIFIED** until migration applied |
| Reject with confirmed payments | BLOCKED (Phase 8 guard) | SQL + UI: `cannot_reject_with_payments` / `canRejectSharedIou({ confirmedPaymentTotal })` |
| Existing pending backfill | FIXED | Pending rows are **not** promoted to accepted; handshake (accept/decline) remains |
| A1 Safe backfill rerun | FIXED (SQL + unit test) | Marker `phase9_legacy_ack_backfill_v1` written **last** in one `BEGIN`/`COMMIT`; backfill skipped on rerun |
| A2 Reverse IOU ack | FIXED (SQL + unit test) | `confirm_iou_payment` inserts reverse IOU with `recipient_acknowledged_at = now` (confirm = consent) |
| A3 Ack notification | FIXED (SQL + unit test) | Type `shared_iou_accepted`; event_key `shared_iou_acknowledged:{iouId}` (no timestamp); ON CONFLICT DO NOTHING |
| A4 Preflight | FIXED (SQL) | Fails if Phase 8 columns/constraint or integrity `p_settlement_id` RPCs missing |
| Two-user soak | NOT TESTED | Deploy Phase 9 UI first, then apply SQL once on the target project |

### Previous blocking behavior
Creators waited on `pending` because settlement RPCs required `status=accepted`. Auto-accept was the only unblock path.

### Audit fixes (A1–A4) evidence
- SQL: `supabase-schema-migration-phase9-immediate-active-ack.sql`
- Pure mirrors: `src/utils/phase9MigrationSafety.ts` + `__tests__/phase9MigrationSafety.test.ts`

### Security
- Still SELECT-only tables + SECURITY DEFINER RPCs; debtor-only ack/reject; non-participants denied in RPC.
- `finora_schema_markers` has no grants to `authenticated` (migration-only).
- Do not put Shared IOUs on dirty sync.

### Apply checklist (human; agent must not apply)
1. Confirm target DB has Phase 8 + settlement-integrity (preflight will EXCEPTION if missing).
2. Deploy Phase 9-capable frontend **before** applying SQL to that project’s clients.
3. Apply **once** as a single script (honors `BEGIN`/`COMMIT`): `supabase-schema-migration-phase9-immediate-active-ack.sql`.
4. Verify marker: `SELECT marker FROM finora_schema_markers WHERE marker = 'phase9_legacy_ack_backfill_v1';`
5. Verify existing `pending` count unchanged by apply; new create → `accepted` + NULL ack; Mark Paid / propose allowed.
6. Reject unacked with zero confirmed OK; reject with confirmed payments → `cannot_reject_with_payments`.
7. Debtor Acknowledge → one `shared_iou_accepted` (`event_key = shared_iou_acknowledged:{id}`).
8. Optional: overpay confirm → reverse IOU acked at create; optional full-file re-apply → skip backfill, unacked stable.

### Integration touchpoints (later stages — not done here)
- M1 Shared Expense → Shared IOU: `TransactionModal.tsx` (personal debt only today)
- M2 overpay / reverse IOU: `confirm_iou_payment` SQL + `CreditorSettlementReview.tsx`
- M3 shared-expense edit/delete debt sync: `TransactionEditSheet.tsx`, `debtSettlementEngine.ts`

## Out of scope (later stages)

Recurring auto-post soak, CSV UX, Shared IOU cloud (beyond Mark Paid P0), Choice A enablement, notifications, service-worker / offline app-shell caching.
