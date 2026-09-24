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
- **Phase 3 — Settlements:** **CURRENT**
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
