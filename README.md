# Finora

A modern personal finance and budget management web app built around one idea:

> **Extremely simple on the surface. Extremely powerful underneath.**

## Why Finora?

Most personal finance applications try to expose every feature at once — categories, charts, accounts, reports, settings, budgets, and transaction management.

The result is often an application that feels more like accounting software than something people actually want to use every day.

**Finora takes the opposite approach.**

The primary experience is intentionally minimal. The dashboard focuses on the information that matters most at a glance:

* How much money is available
* How much has been spent
* How much remains
* Whether spending is on track

More advanced financial functionality is available when needed without cluttering the core experience.

## Core Principle

**Simple by default. Powerful when needed.**

A basic transaction should be as simple as:

```text
Home → + → Amount → Category → Account → Save
```

At the same time, Finora is designed to support more complex financial situations, including:

* Multiple accounts
* Cash, bank, and card balances
* Transfers between accounts
* Flexible budget periods
* Shared and split expenses
* Money owed and receivable
* Recurring transactions
* Custom categories and tags
* Budget history
* Spending analytics
* Savings goals
* Multiple currencies
* Data import/export

Advanced functionality should remain optional rather than becoming part of every interaction.

## Design Philosophy

Finora follows a **minimal interface, feature-rich architecture** approach.

The home screen should remain clean and immediately understandable, while the underlying financial model is capable of representing real-world money movement.

For example, transferring money from cash to a bank account should be treated as a transfer rather than an expense. Similarly, paying for a shared expense should distinguish between the amount actually paid and the user's personal share.

The goal is to make complex financial situations easy to represent without making everyday usage complex.

## Features

### Dashboard

* Available balance
* Budget progress
* Spending pace
* Remaining budget
* Recent transactions
* Account overview

### Transactions

* Income and expenses
* Multiple payment accounts
* Categories
* Tags
* Notes
* Transaction history
* Advanced transaction details

### Accounts

* Cash accounts
* Bank accounts
* Debit/credit cards
* Custom accounts
* Account balances
* Transfers between accounts

### Budgets

* Daily, weekly, monthly, and custom periods
* Spending limits
* Budget progress
* Spending pace
* Budget history
* Over/under budget tracking

### Shared Expenses

* Split transactions
* Track personal shares
* Track amounts owed
* Record repayments
* Settlement tracking

### Analytics

* Spending by category
* Spending trends
* Cash vs. card usage
* Budget performance
* Income vs. expenses
* Historical comparisons

### Data & Privacy

* Local-first storage
* Offline support
* Import/export capabilities
* User-controlled data

## Status

🚧 **Actively under development**

Current development is focused on establishing the core financial engine and progressively adding higher-level features.

### v1

* Dashboard
* Accounts
* Budgets
* Transactions
* Transfers
* Shared expenses
* IOUs

### v2

* Custom account types
* Custom tags
* Budget period lifecycle
* Advanced analytics
* Additional personalization

---

## Tech Stack

Finora is built as a local-first web application using:

* **React 19**
* **TypeScript**
* **Vite**
* **Tailwind CSS v4**
* **Dexie.js** — IndexedDB persistence
* **Zustand** — lightweight UI state management

## Running Locally

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Build for production
npm run build
```

## Project Direction

Finora is being developed with a focus on **progressive complexity**:

> Start simple. Add complexity only when it provides value.

The application should remain approachable for someone who only wants to track everyday spending while being capable of growing into a complete personal financial management system.
