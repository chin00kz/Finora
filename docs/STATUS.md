# Finora Project Status

This document tracks temporary/current information, active phases, feature branches, and unresolved bugs.

## Current Repository State
- **`main` branch:** Contains the most recent UI reliability fixes.
- **`feature/shared-ious` branch:** Contains the active Phase 2A backend SQL implementation and testing. Shared IOUs are being developed separately and must not be accidentally merged or modified from `main`.

## Phase Roadmap
- **Phase 1 � Identity & Connections:** COMPLETE
- **Phase 2 � Shared IOUs:** **CURRENT**
  - **2A Cloud schema + security:**
    - Implementation complete on feature branch.
    - Production migration has been applied.
    - Initial security/RLS/direct-insert/create/select tests passed.
    - **Next backend verification:** Recipient acceptance of the intentionally preserved pending IOU.
    - **After that:** Decline, cancel, invalid actor/state tests.
  - 2B Local read cache
  - 2C Create Shared IOU
  - 2D Recipient handshake
  - 2E UI
- **Phase 3 � Settlements** *(Do NOT start settlements yet)*
- **Phase 4 � Notifications/shared UX**
- **Phase 5 � Polish/advanced sharing**

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
