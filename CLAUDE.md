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
- `utils/marketData.ts` — `fetchPrices()` pulls quotes for held symbols (TW + US) through GAS `?type=twPrices`, returns `{prices, source, updatedAt}` where source is `live` / `twse` / `sheet`. Also market-hours helpers used by the 60s polling effect in `App.tsx`.
- `types.ts` — All shared TypeScript interfaces (`Transaction`, `BankAccount`, `PledgeRecord`, `PortfolioItem`, `SplitEvent`, currency/action union types)
- `constants.ts` — localStorage key names

**Tabs:**

- `TransactionsTab` — Add/view buy/sell records, sorted display with "show all" toggle
- `OverviewTab` — Portfolio analysis: P&L table, pie chart (Recharts), cash summary, exchange rates, beta-weighted allocation
- `BankTab` — Multi-currency bank account management with inline editing
- `PledgeTab` — Stock pledge/collateral loan tracking with auto-calculated repayment dates

## Data Pipeline (`pipeline/`)

Local Python scripts that feed the Google Sheet. **The web app never talks to brokers or quote vendors directly** — everything reaches the browser through GAS reading the Sheet, which is why phones and off-network clients see the same data.

| Script | Does | Writes to |
| --- | --- | --- |
| `sync_fubon.py` | Fubon positions, last-30-day fills, unrealized P&L snapshot | 「富邦庫存」「富邦交易紀錄」「富邦持倉快照」 |
| `sync_sinopac.py` | Sinopac positions, trade details, settlement balance | 「永豐庫存」「永豐交易紀錄」「銀行系統餘額」 |
| `fetch_prices.py` | Holding quotes, replaces `GOOGLEFINANCE()` | 「即時報價」 + `prices.db` |
| `common.py` | Shared config loading, Sheet auth, worksheet access | — |

**Price fallback chain** — every symbol always resolves to a number:

```
TW  fubon_neo → TWSE MIS → prices.db last-known price
US  yfinance            → prices.db last-known price
```

Quote rows carry `來源` and `報價時間` so the UI can show freshness instead of rendering a stale value silently. The symbol list is **not** hardcoded: `resolve_holdings()` derives it from the 「股票交易紀錄」 sheet (net qty > 0) plus 「質押借貸資料」, so a new transaction is picked up on the next run. Sold-out symbols stop updating but their rows stay as last-known price. HKD/JPY holdings are skipped (yfinance needs exchange suffixes) and keep their 「即時價格與beta」 price.

**Read path:** GAS `?type=twPrices` tries 「即時報價」 first (`twSource: "live"`), falls back to proxying TWSE MIS (`"mis"`), then to GOOGLEFINANCE values in 「即時價格與beta」 (`"sheet"`). MIS is unreliable from Google datacenter IPs — that intermittent block is why the local fetcher exists.

**Environment:** all three scripts share one `pipeline/venv` (Python 3.14), one `config.json` (`google_sheet` / `fubon` / `sinopac` sections, paths may be relative to `pipeline/`), and `credentials/` for the Fubon `.p12` and the service account. `fubon_neo` is not on PyPI — install from `vendor/*.whl`.

**Scheduling (launchd):** `com.portfolio.prices` runs `fetch_prices.py --market-hours-only` every 180s; `com.portfolio.sync` runs `scripts/sync_all.sh` daily at 14:00. Logs in `pipeline/log/` and `log/sync_<date>.log`.

**Gotchas:** Fubon API keys are IP-bound and expire — login failure is non-fatal (quotes drop to MIS) but shows up in `pipeline/log/fetch_prices.err.log`. shioaji ≥1.7 removed `contracts_timeout` from `login()`.

See `pipeline/README.md` for commands and setup detail.

## Code Style

- Prettier: single quotes, trailing commas, 100 char line width, 2-space indent
- ESLint extends: eslint:recommended, @typescript-eslint/recommended, react-hooks/recommended, prettier
- Tailwind CSS via CDN (class-based dark mode with `dark:` prefix)
- Path alias: `@/` maps to project root

## Build Configuration

- Vite base path: `/portfolio_react/` in production, `/` in dev
- Entry point: `/index.tsx` (not in `src/`)
- All source files live at project root level (App.tsx, components/, utils/), not inside a `src/` directory
