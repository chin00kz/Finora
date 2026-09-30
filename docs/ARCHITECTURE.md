# Finora Architecture & Product Philosophy

This document explains the *why* behind Finora's systems. For operational rules and Git guidelines, see [AGENTS.md](../AGENTS.md).

## 1. Product Philosophy: HOME = GLANCE + CAPTURE
Finora is minimal, calm, local-first, fast enough for daily use, and understandable at a glance. It is **not** a feature-heavy financial dashboard.

The Home screen is effectively locked unless a real usability issue requires a change. It should quickly answer:
1. How much money do I have?
2. How am I doing this month?
3. What happened recently?

**Intentional Home decisions:**
- Available balance as context.
- "This Month" as the primary budget hero.
- Exactly 3 recent transactions.
- Upcoming appears only when relevant.
- **Permanent Quick Log chips were deliberately REMOVED.**
- Transaction capture remains available through the central `+` action.
- Safe-to-Spend is represented subtly.
- Avoid card-in-card layouts, dashboard widget grids, excessive pills, gradients/glows.

## 2. The Dual Authority Architecture
Finora uses two entirely different authority models depending on the data type.

### A. Local-First (Personal Data)
Personal finance data (Accounts, Transactions, Budgets, Categories, personal Debts) uses **Dexie as the local authority**.
- The frontend operates primarily offline.
- Background sync uploads opportunistic changes to Supabase via dirty tracking.

### B. Cloud-Consensus (Shared Data)
Shared data (Profiles, Connections, Shared IOUs, Settlements) uses **Supabase as the authoritative source**.
- Dexie is merely a read cache where appropriate.
- Mutations are controlled via strictly defined backend RPCs, not generic client `UPDATE`s.

## 3. Identity & Connections

### Profiles
Profiles are cloud identity state. Creation goes strictly through the authoritative `create_profile` RPC.

### Person vs. Connection
- **Local Person:** A personal, local-first record. May represent someone who does not use Finora.
- **Connection:** A cloud-authoritative relationship between authenticated Finora users. Connecting someone MUST NOT rewrite historical personal debts or automatically share old IOUs.

## 4. Personal IOUs vs Shared IOUs
**THIS IS A HARD ARCHITECTURAL BOUNDARY. Do not merge these models merely because both represent debts.**

### Personal IOUs (`debts`)
- Local-first, user-owned.
- Part of normal generic sync.
- "I owe them" functionality exists here.

### Shared IOUs (`shared_ious`)
- A consensus state between two Finora users.
- **Lifecycle:** Creator creates -> Recipient receives pending request -> Recipient accepts/declines/cancels -> Accepted IOU exists for both.
- **Trusted Friend Auto-Accept:** Users can configure directional auto-acceptance per connection, allowing incoming IOUs where the user owes money to be accepted automatically.
- Cloud-authoritative, RPC-based, strictly participant-only.
- **Offline Behavior:** Cached Shared IOUs may be viewed offline. Mutations require connectivity.

## 5. Shared IOU Settlement Design
- **Handshake:** Debtor says "I paid this" (pending settlement proposal). Creditor confirms or rejects.
- **Account-Linked Recording:** Creditors can directly record an incoming payment into a local account; payers can record outgoing payments.
- **Overpayments & Reverse Obligations:** Supported gracefully through the backend RPCs.
- The backend confirmation RPC locks the parent Shared IOU row to protect against concurrent over-settlement.

## 6. Notification Architecture
- **Cloud-Authoritative**: `public.notifications` is the single source of truth.
- **Local Read Cache**: Fetched into Dexie `cacheNotifications` for offline viewing.
- **Semantic Classification**: The `type` field provides semantic meaning (e.g., `'shared_iou_request'`). The `event_key` field is solely an idempotency identifier containing IDs/timestamps to prevent deduplication.
- **Server-Side Event Creation**: Domain RPCs (event producers) MUST create notifications transactionally inside the same Postgres transaction as the primary mutation, ensuring atomicity.
- **UI & Badge:** Notifications have a strict color priority (Red = Destructive, Amber = Warning, Cyan = Social, Emerald = Positive). Unread badges and in-feed highlights rely strictly on the `type` mapping.
