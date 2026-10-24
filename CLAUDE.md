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

**Data store:** Supabase (Postgres + RLS) is the source of truth; schema in `supabase/migrations/`. The browser signs in with email/password (sign-ups are disabled; the account is created in the Supabase dashboard) and talks to Supabase directly with the publishable key in `utils/supabase.ts` — that key is public by design, access is enforced by RLS. The service_role key lives only in `pipeline/config.json`. Google Sheet / GAS (`gas/`) are no longer read by the app.

**Books:** each book (`books` table) is one portfolio, formerly one Google Sheet / pipeline profile. Book-scoped tables (`transactions`, `pledges`, `bank_accounts`, `nav_history`, `crypto_positions`) carry `book_id`; RLS lets only the owner read/write them via `owns_book()`. Shared tables (`symbols` with beta, `split_events`, `quotes`, `daily_close`, `daily_fx`) are the same for every book. The navbar dropdown switches books; the choice is remembered in localStorage.

**State management:** All application state lives in `App.tsx` using React hooks. No external state library, no Context API. `App` is an auth gate; `PortfolioApp` holds the signed-in state. Book-scoped data is kept in one `bookState` object tagged with its `bookId` so a cache write can never land under another book. localStorage is only a first-paint cache (per-book key `my_book_cache:<id>`), cleared on sign-out.

**Data flow:**

- `utils/db.ts` → every Supabase read/write (`loadBook`, `loadShared`, `loadQuotes`, `addTransaction`, `deleteTransaction`, `addSplit`, `saveBank`, `saveBeta`, …). Reads page past the 1000-row cap; deletes ask for the deleted row back because RLS turns a forbidden delete into a silent no-op.
- `App.tsx` → owns state and the mutation handlers. Mutations write to Supabase first and update local state only on success (bank/beta edits are optimistic with rollback).
- Tab components (`components/Tabs/`) receive state slices and async handler callbacks as props.

**Key modules:**

- `utils/calculations.ts` — `calculatePortfolio()` is the core function: processes transactions chronologically, computes average cost, inventory, realized/unrealized P&L, converts to TWD via exchange rates. Also has `getCategoryFromBeta()` for risk categorization and `formatMoney()` for number display.
- `utils/marketData.ts` — quote source labels and market-hours helpers used by the 60s polling effect in `App.tsx` (quotes themselves come from Supabase `quotes`, written by the pipeline).
- `types.ts` — All shared TypeScript interfaces (`Book`, `Transaction`, `BankAccount`, `PledgeRecord`, `PortfolioItem`, `SplitEvent`, currency/action union types)
- `constants.ts` — localStorage key names (plus legacy Sheet-era keys removed on startup)

**Tabs:**

- `TransactionsTab` — Add/view buy/sell records, sorted display with "show all" toggle
- `OverviewTab` — Portfolio analysis: P&L table, pie chart (Recharts), cash summary, exchange rates, beta-weighted allocation
- `BankTab` — Multi-currency bank account management with inline editing
- `PledgeTab` — Stock pledge/collateral loan tracking with auto-calculated repayment dates; collateral value is computed from live prices, not stored
- Crypto (`CryptoTab` / `PionexTab` / `BitfinexTab`) is unwired until Pionex/Bitfinex data moves from GAS into Supabase `crypto_positions`

## Data Pipeline (`pipeline/`)

Local Python scripts that feed the Google Sheet. **The web app never talks to brokers or quote vendors directly** — everything reaches the browser through GAS reading the Sheet, which is why phones and off-network clients see the same data.

| Script | Does | Writes to |
| --- | --- | --- |
| `sync_fubon.py` | Fubon positions, last-30-day fills, unrealized P&L snapshot; settlement balance via `bank_remain` | 「富邦庫存」「富邦交易紀錄」「富邦持倉快照」 + Supabase `bank_accounts` row with `auto_source = 'fubon'` (TWD only) |
| `sync_sinopac.py` | Sinopac positions, trade details, settlement balance | 「永豐庫存」「永豐交易紀錄」 + Supabase `bank_accounts` row with `auto_source = 'sinopac'` (TWD only) |
| `fetch_prices.py` | Holding quotes, replaces `GOOGLEFINANCE()` | 「即時報價」 + `prices.db` |
| `backfill_history.py` | Backfills daily closes and FX via yfinance | `prices.db` |
| `build_history.py` | Recomputes the asset/P&L curve from daily closes | 「淨值歷史」 |
| `import_to_supabase.py` | One-time migration of Sheets + `prices.db` into Supabase (`--dry-run` / `--replace`) | Supabase |
| `common.py` | Shared config loading, Sheet auth, worksheet access | — |
| `supa.py` | Minimal Supabase client (PostgREST + Auth admin) over `requests` | — |
| `pricedb.py` | `prices.db` schema and connection | — |

**Price fallback chain** — every symbol always resolves to a number:

```
TW  fubon_neo → TWSE MIS → prices.db last-known price
US  yfinance            → prices.db last-known price
```

Quote rows carry `來源` and `報價時間` so the UI can show freshness instead of rendering a stale value silently. The symbol list is **not** hardcoded: `resolve_holdings()` derives it from the 「股票交易紀錄」 sheet (net qty > 0) plus 「質押借貸資料」, so a new transaction is picked up on the next run. Sold-out symbols stop updating but their rows stay as last-known price. HKD/JPY holdings are skipped (yfinance needs exchange suffixes) and keep their 「即時價格與beta」 price.

**History curve:** the curve itself is never stored — only `daily_close` and `daily_fx` are, and `build_history.py` recomputes every day's value from the transaction log, so backfilling an old trade or adding a split event fixes history instead of leaving it wrong forever. **Unit gotcha:** Yahoo's historical closes are retroactively split-adjusted, so `build_history.py` converts every quantity into *current* share units (a share held on date D equals R(D) current shares, where R(D) is the product of ratios of splits after D) before multiplying by the close. Read `pipeline/README.md` before touching that math.

**Read path:** GAS `?type=twPrices` tries 「即時報價」 first (`twSource: "live"`), falls back to proxying TWSE MIS (`"mis"`), then to GOOGLEFINANCE values in 「即時價格與beta」 (`"sheet"`). MIS is unreliable from Google datacenter IPs — that intermittent block is why the local fetcher exists.

**Multi-book:** `config.json` holds a `profiles` list, one entry per Google Sheet (legacy single `google_sheet` still works as a `default` profile). Quotes and daily closes are keyed by symbol/date and therefore shared across books: holdings are unioned, fetched once, then written back to each book's own 「即時報價」/「淨值歷史」. `--profile <name>` limits a run to one book. Broker syncs only make sense for the first profile since they use the configured API keys.

**Environment:** all scripts share one `pipeline/venv` (Python 3.14), one `config.json` (`profiles` / `fubon` / `sinopac` sections, paths may be relative to `pipeline/`), and `credentials/` for the Fubon `.p12` and the service account. `fubon_neo` is not on PyPI — install from `vendor/*.whl`.

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
