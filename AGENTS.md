# Finora Agent Protocol

Welcome to Finora. This file contains the permanent, prescriptive rules every AI coding agent must follow. **Read this before touching any code.** 

For deeper design reasoning, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 1. Pre-Flight Checklist
Before substantial work, every agent MUST:
1. Read this file.
2. Read `docs/STATUS.md`.
3. Run `git branch --show-current`.
4. Run `git status`.
5. Inspect the relevant implementation before modifying it.

**Rule 1: Never assume you are on `main`.** Feature work may exist on another branch. Never touch an unrelated active feature branch.
**Rule 2: Do not commit, push, or merge unless explicitly instructed.**
**Rule 3: BUILD SUCCESS != BEHAVIORAL SUCCESS.** A successful `npm run build` only proves TypeScript compiles. It does not prove runtime correctness or React state integrity.
**Rule 4: Avoid speculative changes.** Prefer the smallest robust change. Do not rewrite Tailwind classes or apply speculative CSS fixes for bugs without reproduction/evidence. Avoid unrelated refactors.
**Rule 5: Clean up.** Do not leave random helper scripts (`.cjs`, `.ts`, etc.) in the repository.

## 2. Pre-Commit Checklist
Before a requested commit, you MUST:
- run `git diff --check`
- run `npm run build`
- inspect `git diff`
- inspect `git status`
- confirm only intended files changed
- remove temporary/debug scripts

Explicitly note: These checks do not replace behavioral/manual testing.

## 3. The Dual Authority Model (Data Integrity)
Finora intentionally operates TWO authority models. **Do not force architectural consistency where the product demands a split.**

### A. Local-First Personal Finance
- **Applies to:** Accounts, transactions, budgets, categories, local `debts` (Personal IOUs), local `people`.
- **General Architecture:** Personal finance data is local-first and participates in the generic personal-data sync system (via dirty tracking). The app must remain useful offline.
- **Crucial Lesson:** Unexpected upload failures MUST preserve dirty records. **Do not clear dirty state because an error message says "does not exist".** (A historical schema-drift incident caused data loss when a missing-column PostgREST error was misclassified as a missing-table error, clearing dirty IDs. Only a definite missing-table compatibility condition may trigger clearing.)

### B. Cloud-Authoritative / Consensus Data
- **Applies to:** Finora profiles, Connections, `shared_ious`, and future settlements.
- **General Architecture:** These involve identity, permissions, and shared state between multiple users. They use Supabase/RPCs as the ultimate authority, with Dexie serving only as a local read cache. Cloud-authoritative/consensus cache tables do NOT participate in generic dirty-record sync.

## 4. Transactions & State
- **Occurrence Timestamp:** Transaction Date/Time represents *when it occurred*, not just when it was logged. Changing Date preserves Time, changing Time preserves Date. Quick capture remains "now" unless explicitly changed. Historical transactions must participate in calculations according to their occurrence time.
- **Strict Data Validation:** A transaction must never silently retain an invalid account or category. For non-transfer transactions, `category.type` MUST match `transaction.type`. If state becomes invalid, reconcile to a valid value or clear/block submission. Submit-time validation is the final safety boundary.

## 5. UI & Routing Guardrails
- **React Router Only:** Use React Router APIs for state (`useNavigate({ replace: true, state: ... })`). Do NOT manipulate navigation state with raw `window.history.replaceState` or `window.history.back()`. Raw History API manipulation causes ghost components where editors reopen unexpectedly.
- **Mobile Cautions:** Be cautious with `h-screen`, fixed heights, body `overflow: hidden`, safe-area insets, and keyboard handling. Body scroll locking must only exist where intentionally required and must restore previous state. The central transaction `+` action and More drawer must account for the fixed bottom nav and safe-area inset without double-counting it. Forms on short screens must remain scrollable.

## 6. Coding Patterns & Security
- **Security:** Prefer narrow action RPCs over broad mutation permissions. SECURITY DEFINER functions must validate the actor/role/state and expose EXECUTE only to intended roles. Do not weaken RLS because an RPC already performs checks.
- **IDs:** Use `createId('prefix')`.
- **Currency:** Use `formatMoney(amount)`.
- **Database:** Keep `supabase-schema.sql` (canonical) and migrations (`supabase-schema-migration-*.sql`) in sync. Verify production schemas directly.
