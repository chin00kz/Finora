# Finora Project Status

This document tracks temporary/current information, active phases, feature branches, and unresolved bugs.

## Current Repository State
- **`main` branch:** Contains the most recent UI reliability fixes.
- **`feature/shared-ious` branch:** Phase 2 implementation complete and successfully merged into main.

## Phase Roadmap
- **Phase 1 � Identity & Connections:** COMPLETE
- **Phase 2 — Shared IOUs:** COMPLETE
  - 2A Cloud schema + security: complete
  - 2B Local read cache: complete
  - 2C Create Shared IOU: complete
  - 2D Recipient handshake: complete
  - 2E UI: complete
- **Phase 3 — Settlements:** COMPLETE
  - 3A Cloud Settlement Logic: complete (*Note: The unrelated-user settlement SELECT RLS test was skipped during automated testing because disposable signup hit Supabase free-tier auth limits. Other RLS rules were indirectly verified via permissions.*)
  - 3B Settlement read cache + balance derivation: complete
  - 3C Debtor payment proposal: complete
  - 3D Creditor Confirm/Reject: complete
  - 3E Detail/history + settlement UX polish: complete
  - *Real two-account E2E settlement test passed:* proposal, multiple pending claims, partial confirmation, rejection, restored proposal capacity, final confirmation, settled transition.
- **Phase 4 — Notifications & Shared UX: COMPLETE**
  - [x] 4A In-app notification foundation (COMPLETE)
  - Real Production Verification:
    - Notification fetch/render: PASS
    - Unread state: PASS
    - Mark-one-read: PASS
    - Realtime global discovery: PASS x2
    - App-start hydration: PASS
    - Two-account realtime isolation: PASS x2
    - Production realtime migration applied
  - Lower-level automated security/RLS assertions (A-K) skipped (test credentials unavailable in environment)
  - Cloud-authoritative cache isolation confirmed

  - [x] 4B Connection notifications (COMPLETE / primary production E2E verified)
    - PASS: Friend request notification (realtime global discovery, correct content)
    - PASS: Notification deep-link to Connections (correct pending state)
    - PASS: Acceptance notification (realtime delivery back to requester)
    - DEFERRED: manual edge-case test for decline -> legitimate re-request -> new notification

  - [x] 4C Shared IOU notifications (COMPLETE / primary production E2E verified)
    - Production migration manually applied successfully.
    - PASS: Shared IOU request notification (realtime global discovery, exact request deep-link to /debts).
    - PASS: Acceptance notification (realtime delivery back to creator, exact deep-link to detail modal).
    - DEFERRED: manual E2E for decline and cancel notifications.
  - [x] 4D Settlement notifications (COMPLETE / primary production E2E verified)
    - Production migration manually applied successfully.
    - PASS: Partial payment proposal notification & exact deep-link.
    - PASS: Partial payment confirmation notification.
    - PASS: Final exact-remainder proposal & confirmation notifications.
    - PASS: Parent IOU settled transition & final notification wording.
    - PASS: 701b48b modal reconciliation fix production verified (no page refresh required).
    - DEFERRED: manual E2E for settlement rejection notifications.
  - [x] 4E Shared UX polish / final E2E (COMPLETE / production UX verified)
    - PASS: SharedIouDetailModal explicit X close button (visible, properly positioned, tap closes normally).
    - PASS: Friends & Connections incoming request UI (Accept is primary, Decline is secondary, mobile layout fits, display name readable).
    - DEFERRED: "Remove Friend" capability. Investigation revealed that deleting a connection row prevents that user's profile from syncing into the local cache on fresh installs. Until a dedicated `syncMissingProfiles(uuid[])` pipeline is added to safely hydrate historical IOUs, removing connections would break historical display names.

- **Phase 5 — Shared Expenses / Split Transactions: IMPLEMENTED (beta on backup/broken-phase5-2026-09-26)**
  *(Shipped: split UX, local debts, shared outbox RPCs, Shared / Relationship pages. 26 Sep 2026 sync-integrity pass: pull no longer deletes local-only rows; split debts are marked dirty; outbox flushes on save/login; split fields map + survive echo; Dexie `sharedPayments` + groups mappers aligned to schema.)*

  **Intent:**
  - extremely fast expense splitting
  - equal splits
  - unequal/custom personal amounts
  - automatically shared remainder such as delivery/service fees
  - Finora Friends + local People
  - repeated participant combinations
  - recent participant suggestions
  - optional saved groups
  - accumulated balances across days/weeks
  - per-person financial activity/history
  - repayments and partial repayments
  - clear explanation of why someone owes the current amount
  - user-selectable Start Page so users primarily interested in IOUs/shared money can open Finora directly into that area

  **Core Product Principle:** "Using Finora to split a real shared expense should require less thought and effort than calculating and tracking it manually."

  *(DO NOT design schemas, tables, RPCs, components, or implementation details yet)*

- **Phase 6 — Advanced Sharing / Future Enhancements: FUTURE**


## Known Unresolved/Intermittent Bugs
**Do not claim root cause solved on these without strict reproduction and evidence.**

1. **Mobile White-Bar Issue**
   - Remains OPEN / intermittent.
   - Recent testing did not reproduce it.
   - Avoid speculative CSS changes without reproduction/evidence.

2. **Transaction Edit Date/Time Disappearance**
   - Historical intermittent report.
   - Remains OPEN.
   - Current testing confirmed Date/Time is visible and persists normally, and layout was improved for narrow screens.

## Reliability Verification
Some reliability behaviors remain unverified or partially verified.

**Deferred Verification:**
- Export Report period reset
- Profile/network failure behavior
- Budget date defaults
- Safe-to-Spend forecast setting
- Statement Reader with real statement content

**Recently Verified:**
- Transaction category integrity
- Stale/deleted account reconciliation
- Activity/Recurring editor navigation
- Transaction Date/Time persistence
- Mobile modal scrolling
- Mobile safe-area geometry (central transaction + action / More drawer)
