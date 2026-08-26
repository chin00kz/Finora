# Finora Budget Tracker

A personal budget and expense tracker built around one idea: **budget apps are too complicated, so nobody actually uses them.**

## Why this exists

Most budgeting apps try to be complete financial software — categories, reports, charts, settings — and end up feeling like a chore to open. So people stop logging expenses within a week, and the app becomes useless the moment it's abandoned.

This app flips that. It started from a real, specific problem: heading to university for a 4-day week with a fixed amount of cash, splitting bills with friends, moving money between cash and a card, and never actually knowing — in the moment — how much was left or whether spending was on pace.

The goal isn't a university expense tracker specifically. It's a **general-purpose budget tracker that never feels like accounting software**, built so that:

- The home screen answers exactly one question at a glance: *how much do I have, and am I on track?* Big numbers, almost no text, no menus.
- Everything else a real financial life needs — multiple accounts, cash vs. card, transfers, shared/group expenses, IOUs, tags, budget history — is fully supported, but lives one tap away instead of cluttering the first screen.

## Core principle

**Extremely simple on the surface. Extremely powerful underneath.**

A normal day should only ever require: `Home → + → Amount → Category → Account → Save`. Everything else — splitting a bill, tagging a coffee run, starting a new budget period, tracking who owes who — is there when it's needed and invisible when it's not.

## Status

Actively being built out feature by feature (v1: dashboard, accounts, budgets, transactions, transfers, shared expenses, IOUs. v2: multiple custom accounts, custom tags, budget period lifecycle).

---

## Tech Stack & Development

This project is a local-first web app built with:
- **React 19** + **TypeScript** + **Vite**
- **Tailwind CSS v4** for styling
- **Dexie.js** (IndexedDB) for local-first, offline data storage
- **Zustand** for lightweight UI state management

### Running Locally

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev

# Build for production
npm run build
```
