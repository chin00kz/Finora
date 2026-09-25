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
- **Permanent Quick Log chips were deliberately REMOVED.** Do NOT restore the old Quick Log chips merely because stale preference/state code is discovered.
- Transaction capture remains available through the central `+` action.
- Safe-to-Spend is represented subtly.
- Avoid card-in-card layouts, dashboard widget grids, excessive pills, gradients/glows.
- Minimalism means showing less, not making everything tiny. Large important financial numbers must remain visually important.

## 2. The Dual Authority Architecture
Finora uses two entirely different authority models depending on the data type.

### A. Local-First (Personal Data)
Personal finance data (Accounts, Transactions, Budgets, Categories, personal Debts) uses **Dexie as the local authority**. 
- The app operates primarily offline.
- Background sync uploads opportunistic changes to Supabase via dirty tracking.

### B. Cloud-Consensus (Shared Data)
Shared data (Profiles, Connections, Shared IOUs) uses **Supabase as the authoritative source**.
- Dexie is merely a read cache where appropriate.
- Mutations are controlled via strictly defined backend RPCs, not generic client `UPDATE`s.

## 3. Identity & Connections

### Profiles
Profiles are cloud identity state. V1 usernames are not editable, globally unique, canonical lowercase (3�24 chars, `[a-z0-9_]`). Profile creation goes strictly through the authoritative `create_profile` RPC.

**IMPORTANT PRODUCTION INVARIANT:**
`IDENTITY_ROLLOUT_CUTOFF = 2026-09-23T10:00:00Z`
This cutoff distinguishes legacy users from accounts created after mandatory profile onboarding was introduced. Do not casually change this value. It is a historical production boundary.

**Profile Loading:**
A network error must NOT be interpreted as "the user has no profile". Existing cached profile information may be used when remote loading fails.

### Person vs. Connection
- **Local Person:** A personal, local-first record. May represent someone who does not use Finora.
- **Connection:** A cloud-authoritative relationship between authenticated Finora users.

A local Person may optionally link to a Connection (`connection_id`), but this is just linkage metadata. **Connecting someone MUST NOT rewrite historical personal debts or automatically share old IOUs.** It does not change ownership/authority of historical personal records. Connection discovery uses exact username lookup, never public email enumeration.

### Connection Security & Lifecycle
- Connection mutations use action-oriented RPCs rather than broad client UPDATE rights.
- Blocking is directional.
- Blocking prevents new interactions but must preserve legitimate historical shared financial visibility/history.

## 4. Personal IOUs vs Shared IOUs
**THIS IS A HARD ARCHITECTURAL BOUNDARY. Do not merge these models merely because both represent debts.**

### Personal IOUs (`debts`)
- Local-first, user-owned.
- Compatible with people who do not use Finora.
- Part of normal generic sync.
- "I owe them" functionality exists here.

### Shared IOUs (`shared_ious`)
- A completely different system representing consensus state between two Finora users.
- **Lifecycle:** Creator creates -> Recipient receives pending request -> Recipient accepts/declines -> Accepted IOU exists for both.
- V1 Direction: "They owe me" only (Creator = creditor, Recipient = debtor).
- Cloud-authoritative, RPC-based, strictly participant-only.
- Existing local IOUs NEVER automatically become Shared IOUs when a Person connects. Do NOT automatically create a confirmed debt in another user's ledger.

**Offline Behavior (V1):**
- Cached Shared IOUs may be viewed offline.
- Shared mutations require connectivity.
- Do NOT create an offline Shared IOU mutation queue by routing shared state through generic dirty-record sync.

## 5. Shared IOU Settlement Design
- **Handshake:** Debtor says "I paid this" (pending settlement). Creditor confirms or rejects.
- Only confirmed settlements reduce the remaining amount.
- **Remaining amount is derived:** (original IOU amount) minus (confirmed settlements). It is **not** a freely editable field.
- The backend confirmation RPC must lock the parent Shared IOU row to protect against concurrent over-settlement.
- Do NOT automatically generate a local bank transaction from a shared settlement in V1.

## Notification Architecture

- **Cloud-Authoritative**: `public.notifications` is the single source of truth.
- **Local Read Cache**: Fetched into Dexie `cacheNotifications` for offline viewing.
- **Isolation**: No generic dirty sync. Not part of `ALL_TABLES`. Mutations require connectivity.
- **Server-Side Event Creation**: Domain RPCs (event producers) MUST create notifications transactionally inside the same Postgres transaction as the primary mutation, ensuring atomicity and preventing ghost states.
- **Deduplication**: Guaranteed via `event_key` unique constraint.
- **Security**: Strictly scoped to recipient visibility via RLS.
- **Internal Deep-Links**: Uses `entity_type` and `entity_id` mapped to safe internal routes, preventing arbitrary URL execution.
