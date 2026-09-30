# Finora

Finora is a local-first personal finance application for managing accounts, transactions, budgets, IOUs, shared money with trusted friends, and financial insights.

Built for speed and offline reliability, Finora gives you complete control over your personal financial data while offering a secure cloud-connected experience for managing IOUs and settlements with trusted friends.

## Features

### Personal Finance (Local-First)
- **Accounts & Balances:** Track multiple accounts with real-time balance aggregation.
- **Transactions & Activity:** Fast, offline-first transaction logging with categorization and tagging.
- **Budgets & Safe-to-Spend:** Set monthly budgets and view your "Safe-to-Spend" forecast at a glance.
- **Recurring Payments:** Automate repeating subscriptions and bills.
- **Savings Goals:** Track progress toward financial targets.
- **Personal IOUs:** Keep a private ledger of debts with people, even if they don't use Finora.
- **Statement Tools:** Import and parse financial statements directly in the browser.
- **Analytics & Digest:** View monthly retrospectives, spending spikes, and category breakdowns.
- **Privacy & Export:** Full JSON backup, import, and export capabilities. Complete control over your data.

### Shared Finances (Cloud-Connected)
- **Friends & Connections:** Add other Finora users securely to share IOUs.
- **Shared IOUs:** Create, accept, decline, or cancel authoritative shared debts.
- **Settlements & Partial Payments:** Propose and confirm payments. Handles partial payments, overpayments, and opposite obligations gracefully.
- **Account-Linked Recording:** Creditors can directly deposit settled IOUs to their local accounts; payers can record payments from their accounts.
- **Trusted Friend Auto-Accept:** Optionally configure directional auto-acceptance for IOUs from highly trusted friends.
- **Debtor Rejection Controls:** Reject or dispute proposed settlements with clear history semantics.
- **Global Semantic Notifications:** Real-time push notification feed with color-coded financial priority (Red/Amber/Green) and unread count badges.

---

## Architecture: The Dual Authority Model

Finora intentionally separates data ownership into two distinct models to maximize offline reliability and consensus integrity.

### 1. Personal Data (Local-First Authority)
Your accounts, transactions, budgets, categories, and personal debts are **local-first**.
- **Engine:** Dexie (IndexedDB)
- **Behavior:** Operates fully offline. Changes are optimistically tracked as dirty and synced to the cloud (Supabase) in the background when connected.
- **Guarantees:** The local database is the ultimate authority for your personal money.

### 2. Shared Data (Cloud-Authoritative Consensus)
Your connections, shared IOUs, and settlements represent agreements between multiple users and are **cloud-authoritative**.
- **Engine:** Supabase RPCs and Row Level Security (RLS)
- **Behavior:** Requires network connectivity to mutate. Dexie acts purely as a local read cache for offline viewing.
- **Guarantees:** Financial consensus is enforced by strictly validated backend Postgres functions, preventing concurrent over-settlements or unilateral history modification.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or newer recommended)
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)

### Installation & Local Run

1. **Clone the repository:**
   ```bash
   git clone https://github.com/chin00kz/Finora.git
   cd Finora
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables (Optional):**
   Finora is usable offline, but cloud sync and shared features require Supabase.
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local`:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
   > **Note:** `.env` and `.env.local` are ignored by git. Never commit production keys.
   
   > **Supabase Setup:** You must execute `supabase-schema.sql` and the associated phase migrations in your Supabase SQL Editor to provision tables, enable Row Level Security (RLS), attach the signup domain trigger, and configure `supabase_realtime`.

4. **Start the local development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

5. **Build for Production:**
   ```bash
   npm run build
   ```

---

## Keyboard Shortcuts

| Shortcut | Action | Scope |
|:---:|---|---|
| <kbd>N</kbd> | Open New Transaction Modal | Global (any screen) |
| <kbd>Escape</kbd> | Close active modal / dismiss overlay | Global |
| <kbd>/</kbd> | Focus search bar | Activity & Transaction views |
| <kbd>Enter</kbd> | Confirm action / submit modal | Active dialogs |

---

## Status & Roadmap

See [docs/STATUS.md](docs/STATUS.md) for the detailed current state of the repository, known technical debt, and parked features.

## License & Authors

Finora is licensed under the MIT License.

Created and maintained by [chin00kz](https://github.com/chin00kz).

### Bug Fixes & Contributions
- **[RomeshG](https://github.com/RomeshCG)** - Bug fixes and synchronization engine contributions.
