# pipeline

本機資料管線：行情 → Supabase、券商 → Supabase／Google Sheet。網頁本身不直接連券商或行情商，
一律讀 Supabase，所以手機、外網也能拿到同一份資料。

**資料庫是 Supabase**（schema 在 `../supabase/migrations/`）。Google Sheet 只剩券商原始資料
（庫存、成交明細、持倉快照）還在寫，其餘工作表停在切換當下，當作唯讀備份。

| 腳本 | 做什麼 | 讀 | 寫到哪 |
|---|---|---|---|
| `fetch_prices.py` | 持倉報價 | Supabase 交易、質押 | `prices.db` ＋ Supabase `quotes`、`daily_close` |
| `backfill_history.py` | 用 yfinance 回補每日收盤與匯率 | Supabase 交易 | `prices.db` ＋ Supabase `daily_close`、`daily_fx` |
| `build_history.py` | 由每日收盤重算資產／損益曲線 | Supabase 交易、分割；`prices.db` 日線 | Supabase `nav_history` |
| `sync_sinopac.py` | 永豐庫存、交易明細、交割帳戶餘額 | 永豐 API | Sheet「永豐庫存」「永豐交易紀錄」＋ Supabase `bank_accounts` 中 `auto_source = sinopac` 那一列的 TWD |
| `sync_fubon.py` | 富邦庫存、近 30 天成交、未實現損益快照、交割帳戶餘額 | 富邦 API | Sheet「富邦庫存」「富邦交易紀錄」「富邦持倉快照」＋ Supabase `bank_accounts` 中 `auto_source = fubon` 那一列的 TWD |
| `import_to_supabase.py` | 一次性把 Sheet 與 `prices.db` 搬進 Supabase（已完成，留作紀錄） | Sheet | Supabase |
| `common.py` | 共用的設定載入與 Sheet 連線 | — | — |
| `supa.py` | Supabase 精簡 client，以及帳本、交易、質押、分割的共用讀取 | — | — |
| `pricedb.py` | `prices.db` 的結構與連線 | — | — |

## 報價的 fallback chain

```
台股  富邦 fubon_neo  →  TWSE MIS  →  prices.db 最後已知價
美股  yfinance                    →  prices.db 最後已知價
```

抓價的標的清單不是寫死的，`resolve_holdings()` 會讀 Supabase 所有帳本的 `transactions`
算出淨庫存 > 0 的標的，再併入 `pledges` 裡的標的。網頁新增一筆交易，下一輪就自動跟上。
出清的標的停止更新，但 `prices.db` 與 Supabase `quotes` 的舊列會留著當最後已知價。

每筆報價都帶 `source` 與 `quote_ts`，降級時網頁看得出新鮮度。用快取價時 `source` 會是 `cache`。
`quotes` 只寫一份，所有帳本共用。

HKD / JPY 標的目前跳過（yfinance 需要交易所後綴），不會更新報價。

`prices.db` 仍然是本機快取：`quote_history`（盤中每輪的紀錄）與 `tw_symbol_market` 只存在這裡。
Supabase 寫入失敗時報價照樣寫進 `prices.db`，下一輪會再補寫 Supabase。

## 淨值歷史

曲線本身不存，只存每日收盤，每次都從交易紀錄重算 —— 補登舊交易或新增分割事件後重跑一次就自動修正。

```
daily_close (symbol, date, close)   每檔每日收盤（prices.db 與 Supabase 各一份）
daily_fx    (date, usdtwd)          每日匯率，美股部位要用當日匯率換算
```

`build_history.py` 讀 `prices.db` 的日線計算，結果寫到 Supabase `nav_history`。
寫入方式是先 upsert 全部日期，再刪掉這次沒產生的日期，所以過程中網頁不會看到空的曲線。

**單位問題（改動這塊前務必先讀）**：Yahoo 的歷史收盤會回溯調整分割。例如 00685L 在 2026-07-07
一拆 24，之前的收盤都已除以 24（實測：6/29 成交價 289.05，Yahoo 同日收盤 12.01，正好差 24 倍）。
所以 `build_history.py` 一律把股數換算成「現行單位」：某日的 1 股 = R(該日) 股現行單位，
R(D) = D 之後所有分割比例的乘積。換算後直接乘上調整後收盤，曲線在分割前後是連續的。
金額不需要調整（成本就是成本），均價則是 總成本 ÷ 現行單位股數。

`fetch_prices.py` 每輪會順手覆寫當日 `daily_close`，所以收盤後最後一輪留下的就是收盤價，
平常不必再跑 yfinance；`backfill_history.py` 用於首次建立歷史，或補 Mac 關機那幾天的缺口。

