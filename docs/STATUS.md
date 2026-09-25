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
- **Phase 4 — Notifications & Shared UX: CURRENT**
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
  - [x] 4D Settlement notifications (IMPLEMENTED / AWAITING PRODUCTION MIGRATION + REAL E2E)
  - [ ] 4E Shared UX polish / final E2E
    - Polish Connections UI (align with Shared IOU visual language: clearer hierarchy, subtle secondary font colors, cleaner Accept/Decline presentation, no major redesign).
    - Future "Remove Friend" capability (requires confirmation, secure server-side RPC, must NOT delete historical shared IOUs/settlements, Block remains separate).

- **Phase 5 — Shared Expenses / Split Transactions: PLANNED — HIGH PRIORITY**
  - 5A Split transaction foundation (Friends/local People)
  - 5B Equal Split (auto-calculate, deterministic rounding)
  - 5C Custom Split + Shared Remainder (custom base amount + distribute remainder)
  - 5D Automatic IOU Routing (Finora Friend -> Shared IOU, Local -> local IOU)
  - 5E Lifecycle & Data Integrity (editing/deleting, atomic recovery)
  - 5F UX Polish + Full E2E
  *(Note: Receipt scanning, percentage splits, multiple payers, and complex group balances are OUT OF SCOPE for V1)*

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
