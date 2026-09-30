# Finora Project Status

This document tracks the current state of Finora, deployed features, known limitations, and parked future ideas.

## Current Repository State
- **`main` branch:** Stable production. Contains complete local-first personal finance capabilities, plus Cloud-authoritative Shared IOUs, Settlements, and Semantic Notifications.
- **`staging` branch:** The active release-candidate branch.

## 🟢 Live / Implemented

**Personal Finance (Local-First)**
- Accounts, Transactions, Categories, and Tags
- Budgets and Safe-to-Spend forecasting
- Savings Goals
- Recurring Payments
- Personal IOUs (offline tracking with non-users)
- Offline support and background dirty sync to Supabase
- Statement reading/parsing (e.g., Combank PDFs)
- JSON Backup/Import/Export

**Shared Finances (Cloud-Authoritative)**
- **Identity & Connections:** User profiles and secure friend connections.
- **Shared IOUs:** Authoritative cross-user debts.
- **Lifecycle Controls:** Accept, decline, and cancel flows.
- **Trusted Friend Auto-Accept (Phase 8):** Directional opt-in to automatically accept IOUs where you owe a trusted friend.
- **Settlements:** Propose partial or full payments. Creditors confirm or reject.
- **Account-Linked Recording:** Payers can record payments directly from local accounts; creditors can deposit directly into local accounts.
- **Overpayments:** Handled gracefully, optionally resulting in opposite obligations.
- **Global Semantic Notifications:** Real-time push notification feed.
- **NotificationBell & Badges:** Global bell with a priority-colored semantic badge indicating the highest-urgency unread event (Red > Amber > Cyan > Emerald).

## 🟡 Currently Being Refined / Known Technical Debt
- **Mobile White-Bar Issue:** An intermittent visual bug on some mobile browsers. Difficult to reproduce consistently.
- **Transaction Edit Date/Time:** Layout was improved for narrow screens, but historically had intermittent disappearance reports.
- **Connection Removal:** Removing a connection currently breaks historical display names because there is no robust `syncMissingProfiles(uuid[])` pipeline to safely hydrate historical offline IOUs.
- **Notification Deletion:** Swipe-to-delete is deferred because the backend currently only supports `mark_read`; a formal archive/delete lifecycle is pending.

## 🔴 Parked / Future Possibilities

**Phase 5 — Shared Expenses / Bulk Splits**
*Status: Parked / Requires deep product & architecture design.*
- The original concept of complex multi-way expense splitting ("who paid what" across N people) has been paused.
- Any future implementation must adhere to the principle: "Using Finora to split a real shared expense should require less thought and effort than calculating and tracking it manually."
- Any old architecture references to bulk shared expenses should be treated as abandoned proposals unless re-evaluated.

**Advanced Sharing / Future Enhancements**
- Export Report period reset
- Profile/network failure resilience testing
- Safe-to-Spend forecast customization