```bash
./venv/bin/python backfill_history.py                     # 從最早一筆交易補到今天
./venv/bin/python backfill_history.py --start 2026-07-15  # 只補近期缺口
./venv/bin/python build_history.py --dry-run              # 只印最後幾列，不寫 Supabase
./venv/bin/python build_history.py --csv history.csv
```

## 設定

`config.json`（不進版控，格式見 `config.example.json`）一份搞定所有腳本：

```json
{
  "profiles": [
    { "name": "rick", "spreadsheet_id": "...", "credentials_path": "credentials/service-account.json" },
    { "name": "LR",   "spreadsheet_id": "...", "credentials_path": "credentials/service-account.json" }
  ],
  "fubon": { "id": "...", "api_key": "...", "cert_path": "credentials/憑證.p12", "cert_password": "..." },
  "sinopac": { "api_key": "...", "secret_key": "..." },
  "supabase": { "url": "https://<ref>.supabase.co", "service_role_key": "...", "owner_email": "..." }
}
```

- `supabase.service_role_key` 會略過 RLS，只能放本機，絕不能進前端
- `profiles` 現在只給券商同步連 Sheet 用；第一本的 `name` 要跟 Supabase 主帳本的 `books.name` 一致
  （永豐交割餘額會寫進那一本）

路徑可寫相對於 `pipeline/` 的位置。憑證放 `credentials/`，`.gitignore` 已排除。

## 多帳本

帳本清單以 Supabase `books` 為準。報價與日線是共用的 —— `quotes`、`daily_close`、`daily_fx`
都以「代號 + 日期」為鍵，跟持有人無關，所以：

```
各帳本持倉 → 取聯集 → 抓一次價 → 共用 quotes / daily_close
                                    ↘ 各自重算自己的 nav_history
```

兩本重疊的標的（例如都持有 2330）只會抓一次，多一本帳本幾乎不增加抓價成本。
`--profile` 指的是 Supabase 的帳本名稱：

```bash
./venv/bin/python fetch_prices.py                    # 全部帳本
./venv/bin/python fetch_prices.py --profile rick     # 只取這本的持倉
./venv/bin/python build_history.py --profile LR
```

**券商同步只對主帳本（`profiles` 第一本）有意義**，因為用的是 config 裡那組 API Key。
其他帳本請在網頁手動輸入交易紀錄，不要把別人的券商憑證放進來。

新增一本：在 Supabase `books` 新增一列（`owner_id` 填自己的使用者 id），在網頁輸入交易後，
跑 `backfill_history.py` 補歷史日線，再跑 `build_history.py`。

## 從 Sheet 匯入（一次性，已完成）

`import_to_supabase.py` 當初把每個 profile 匯成一本 Supabase 帳本（`books.name` = profile 名稱），
包含交易、質押、銀行、加密貨幣、淨值歷史，以及共用的 beta、分割事件、報價、日線、匯率。
讀 Sheet 時用原始值而不是顯示值，所以價格不會被四捨五入（例如 52.725 不會變成 52.73）。

**現在 Supabase 是唯一的資料來源，不要再跑 `--replace`**：它會清掉帳本裡所有交易，
包含之後在網頁新增的紀錄。

## 環境

所有腳本共用 `pipeline/venv`（Python 3.14）：

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/pip install vendor/fubon_neo-*.whl   # 官方未上 PyPI
```

> 富邦 API Key 綁 IP，換出口 IP 會登入失敗；Key 也會過期，失效要到富邦開發者平台重申請。
> 登入失敗不會中斷，報價會自動掉到 MIS。

## 執行

```bash
cd pipeline
./venv/bin/python fetch_prices.py --dry-run           # 只印結果，不寫任何東西
./venv/bin/python fetch_prices.py                     # 寫 prices.db + Supabase
./venv/bin/python fetch_prices.py --no-remote         # 只寫 prices.db
./venv/bin/python fetch_prices.py --symbols 2330,QQQ  # 指定標的，跳過持倉計算
./venv/bin/python sync_fubon.py
./venv/bin/python sync_sinopac.py
```

## 排程（launchd）

| Label | 內容 | 時機 |
|---|---|---|
| `com.portfolio.prices` | `fetch_prices.py --market-hours-only` | 每 180 秒，非交易時段會直接結束 |
| `com.portfolio.sync` | `scripts/sync_all.sh`（永豐 → 富邦 → 報價 → 回補近 30 天 → 重算淨值） | 每日 14:00 |

```bash
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.portfolio.prices.plist
launchctl kickstart -k gui/501/com.portfolio.prices   # 手動觸發一次
launchctl bootout gui/501/com.portfolio.prices        # 停用
```

日誌：報價在 `pipeline/log/`，每日同步在 `log/sync_<date>.log`。
