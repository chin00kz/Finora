<div align="center">
  <h1>Finora</h1>
  <p>A fast, local-first personal finance tracker built for the realities of modern cashflow.</p>

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Dexie.js](https://img.shields.io/badge/IndexedDB-Dexie.js-blue)](https://dexie.com/)
[![Supabase](https://img.shields.io/badge/Cloud-Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## Table of Contents

- [Why Finora?](#why-finora)
- [Coming Soon](#coming-soon)
- [Architectural Philosophy](#architectural-philosophy)
- [System Features](#system-features)
  - [1. Minimalist Dashboard & Ergonomics](#1-minimalist-dashboard--ergonomics)
  - [2. Safe-to-Spend Cashflow Forecast](#2-safe-to-spend-cashflow-forecast)
  - [3. Privacy Masking Mode (Incognito)](#3-privacy-masking-mode-incognito)
  - [4. Monthly Digest & Financial Review](#4-monthly-digest--financial-review)
  - [5. IOUs & Debts (Manual Entry + Multi-Step Settlement)](#5-ious--debts-manual-entry--multi-step-settlement)
  - [6. Credit Card & Float Management (`/float-tools`)](#6-credit-card--float-management-float-tools)
  - [7. Recurring Transactions Engine](#7-recurring-transactions-engine)
  - [8. Savings Goals & Allocations](#8-savings-goals--allocations)
  - [9. Data Portability & JSON Backup](#9-data-portability--json-backup)
  - [10. Local-First Engine & Cloud Sync](#10-local-first-engine--cloud-sync)
  - [11. PDF Statement Reader (`/statements`)](#11-pdf-statement-reader-statements)
- [Database Schema & Entities](#database-schema--entities)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [License & Authors](#license--authors)

---

## Why Finora?

Personal finance software typically suffers from one of two extremes:
1. **The Toy App**: Visually clean, but falls apart when handling multiple accounts, credit float cycles, shared split bills, or debt settlements.
2. **The Cluttered Spreadsheet**: Exposes every graph, table, form field, and button simultaneously on the home screen, turning quick expense logging into an overwhelming chore.

**Finora solves this with progressive disclosure:**
The everyday surface is disciplined, distraction-free, and lightning-fast. Deep financial mechanics (liquidity forecasts, float gap stress-tests, reimbursement ledgers, installment amortizations, and monthly digests) remain readily accessible in dedicated spaces without polluting your daily glance.

---

## Coming Soon

Finora is expanding to support shared financial tracking.

### Shared IOUs

Shared IOUs will let you create an IOU with another Finora user instead of maintaining two separate records.

- Send an IOU request to a connected friend
- Accept or decline incoming IOUs
- Keep both sides synchronized from one shared record
- Record payment requests and confirmations
- Track the remaining balance automatically
- Keep shared history visible to both participants

Shared IOUs are designed around mutual confirmation — creating an IOU does not silently add a debt to someone else's account.

### Friends & Connections

The foundation for shared finance is already available.

Finora users can create a unique username, find other users, send connection requests, and manage accepted connections while keeping existing local People and IOUs separate.

Existing local IOUs remain private and are never automatically converted into shared IOUs.

---

## Architectural Philosophy

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                           LAYER 1: THE SURFACE                                         │
│  • Available Balance Glance                   • Fast Transaction Capture               │
│  • Adaptive Glance Colors                     • Keyboard Shortcuts (N / Escape)        │
│  • Safe-to-Spend Liquidity Forecast           • Global Animated Undo Toast             │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                     │
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         LAYER 2: DEEP TOOLS                                            │
│  • Credit & Float Management Module           • IOUs & Multi-Step Settlements          │
│  • Recurring Schedule & Catch-Up              • Monthly Retrospective Digests          │
│  • Savings Goals with Visual Rings            • CSV / PDF / JSON Data Port             │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                     │
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 3: LOCAL-FIRST DATA ENGINE                                    │
│  Dexie.js (IndexedDB) ──────── SyncEngine ──────── Supabase Cloud                      │
│  • Fast local reads/writes         • Two-way sync    • Auth & Security                 │
│  • Seamless Offline operations     • Delta queue     • Cloud Backup                    │
│  • Zero mock data pollution        • Race-free undo  • Conflict resolution             │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Local-First Speed**: All read and write operations hit the local IndexedDB database first for maximum performance. Core finance functionality remains usable offline, seamlessly syncing changes when connectivity is restored.
2. **Universal Ergonomics**: Wide desktop screens are treated with intentional centering and proportional breathing room—never filled with synthetic filler cards. Mobile screens feature a thumb-friendly bottom bar with strict slot controls.
3. **Budget-Neutral Integrity**: Transactions generated from debt settlements, internal transfers, and reimbursements never distort real-world budget consumption or category spend.
4. **Zero Mock Pollution**: New guest sessions start clean. No dummy tags, fake accounts, or seeded transactions pollute your personal ledger.

---

## System Features

### 1. Minimalist Dashboard & Ergonomics
- **Available Balance Context**: Immediate view of total available funds and active account count.
- **Monthly Budget Focus**: Primary budget status card with remaining amount, spent amount, percentage consumed, days remaining, and adaptive progress coloring.
- **Upcoming Payments**: Surfaces recurring payments due within the next 24 hours.
- **Customizable Mobile Navigation (Strict 4 to 6 Slots)**: Enforces an ergonomic bottom bar on mobile screens. Rearrange primary tabs with up/down controls and tuck secondary tools under the **Explore More** drawer.
- **Desktop Sidebar Navigation**: Clean persistent sidebar with status indicators, theme toggles, and sync state.

### 2. Safe-to-Spend Cashflow Forecast
- **Forward-Looking Liquidity**: Subtracts pending recurring transactions (rent, subscriptions) and unpaid statement balances from current cash to reveal true disposable liquidity.
- **Credit-Aware**: Knows when a credit card statement is due and sets aside cash automatically to prevent false confidence.
- **Money Market Exclusion**: Supports designating savings accounts as "Money Market," removing them from the liquid Safe-to-Spend pool while still tracking their balance.

### 3. Privacy Masking Mode (Incognito)
- **Global Obfuscation**: Toggle the 'eye' icon in the navigation to instantly mask all sensitive numbers across the entire application (Dashboards, Accounts, Transactions).
- **Graceful Degradation**: Charts are hidden or blurred, preventing shoulder-surfing in public environments.

### 4. Monthly Digest & Financial Review
- **Retrospective Analysis**: At the end of a month (or anytime via Analytics), view a comprehensive breakdown of income, expenses, and net delta.
- **Top Spikes Identification**: Automatically bubbles up the highest 3 expenditures of the month to catch lifestyle creep.
- **Category Deep Dive**: Visualizes spend distribution across categories using an interactive pie chart.

### 5. IOUs & Debts (Manual Entry + Multi-Step Settlement)
- **Unified Entity**: Track exactly who owes what, and who you owe.
- **Partial Settlements**: Log multiple partial repayments against a single debt until it hits zero.
- **Budget Neutrality**: Settlements generate offset transactions that bypass expense charts so a repaid dinner bill doesn't artificially inflate your reported monthly spending.

### 6. Credit Card & Float Management (`/float-tools`)
*A specialized suite for users maximizing credit card float without carrying interest.*
- **Float Gap Engine**: Tracks the "Float Gap"—the delta between outstanding credit card liabilities and your actual cash reserves. 
- **0% Installment Planner**: Maps multi-month installment plans against card limits to forecast utilization.
- **Reimbursement Ledgers**: Correlates corporate expenses or shared purchases placed on your card with the specific counterparty who owes you, ensuring your personal budget remains isolated.

### 7. Recurring Transactions Engine
- **Flexible Frequencies**: Supports daily, weekly, monthly, and yearly recurrences.
- **Look-Ahead Queue**: Visualizes the upcoming 30 days of scheduled transactions.
- **Overdue Catch-Up**: Automatically detects past-due items and prompts for manual approval to ensure no skipped payments silently distort the ledger.

### 8. Savings Goals & Allocations
- **Visual Envelopes**: Create named savings targets (e.g., "Emergency Fund", "New Laptop").
- **Fund Allocation**: Move virtual money into goals without needing separate physical bank accounts.
- **Progress Tracking**: Circular SVG progress rings visualize completion percentages.

### 9. Data Portability & JSON Backup
- **Lock-in Free**: Export the entire database as a single structured JSON file.
- **Safe Restoration**: Wipe and restore state from JSON snapshots for bulletproof disaster recovery or device migration.
- **Universal CSV Engine**: Import historical records from any bank with an intelligent column mapper, or export flat-file CSVs for spreadsheet analysis.

### 10. Local-First Engine & Cloud Sync
- **Instant Response**: Built on `Dexie.js`, providing zero-latency interactions unaffected by network conditions.
- **Supabase Realtime Sync**: A custom sync engine merges delta changes across devices.
- **Pull-on-Focus**: Automatically fetches upstream cloud changes when the app regains focus or reconnects to the network, preventing stale state on mobile.

### 11. PDF Statement Reader (`/statements`)
- **Client-Side Parsing**: Upload PDF statements and extract transactions and payment plans instantly.
- **Privacy-First**: Files are processed locally via PDF.js worker; no financial documents are uploaded to any server.

---

## Database Schema & Entities

| Table | Purpose | Sync |
|:---|:---|:---:|
| `profiles` | Cloud identities with usernames and display names | Cloud |
| `connections` | Friends and connections tracking mutual requests | Cloud |
| `accounts` | Source of truth for liquidity and balances | Yes |
| `categories` | Spending classifications (e.g. Food, Transport) | Yes |
| `tags` | Orthogonal cross-category labels (e.g. #vacation) | Yes |
| `transactions` | Single entry ledger tracking inflows/outflows | Yes |
| `budgets` | Monthly spending caps by category | Yes |
| `savingsGoals` | Virtual envelopes tracking target amounts | Yes |
| `recurringTransactions`| Rules engine for auto-generating future transactions | Yes |
| `people` | Counterparties for debts and reimbursements | Yes |
| `debts` | Tracked IOUs with partial settlement histories | Yes |
| `creditCards` | Credit limits, statement dates, and due dates | Yes |
| `cashOffsetSources` | Liquid accounts designated to back credit float | Yes |
| `moneyMarketAccounts` | MMA balances, rate tiers, minimum balance requirements | Yes |
| `installmentPlans` | 0% installment tenures, monthly payments, remaining terms | Yes |
| `cardPromos` | Minimum spend thresholds, cashback caps, expiry windows | Yes |
| `floatGapHistory` | Historical card bills vs cash offset deltas and cumulative gaps | Yes |
| `reimbursementLedgers` | Counterparty card expense ledgers with card association | Yes |
| `reimbursementEntries` | Individual entries tracking owed vs paid balances | Yes |
| `statementCards` | Saved card labels for PDF statement uploads | Local |
| `parsedStatements` | Client-side parsed PDF statements with transactions & plans | Local |

---

## Tech Stack

```text
Frontend Framework:       React 19 (SPA)
Build Tool & Bundler:     Vite 8
Programming Language:     TypeScript 5 (Strict Mode)
Styling System:           Tailwind CSS v4
Local Database:           Dexie.js (IndexedDB wrapper with reactive hooks)
Cloud & Authentication:   Supabase (PostgreSQL with Row Level Security)
Global State Store:       Zustand with localStorage persistence
Client-Side Router:       React Router v7
Iconography:              Lucide React
Date Manipulation:        date-fns
PDF Processing:           pdfjs-dist (client-side worker & layout extractor)
```

---

## Project Structure

```text
Finora/
├── src/
│   ├── components/                 # Reusable UI components
│   │   ├── GlobalUndoToast.tsx     # 6s animated fast-entry undo toast
│   │   ├── SafeToSpendCard.tsx     # Forward-looking liquidity forecast
│   │   ├── MonthlyDigestModal.tsx  # Retrospective financial review
│   │   ├── MaskedAmount.tsx        # Privacy obfuscation wrapper
│   │   ├── TransactionModal.tsx    # Fast-entry transaction creation
│   │   ├── TransactionEditSheet.tsx# Transaction detail & edit drawer
│   │   ├── ExportReportModal.tsx   # CSV & PDF export dialog
│   │   ├── ImportDataModal.tsx     # Smart CSV importer with auto-map
│   │   ├── CustomizeNavModal.tsx   # 4-6 slot bottom bar organizer
│   │   └── ...
│   ├── db/                         # Database schema & migrations
│   │   └── db.ts                   # Dexie.js database & TypeScript models
│   ├── pages/                      # Application views
│   │   ├── Dashboard.tsx           # Budget-focused Home overview
│   │   ├── Accounts.tsx            # Account balances & management
│   │   ├── Activity.tsx            # Transaction history & inline repeat
│   │   ├── Analytics.tsx           # Charts, trends, and digest access
│   │   ├── Debts.tsx               # IOUs, manual debts & settlements
│   │   ├── Recurring.tsx           # Recurring schedule manager
│   │   ├── Goals.tsx               # Savings goals & progress rings
│   │   ├── FloatTools.tsx          # Credit & Float power tools module
│   │   ├── StatementReader.tsx     # Client-side PDF credit card statement reader
│   │   ├── Connections.tsx         # Identity and connections manager
│   │   └── Settings.tsx            # Preferences, sync, tags & backups
│   ├── lib/                        # Client libraries & setup
│   │   └── supabase.ts             # Supabase client initialization
│   ├── store/                      # Zustand state management
│   │   ├── authStore.ts            # User auth & sync timestamp state
│   │   ├── navStore.ts             # Mobile navigation slot preferences
│   │   ├── privacyStore.ts         # Masking, safe-to-spend
│   │   ├── themeStore.ts           # Light, Dark, System theme mode
│   │   └── uiStore.ts              # Modal states, prefill, undo toast
│   ├── sync/                       # Synchronization engine
│   │   └── syncEngine.ts           # Record-level dirty queue, merge, pull-on-focus
│   ├── utils/                      # Core calculation & business engines
│   │   ├── createId.ts             # Monotonic prefix ID generator
│   │   ├── formatters.ts           # Currency and compact money utilities
│   │   ├── safeToSpendEngine.ts    # Liquidity forecast formula & MMA checks
│   │   ├── monthlyDigestEngine.ts  # Retrospectives, spike checks & insights
│   │   ├── statementParser.ts      # PDF text extraction & Combank layout parser
│   │   └── jsonBackup.ts           # Full database JSON snapshot import/export
│   ├── App.tsx                     # AppShell, routing, global modals & toast
│   └── main.tsx                    # React application bootstrap
├── .env.example                    # Template environment variables
├── supabase-schema.sql             # Cloud database schema, RLS policies & auth trigger
├── supabase-schema-phase1.sql      # Identity and Connections schema
├── tailwind.config.js              # Tailwind styling configuration
└── vite.config.ts                  # Vite build tool configuration
```

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
   Finora heavily utilizes a local-first architecture for performance, though cloud sync and identities power the connected experience. If you wish to connect Supabase cloud sync, copy the example environment file and fill in your Supabase credentials:
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local`:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
   > **Note:** `.env` and `.env.local` files are ignored by git to protect credentials. Never commit production keys to a public repository. 
   
   > **Supabase Setup:** You **must** execute `supabase-schema.sql` and `supabase-schema-phase1.sql` in your Supabase SQL Editor to provision the tables, enable Row Level Security (RLS), attach the signup domain trigger, and configure the `supabase_realtime` publication for instant cross-device sync.

   > **Deployment Tip (Vercel):** When deploying to Vercel, ensure your `VITE_` environment variables are set as **Plaintext/Config**, not as Secrets, otherwise they will be blocked at build time.

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

## License & Authors

Finora is licensed under the MIT License.

Created and maintained by [chin00kz](https://github.com/chin00kz).

### Bug Fixes & Contributions
- **[RomeshG](https://github.com/RomeshCG)** - Bug fixes and synchronization engine contributions.
