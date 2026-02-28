# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm run dev` — Start dev server (port 3000)
- `npm run build` — Production build via Vite
- `npm run lint` — Run ESLint
- `npm run format` — Auto-format with Prettier
- `npm run deploy` — Deploy to GitHub Pages

CI runs `npm run lint` then `npm run build` on push to main/master.

## Architecture

React 18 + TypeScript SPA for investment portfolio tracking. UI is in Traditional Chinese (zh-TW).

**State management:** All application state lives in `App.tsx` using React hooks. No external state library. Data persists to `localStorage` (storage keys defined in `constants.ts`). Components receive data and callbacks via props — no Context API.

**Data flow:**

- `App.tsx` → owns all state (transactions, bankData, pledgeData, currentPrices, exchangeRates, etc.)
- Tab components (`components/Tabs/`) receive state slices and handler callbacks as props
- Cloud sync via Google Apps Script POST/GET (URL stored in localStorage, configured in DataSyncModal)

**Key modules:**

- `utils/calculations.ts` — `calculatePortfolio()` is the core function: processes transactions chronologically, computes average cost, inventory, realized/unrealized P&L, converts to TWD via exchange rates. Also has `getCategoryFromBeta()` for risk categorization and `formatMoney()` for number display.
- `types.ts` — All shared TypeScript interfaces (`Transaction`, `BankAccount`, `PledgeRecord`, `PortfolioItem`, currency/action union types)
- `constants.ts` — localStorage key names

**Tabs:**

- `TransactionsTab` — Add/view buy/sell records, sorted display with "show all" toggle
- `OverviewTab` — Portfolio analysis: P&L table, pie chart (Recharts), cash summary, exchange rates, beta-weighted allocation
- `BankTab` — Multi-currency bank account management with inline editing
- `PledgeTab` — Stock pledge/collateral loan tracking with auto-calculated repayment dates

## Code Style

- Prettier: single quotes, trailing commas, 100 char line width, 2-space indent
- ESLint extends: eslint:recommended, @typescript-eslint/recommended, react-hooks/recommended, prettier
- Tailwind CSS via CDN (class-based dark mode with `dark:` prefix)
- Path alias: `@/` maps to project root

## Build Configuration

- Vite base path: `/portfolio_react/` in production, `/` in dev
- Entry point: `/index.tsx` (not in `src/`)
- All source files live at project root level (App.tsx, components/, utils/), not inside a `src/` directory
