# Finora

A modern, local-first personal finance and budget management web app built around one unwavering principle:

> **Extremely simple on the surface. Extremely powerful underneath.**

---

## 💡 Why Finora?

Most personal finance apps suffer from one of two extremes:
1. **The Toy App**: Clean and aesthetic, but completely breaks down the moment you have multiple accounts, credit card float cycles, shared split expenses, or recurring bills.
2. **The Cluttered Spreadsheet**: Exposes every chart, button, table, and setting simultaneously, turning daily expense logging into a tedious accounting chore.

**Finora takes the progressive approach.**

The everyday experience is intentionally disciplined and minimal. Whether on mobile or a wide desktop monitor, the home dashboard focuses strictly on what matters most in three seconds:
* **Available Balance** — What you actually have right now
* **Spent This Period** — What has left your accounts
* **Daily Pace** — Whether your current spending velocity is sustainable
* **Recent Activity Glance** — Quick confirmation of your latest transactions

All deeper financial mechanics — float arbitrage, recurring rules, installment tracking, multi-card exposures, and analytics — live in dedicated, context-appropriate screens. They never clutter your daily view.

---

## ✨ Features

### 🏠 Minimalist Dashboard (Desktop & Mobile)
- **Universal Minimalism**: The dashboard respects strict simplicity on every screen size. On wide monitors, it remains cleanly centered and scaled rather than being padded out with unnecessary widgets.
- **Fast-Add Transaction Flow**: Tap `+` or press <kbd>N</kbd> on desktop to log a transaction with auto-suggested notes, categories, accounts, and tags in seconds.
- **Pace Indicator**: Dynamic pacing metric that alerts you if your spending rate is accelerating faster than your remaining cycle days.

### 📱 Customizable Bottom Navigation Bar (Mobile)
- **Front vs. More Customization**: Choose which destinations appear on the front bottom bar and which are tucked neatly under the **Explore More** drawer.
- **Strict 4 to 6 Slot Rule**: Automatically enforces between 4 and 6 visible options on the bar (including Settings and More) to keep touch targets ergonomic.
- **Reorderable Slots**: Reorder front items with $\uparrow / \downarrow$ controls to place your most-used screens under your thumb.
- **Persistent Preferences**: Your custom nav layout persists across browser sessions.

### 💻 Desktop Sidebar
- **Ergonomic Wide-Screen Navigation**: Replaces the bottom nav on desktop with an uncluttered, persistent sidebar.
- **Keyboard Shortcuts**: Press <kbd>N</kbd> anywhere in the app to open the quick transaction modal.
- **Theme & Profile Controls**: Instant switching between Light, Dark, and System modes with live sync status.

### 💳 Credit Card & Float Management Module (Power Tools)
*A dedicated Layer-2 module for power users, tucked into Settings (`/float-tools`).*
- **Multi-Card Exposure Tracking**: Monitor credit limits, utilized balances, statement closing dates, and payment due dates.
- **Cash Offset Source Linking**: Model float strategies where external recurring cash inflows (e.g., family funds, roommate rent, client retainer) offset card bills on a delayed cycle.
- **Float Gap Analysis & SVG Trend Chart**: Visual cumulative delta tracking between card expenses and cash received across monthly cycles.
- **Payment Shortfall Stress Tests**: Warnings tailored to payment intent (`payInFullIntent: true` triggers alert on shortfall; `false` computes APR carrying cost).
- **Third-Party Reimbursement Ledgers**: Track who owes you for specific card charges with running balance calculation.
- **0% Installment Plan Tracker**: Monitor monthly plan deductions, remaining tenures, and impact on available card buffer.
- **Honest Interest Comparator**: Clear math comparing what your cash earns sitting in a Money Market Account (MMA) or Fixed Deposit (FD) against the steep cost of credit card APR.

### 🔄 Recurring Transactions Engine
- **Automated Schedules**: Daily, weekly, bi-weekly, monthly, or custom intervals.
- **Catch-Up on Launch**: Automatically detects and processes due recurring transactions whenever the app is opened.
- **Full Lifecycle Control**: Pause, resume, run immediately, or edit recurring templates.

