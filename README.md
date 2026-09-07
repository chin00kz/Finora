# Finora

<div align="center">

**A modern, local-first personal finance and budget management platform.**

*Extremely simple on the surface. Extremely powerful underneath.*

[![React 19](https://img.shields.io/badge/React-19.x-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Dexie.js](https://img.shields.io/badge/IndexedDB-Dexie.js-blue)](https://dexie.com/)
[![Supabase](https://img.shields.io/badge/Cloud-Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## 📖 Table of Contents

- [💡 Why Finora?](#-why-finora)
- [🏛️ Architectural Philosophy](#️-architectural-philosophy)
- [✨ System Features](#-system-features)
  - [1. Minimalist Home Dashboard & Ergonomics](#1-minimalist-home-dashboard--ergonomics)
  - [2. Fast-Entry Transaction Suite (Habitual Shortcuts)](#2-fast-entry-transaction-suite-habitual-shortcuts)
  - [3. Safe-to-Spend Cashflow Forecast](#3-safe-to-spend-cashflow-forecast)
  - [4. Privacy Masking Mode (Incognito)](#4-privacy-masking-mode-incognito)
  - [5. Monthly Digest & Financial Review](#5-monthly-digest--financial-review)
  - [6. IOUs & Debts (Manual Entry + Multi-Step Settlement)](#6-ious--debts-manual-entry--multi-step-settlement)
  - [7. Credit Card & Float Management (`/float-tools`)](#7-credit-card--float-management-float-tools)
  - [8. Recurring Transactions Engine](#8-recurring-transactions-engine)
  - [9. Savings Goals & Allocations](#9-savings-goals--allocations)
  - [10. Data Portability, Full JSON Backup & CSV Engine](#10-data-portability-full-json-backup--csv-engine)
  - [11. Local-First Engine & Cloud Sync Engine](#11-local-first-engine--cloud-sync-engine)
- [🗄️ Database Schema & Entities](#️-database-schema--entities)
- [🛠️ Tech Stack](#️-tech-stack)
- [📁 Project Structure](#-project-structure)
- [🚀 Getting Started](#-getting-started)
- [⌨️ Keyboard Shortcuts](#️-keyboard-shortcuts)
- [📄 License & Authors](#-license--authors)

---

## 💡 Why Finora?

Personal finance software typically suffers from one of two extremes:
1. **The Toy App**: Visually clean, but falls apart when handling multiple accounts, credit float cycles, shared split bills, irregular habitual spending, or debt settlements.
2. **The Cluttered Spreadsheet**: Exposes every graph, table, form field, and button simultaneously on the home screen, turning quick expense logging into an overwhelming chore.

**Finora solves this with progressive disclosure:**
The everyday surface is disciplined, distraction-free, and lightning-fast. Deep financial mechanics (liquidity forecasts, float gap stress-tests, reimbursement ledgers, installment amortizations, and monthly digests) remain readily accessible in dedicated spaces without polluting your daily glance.

---

## 🏛️ Architectural Philosophy

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           LAYER 1: THE SURFACE                          │
│  • Available Balance Glance            • Quick-Add Habitual Chips (1-tap)│
│  • Spending Velocity & Pace Indicator  • Keyboard Shortcuts (N / Escape) │
│  • Safe-to-Spend Liquidity Forecast    • Global Animated Undo Toast      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                         LAYER 2: DEEP TOOLS                             │
│  • Credit & Float Management Module    • IOUs & Multi-Step Settlements   │
│  • Recurring Schedule & Catch-Up       • Monthly Retrospective Digests   │
│  • Savings Goals with Visual Rings     • CSV / PDF / JSON Data Port      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                    LAYER 3: LOCAL-FIRST DATA ENGINE                     │
│  Dexie.js (IndexedDB) ──────── SyncEngine ──────── Supabase Cloud       │
│  • Sub-millisecond reads/writes  • Two-way sync    • Auth & Security     │
│  • 100% Offline autonomy         • Delta queue     • Cloud Backup        │
│  • Zero mock data pollution      • Race-free undo  • Conflict resolution │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **Local-First is Sovereign**: All read and write operations hit the local IndexedDB database first. Finora is 100% functional without an active internet connection.
2. **Universal Ergonomics**: Wide desktop screens are treated with intentional centering and proportional breathing room—never filled with synthetic filler cards. Mobile screens feature a thumb-friendly bottom bar with strict slot controls.
3. **Budget-Neutral Integrity**: Transactions generated from debt settlements, internal transfers, and reimbursements never distort real-world budget consumption or category spend.
4. **Zero Mock Pollution**: New guest sessions start clean. No dummy tags, fake accounts, or seeded transactions pollute your personal ledger.

---

## ✨ System Features

### 1. Minimalist Home Dashboard & Ergonomics
- **Glance Metrics**: View your **Available Balance**, **Spent This Period**, and dynamic **Daily Spending Pace** in under three seconds.
- **Dynamic Pacing Indicator**: Gauges whether your current spending velocity is sustainable over the remaining days of your budget cycle.
- **Customizable Mobile Navigation (Strict 4 to 6 Slots)**: Enforces an ergonomic bottom bar on mobile screens. Rearrange primary tabs with ↑ / ↓ controls and tuck secondary tools under the **Explore More** drawer.
- **Desktop Sidebar Navigation**: Clean persistent sidebar with status indicators, theme toggles, and sync state.

### 2. Fast-Entry Transaction Suite (Habitual Shortcuts)
*Designed to eliminate data-entry friction for frequent everyday purchases (e.g. coffee, lunch, transit) that do not fit rigid recurring schedules.*
- **Habitual Pattern Engine (`quickLogEngine.ts`)**: Scans transactions over a rolling 45-day window to compute recurring habitual items.
- **Contextual Time-of-Day Boost**: Dynamically prioritizes items matching the current time bucket with up to a +35% score multiplier:
  - *Morning* (5:00 AM – 11:00 AM)
  - *Midday* (11:00 AM – 4:00 PM)
  - *Evening* (4:00 PM – 9:00 PM)
  - *Night* (9:00 PM – 5:00 AM)
- **Account & Category Memory**: Remembers the last-used account and category per canonical note. If an account was deleted, displays an amber `⚠️ Pick Acc` badge and redirects to the form to avoid silent misbooking.
- **Quick-Add Favorite Chips (`QuickAddChips.tsx`)**: Tappable pills embedded at the top of the transaction modal and optionally on the Home Dashboard.
- **Smart Amount Memory & Instant Select**: Typing a description automatically fills the last logged price and highlights the numeric field (`amountInputRef.select()`), allowing instant overwrite with a single tap.
- **Inline "Log Again Today" Repeat Action**: One-click repeat button (`RotateCcw`) on every row in the Activity table and mobile card view.
- **Global Animated Undo Toast (`GlobalUndoToast.tsx`)**: 6-second radial countdown toast. Reverses account balance changes, removes the Dexie transaction, and cancels in-flight pending sync entries to prevent ghost creations on Supabase.

### 3. Safe-to-Spend Cashflow Forecast
*A forward-looking liquidity engine that answers "How much can I spend right now without risking an upcoming bill?"*
- **Liquidity Formula**:
  $$\text{Safe-to-Spend} = \text{Liquid Cash} - \text{Net Pending Card Bills} - \text{Upcoming Recurring} + \text{Net Reimbursements}$$
- **Liquid Cash Aggregation**: Sums checking, savings, and cash accounts, plus money market accounts (MMAs).
- **MMA Rate Threshold Protection**: Displays inline warnings if withdrawing cash would breach an MMA's `minimumBalanceForRate` floor.
- **Card-Offset Deduplication**: Routes reimbursement entries with `isCardRelated: true` directly to card bill offsets to prevent double-counting.
- **Configurable Horizon**: Toggle upcoming recurring lookahead between 7, 14, or 30 days.
- **Collapsible Breakdown**: Interactive drawer revealing exact line-item contributions to the final liquidity figure.

### 4. Privacy Masking Mode (Incognito)
- **Global Masking Switch**: One-click toggle in the header (Desktop & Mobile) and Settings.
- **Full App Obfuscation**: Masks every balance, transaction amount, forecast metric, and chip price with `•••••`.
- **Persistent State**: Masking preference stays active across browser reloads.

### 5. Monthly Digest & Financial Review
- **Retrospective Analysis**: Accessible from Analytics and Settings (`MonthlyDigestModal.tsx`).
- **Net Cashflow & Savings Rate**: Complete breakdown of total income, total expenses, net savings, and savings percentage.
- **Top Categories & Spikes**: Highlights spending concentrations and flags categories that surged >20% compared to your 3-month rolling average.
- **Installment Completion Cross-Referencing**: Identifies if a category spike was caused by completing an installment plan tenure.
- **Behavioral Takeaways**: Dynamically generates 3 actionable, human-readable observations regarding your spending habits.

### 6. IOUs & Debts (Manual Entry + Multi-Step Settlement)
- **Two Inflow Sources**:
  1. *Shared Expense Split*: Auto-generated when splitting a logged expense.
  2. *Manual Debt Entry*: Direct entry for loans, borrowed cash, or debts paid by others on your behalf (`theyOweMe` vs `iOweThem`).
- **Multi-Step Partial & Full Settlement**: Settle debts incrementally over time.
- **Flexible Settlement Methods**:
  - `account`: Creates a budget-neutral `debt_settlement` transaction linking real cash or bank accounts.
  - `exclude`: Settles in-kind (favors, reciprocal bills, direct cash) without touching account balances.
- **Full Audit History & Rollback**: Each debt records an immutable settlement history with one-tap settlement reversal and balance restoration.

### 7. Credit Card & Float Management (`/float-tools`)
*A power-user suite designed for interest arbitrage and credit card management.*
- **Multi-Card Exposure**: Monitor utilized balances, credit limits, cycle closing dates, and payment deadlines.
- **Cash Offset Source Linking**: Model external recurring cash inflows (e.g. rental shares, retainers) earmarked to cover card balances.
- **Float Gap Delta Engine**: Calculates cycle-by-cycle deltas (Cash Received - Total Bill) and renders cumulative SVG trend charts.
- **Payment Intent Stress Tests**:
  - `payInFullIntent: true` — Generates alerts if projected liquid cash cannot cover the due balance.
  - `payInFullIntent: false` — Calculates compounding APR carrying costs.
- **0% Installment Plan Tracker**: Track active tenures, monthly deductions, and remaining commitment balances.
- **Honest Yield vs. APR Comparator**: Computes the net gain/loss of holding cash in MMAs or Fixed Deposits against card interest.
- **Reimbursement Ledgers**: Multi-counterparty running ledgers tracking who owes you for specific card expenses.

### 8. Recurring Transactions Engine
- **Flexible Cadences**: Supports Daily, Weekly, Monthly, and Yearly schedules with automatic next-due calculation.
- **Launch Catch-Up**: Scans and executes all due recurring transactions as soon as the app is launched.
- **Template Controls**: Pause, resume, trigger on-demand execution, or edit templates.

### 9. Savings Goals & Allocations
- **Visual Target Rings**: Monitor progress percentage, target amounts, and projected completion dates.
- **Account Linking**: Associate savings goals with specific bank or vault accounts.
- **Deposit & Withdrawal Workflows**: Log transfers in or out of goals with immediate balance synchronization.

### 10. Data Portability, Full JSON Backup & CSV Engine
- **Complete JSON Snapshot Backup**: One-click export (`exportFullBackupJSON`) and restore (`restoreFullBackupJSON`) covering all 18 Dexie tables with automated schema validation.
- **CSV Import with Smart Matching**: Auto-maps column headers, deduplicates existing rows, and dynamically creates missing accounts and categories.
- **Itemized CSV & Formatted PDF Reports**: Download itemized transaction spreadsheets or printer-friendly PDF financial summaries.

### 11. Local-First Engine & Cloud Sync Engine
- **Dexie.js IndexedDB Store**: Real-time reactivity via `useLiveQuery` with sub-millisecond local latency.
- **Supabase Cloud Sync**: Two-way synchronization on window focus, visibility change, or manual trigger.
- **Offline Sync Queue**: Queues offline mutations in `localStorage` (`finora-pending-sync`) and drains them in order once online.
- **Cloud Duplicate Resolver**: Dedicated tool in Settings to clean up remote duplicate IDs and align cloud state with local storage.

---

## 🗄️ Database Schema & Entities

Finora uses an 18-table local schema managed by Dexie.js (`FinoraDB`):

| Table | Primary Role | Synced to Cloud |
|---|---|:---:|
| `accounts` | Liquid accounts, credit cards, bank accounts, cash wallets | Yes |
| `transactions` | Expenses, incomes, transfers, and budget-neutral debt settlements | Yes |
| `categories` | Spending and earning categories with icons and hex colors | Yes |
| `tags` | Flexible multi-tag categorization | Yes |
| `budgets` | Periodic budget allocations and spending caps | Yes |
| `people` | Counterparties for shared bills and debts | Yes |
| `debts` | Auto-generated splits and manual IOUs with settlement logs | Yes |
| `recurring` | Scheduled recurring expense and income templates | Yes |
| `goals` | Target savings goals with funding amounts | Yes |
| `creditCards` | Credit limits, APR rates, grace periods, payment intent | Local |
| `cashOffsetSources`| Earmarked monthly cash inflows linked to cards | Local |
| `fixedDeposits` | FD principal amounts, interest rates, maturities | Local |
| `moneyMarketAccounts` | MMA balances, rate tiers, minimum balance requirements | Local |
| `installmentPlans` | 0% installment tenures, monthly payments, remaining terms | Local |
| `cardPromos` | Minimum spend thresholds, cashback caps, expiry windows | Local |
| `floatGapHistory` | Historical card bills vs cash offset deltas and cumulative gaps | Local |
| `reimbursementLedgers` | Counterparty card expense ledgers with card association | Local |
| `reimbursementEntries` | Individual entries tracking owed vs paid balances | Local |

---

## 🛠️ Tech Stack

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
```

---

## 📁 Project Structure

```text
Finora/
├── src/
│   ├── components/                 # Reusable UI components
│   │   ├── GlobalUndoToast.tsx     # 6s animated fast-entry undo toast
│   │   ├── QuickAddChips.tsx       # Habitual shortcut pills
│   │   ├── SafeToSpendCard.tsx     # Forward-looking liquidity forecast
│   │   ├── MonthlyDigestModal.tsx  # Retrospective financial review
│   │   ├── MaskedAmount.tsx        # Privacy obfuscation wrapper
│   │   ├── TransactionModal.tsx    # Fast-entry transaction creation
│   │   ├── TransactionEditSheet.tsx# Transaction detail & edit drawer
│   │   ├── ExportReportModal.tsx   # CSV & PDF export dialog
│   │   ├── ImportDataModal.tsx     # Smart CSV importer with auto-map
│   │   ├── MobileNavCustomizer.tsx # 4-6 slot bottom bar organizer
│   │   └── ...
│   ├── db/                         # Database schema & migrations
│   │   └── db.ts                   # Dexie.js database & TypeScript models
│   ├── pages/                      # Application views
│   │   ├── Dashboard.tsx           # Home glance overview & quick chips
│   │   ├── Accounts.tsx            # Account balances & management
│   │   ├── Activity.tsx            # Transaction history & inline repeat
│   │   ├── Analytics.tsx           # Charts, trends, and digest access
│   │   ├── Debts.tsx               # IOUs, manual debts & settlements
│   │   ├── Recurring.tsx           # Recurring schedule manager
│   │   ├── Goals.tsx               # Savings goals & progress rings
│   │   ├── FloatTools.tsx          # Credit & Float power tools module
│   │   └── Settings.tsx            # Preferences, sync, tags & backups
│   ├── store/                      # Zustand state management
│   │   ├── authStore.ts            # User auth & sync timestamp state
│   │   ├── navStore.ts             # Mobile navigation slot preferences
│   │   ├── privacyStore.ts         # Masking, safe-to-spend & fast-entry
│   │   ├── themeStore.ts           # Light, Dark, System theme mode
│   │   └── uiStore.ts              # Modal states, prefill, undo toast
│   ├── sync/                       # Synchronization engine
│   │   ├── supabaseClient.ts       # Supabase client initialization
│   │   └── syncEngine.ts           # Two-way sync, delta queue, dedupe
│   ├── utils/                      # Core calculation & business engines
│   │   ├── quickLogEngine.ts       # Habitual frequency & time-of-day scoring
│   │   ├── safeToSpendEngine.ts    # Liquidity forecast formula & MMA checks
│   │   ├── monthlyDigestEngine.ts  # Retrospectives, spike checks & insights
│   │   ├── jsonBackup.ts           # Full database JSON snapshot import/export
│   │   └── formatters.ts           # Currency and date utilities
│   ├── App.tsx                     # AppShell, routing, global modals & toast
│   └── main.tsx                    # React application bootstrap
├── supabase-schema.sql             # Cloud database schema & RLS policies
├── tailwind.config.js              # Tailwind styling configuration
└── vite.config.ts                  # Vite build tool configuration
```

---

## 🚀 Getting Started

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
   Finora is completely functional offline as a guest without any external service. If you wish to connect Supabase cloud sync, create a `.env` file in the project root:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

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

## ⌨️ Keyboard Shortcuts

| Shortcut | Action | Scope |
|:---:|---|---|
| <kbd>N</kbd> | Open New Transaction Modal | Global (any screen) |
| <kbd>Escape</kbd> | Close active modal / dismiss overlay | Global |
| <kbd>/</kbd> | Focus search bar | Activity & Transaction views |
| <kbd>Enter</kbd> | Confirm action / submit modal | Active dialogs |

---

## 📄 License & Authors

Created and maintained by [chin00kz](https://github.com/chin00kz).

Distributed under the MIT License. See [LICENSE](LICENSE) for more details.
