# Portfolio React

Personal investment portfolio tracker — transactions, P&L, multi-currency bank balances, stock pledge loans, and crypto positions. React 18 + TypeScript SPA with a Traditional Chinese (zh-TW) UI, deployed to GitHub Pages.

Google Sheets is the system of record. The browser reads and writes it through a Google Apps Script endpoint, while local Python scripts (`pipeline/`) push broker data and live quotes into the same Sheet.

```
brokers ──┐
          ├─ pipeline/ (local, launchd) ──> Google Sheet ──> GAS ──> web app
quotes ───┘                                                          (localStorage cache)
```

## Getting Started

Requires Node.js 20+ and npm.

```bash
npm install
npm run dev      # http://localhost:3000
```

The app runs standalone with `localStorage` only. To sync with the cloud, open the data-sync modal and paste your Apps Script deployment URL (stored in `localStorage`, never committed).

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build via Vite |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint over `.ts` / `.tsx` |
| `npm run format` | Prettier write |
| `npm run deploy` | Publish `dist/` to the `gh-pages` branch |

`npm run deploy` does **not** build — run `npm run build` first.

## Layout

Source files live at the project root, not under `src/`.

| Path | Contents |
| --- | --- |
| `App.tsx` | All application state (hooks only, no state library) |
| `components/Tabs/` | Transactions, Overview, Bank, Pledge, Crypto tabs |
| `components/UI/` | Modals and shared UI |
| `utils/` | `calculations.ts` (portfolio math), `marketData.ts` (quote fetching) |
| `types.ts`, `constants.ts` | Shared interfaces, localStorage keys |
| `gas/Code.gs` | Apps Script backend — paste into the editor and redeploy after changes |
| `pipeline/` | Local Python data pipeline (see `pipeline/README.md`) |
| `scripts/sync_all.sh` | Daily broker sync driver, run by launchd |

## Data pipeline

`pipeline/` holds three Python scripts sharing one config and one venv:

- `sync_fubon.py` / `sync_sinopac.py` — broker positions, trades, and balances into the Sheet
- `fetch_prices.py` — replaces `GOOGLEFINANCE()`; TW quotes via fubon_neo (falling back to TWSE MIS), US via yfinance, with `prices.db` holding last-known prices so the page never renders `#N/A`

The symbol list is derived from the Sheet's transaction and pledge records, so new positions are picked up automatically. launchd runs quotes every 180s during market hours and the broker sync daily at 14:00. Setup and commands: `pipeline/README.md`.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which lints, builds, and publishes `dist/` to GitHub Pages. `npm run deploy` does the same manually.

Vite's base path is `/portfolio_react/` in production and `/` in dev.