### 🎯 Savings Goals
- **Target Tracking**: Set goal targets, target dates, and assign custom icons and colors.
- **Visual Progress Rings**: Monitor funding percentages and milestones.
- **Dedicated Allocation**: Deposit or withdraw funds from specific accounts towards goals.

### 👥 IOUs & Debt Tracking
- **People Management**: Keep track of shared expenses, split bills, and informal loans.
- **Two-Way Balances**: Clearly distinguish between money you owe and money owed to you.
- **Settlement Tracking**: Support for partial payments and complete debt settlements.

### 📊 Analytics & Reporting
- **Category Breakdown**: Interactive spending distribution charts.
- **Temporal Trends**: Daily and monthly spending trajectory comparisons.
- **Payment Method Insights**: Track spending ratios between cash, debit, and credit accounts.

### 📁 Data Portability & Backup
- **CSV & PDF Export**: Generate itemized spreadsheet exports or clean, printable PDF financial summaries.
- **Intelligent CSV Import**: Restore previous exports or import external bank data with automatic header matching, deduplication, and on-the-fly creation of missing accounts, categories, and tags.
- **Local Storage Controls**: Dedicated option in Settings to wipe local storage cleanly or recover from backup without data contamination.

### ☁️ Local-First + Supabase Cloud Synchronization
- **Zero-Latency Offline First**: Powered by IndexedDB via Dexie.js. The app works 100% offline with instantaneous reads and writes.
- **Clean Database (No Mock Pollution)**: No automatic mock data or fake starter tags polluting your profile.
- **Two-Way Cloud Sync**: Seamlessly syncs to Supabase when authenticated, with background sync on focus/visibility change and offline queue draining.
- **Cloud Duplicate Resolver**: One-click tool in Settings to clean up remote duplication and re-establish local data as the single source of truth.

---

## 🛠️ Tech Stack

Finora is built as a progressive, local-first Single Page Application:

| Layer | Technology |
|---|---|
| **Framework** | [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) (Strict Mode) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) |
| **Local Database** | [Dexie.js](https://dexie.com/) (IndexedDB wrapper with live reactive queries) |
| **Cloud Backend** | [Supabase](https://supabase.com/) (Auth, PostgreSQL, Row-Level Security) |
| **State Management** | [Zustand](https://github.com/pmndrs/zustand) with persistence |
| **Routing** | [React Router v7](https://reactrouter.com/) |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **Date Utilities** | [date-fns](https://date-fns.org/) |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or newer recommended)
- npm or pnpm

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/chin00kz/Finora.git
   cd Finora
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
   *(Note: Finora works completely offline in guest mode even without Supabase credentials.)*

4. **Start Development Server:**
   ```bash
   npm run dev
   ```

5. **Build for Production:**
   ```bash
   npm run build
   ```

---

## 📐 Architecture & Principles

```text
┌─────────────────────────────────────────────────────────────┐
│                       LAYER 1: SURFACE                      │
│   Minimal Dashboard • Quick Add (FAB / N) • Glance Balance   │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                    LAYER 2: DEEP TOOLS                      │
│   Float Arbitrage • Recurring Engine • Savings Goals • IOUs │
│   Analytics • Category / Tag Management • CSV Importer      │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                  LOCAL-FIRST DATA ENGINE                    │
│   Dexie.js (IndexedDB) ─── SyncEngine ─── Supabase Cloud    │
│   • Instant writes          • Two-way delta   • Auth        │
│   • 100% Offline            • Offline queue   • Backup      │
└─────────────────────────────────────────────────────────────┘
```

1. **The Minimalism Rule applies everywhere**: Desktop screens do not get bloated with extra cards or widgets just because width exists.
2. **Local-First is Non-Negotiable**: User data lives on the user's device first. Cloud sync is an enhancement, not a requirement.
3. **Honest Financial Modeling**: Financial tools reflect real-world mechanics (e.g., credit card interest cost vs. yield arbitrage) with transparent math and zero deceptive gamification.

---

## 📄 License

Private personal project. Developed by [chin00kz](https://github.com/chin00kz).
