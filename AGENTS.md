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
**Rule 4: Avoid speculative changes.** Prefer the smallest robust change. Do not rewrite Tailwind classes or apply speculative CSS fixes for bugs without reproduction/evidence. Avoid unrelated refactors. No broad regex/scripted source mutations for small edits.
**Rule 5: Clean up.** Do not leave random helper scripts (`.cjs`, `.ts`, etc.) in the repository.

## 2. Production Environment & Promotion
- Finora is **production software** handling real financial data.
- `main` is stable production.
- `staging` is the development/release-candidate branch. Real usage on staging is an important bug-discovery loop, but it does not replace deliberate verification for high-risk financial/security/data-integrity work.
- **Production Promotion:** Promotion from `staging` to `main` must use a clean, tree-equivalent promotion (e.g., `git read-tree -um HEAD origin/staging` followed by a commit) rather than a standard merge that imports staging's experimental/dirty history.

## 3. Pre-Commit Verification
Before a requested commit, you MUST:
- run `git diff --check`
- run `npm run build`
- inspect `git diff`
- inspect `git status`
- confirm only intended files changed
- remove temporary/debug scripts

Ordinary UI changes: targeted inspection -> batch edit -> build -> runtime check -> diff.
DB/RPC/RLS/sync/financial-integrity changes require heavier verification. Batch related work and verify proportionally to risk. No subagents by default.

## 4. The Dual Authority Model (Data Integrity)
Finora intentionally operates TWO authority models. **Do not force architectural consistency where the product demands a split.**

### A. Local-First Personal Finance
- **Applies to:** Accounts, transactions, budgets, categories, local `debts` (Personal IOUs), local `people`.
- **General Architecture:** Personal finance data is local-first and participates in the generic personal-data sync system (via dirty tracking). The app must remain useful offline. Account/user switching must not leak queues/data/actions between users.
- **Crucial Lesson:** Unexpected upload failures MUST preserve dirty records. **Do not clear dirty state because an error message says "does not exist".** Cloud absence alone must never be treated as proof that local personal financial data should be deleted. Dirty/unsynced personal data must survive pulls/realtime.

### B. Cloud-Authoritative / Consensus Data
- **Applies to:** Finora profiles, Connections, `shared_ious`, and future settlements.
- **General Architecture:** These involve identity, permissions, and shared state between multiple users. They use Supabase/RPCs as the ultimate authority, with Dexie serving only as a local read cache. Cloud-authoritative cache tables do NOT participate in the generic dirty-record sync pipeline.
- Offline shared mutations must not pretend to have succeeded when they have not.

## 5. Backend & Security
- **Security:** Prefer narrow action RPCs over broad mutation permissions. SECURITY DEFINER functions must validate the actor/role/state and expose EXECUTE only to intended roles. Do not weaken RLS because an RPC already performs checks.
- **No Service Roles:** There are no service-role credentials in the frontend. RLS/backend authorization is mandatory.
- **Database/Migrations:** Keep `supabase-schema.sql` (canonical) and migrations (`supabase-schema-migration-*.sql`) in sync. Verify production schemas directly. Do not casually alter/drop existing production schema because the production DB may intentionally contain additive schema ahead of the frontend. Migrations must be additive/backward-compatible where appropriate. Never rerun old migrations blindly.

## 6. Transactions, Finances & State
- **Occurrence Timestamp:** Transaction Date/Time represents *when it occurred*, not just when it was logged.
- **Strict Data Validation:** A transaction must never silently retain an invalid account or category. Submit-time validation is the final safety boundary.
- **History Semantics:** Preserve correction/history semantics for financial records. Pending is not confirmed. Avoid double counting.

## 7. Notifications
- **Classification:** Use `notification.type` for semantic notification classification (e.g., `'shared_iou_request'`).
- **Idempotency:** `notification.event_key` is an idempotency/event identifier (often containing appended UUIDs and timestamps). It must NOT be treated as the clean notification type.

## 8. UI & Routing Guardrails
- **React Router Only:** Use React Router APIs for state (`useNavigate({ replace: true, state: ... })`). Do NOT manipulate navigation state with raw `window.history.replaceState` or `window.history.back()`.
- **Mobile Cautions:** Be cautious with `h-screen`, fixed heights, body `overflow: hidden`, safe-area insets, and keyboard handling.

## 9. Coding Patterns
- **IDs:** Use `createId('prefix')`.
- **Currency:** Use `formatMoney(amount)`.
