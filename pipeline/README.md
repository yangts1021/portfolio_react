# pipeline

本機資料管線：券商 → Google Sheet、行情 → Google Sheet。網頁本身不直接連券商或行情商，
一律透過 GAS 讀 Sheet，所以手機、外網也能拿到同一份資料。

| 腳本 | 做什麼 | 寫到哪 |
|---|---|---|
| `sync_fubon.py` | 富邦庫存、近 30 天成交、未實現損益快照 | 「富邦庫存」「富邦交易紀錄」「富邦持倉快照」 |
| `sync_sinopac.py` | 永豐庫存、交易明細、交割帳戶餘額 | 「永豐庫存」「永豐交易紀錄」「銀行系統餘額」 |
| `fetch_prices.py` | 持倉報價（取代 GOOGLEFINANCE） | 「即時報價」＋ `prices.db` |
| `backfill_history.py` | 用 yfinance 回補每日收盤與匯率 | `prices.db` |
| `build_history.py` | 由每日收盤重算資產／損益曲線 | 「淨值歷史」 |
| `common.py` | 共用的設定載入與 Sheet 連線 | — |
| `pricedb.py` | `prices.db` 的結構與連線 | — |

## 報價的 fallback chain

```
台股  富邦 fubon_neo  →  TWSE MIS  →  prices.db 最後已知價
美股  yfinance                    →  prices.db 最後已知價
```

抓價的標的清單不是寫死的，`resolve_holdings()` 會讀「股票交易紀錄」算出淨庫存 > 0 的標的，
再併入「質押借貸資料」裡的標的。新增一筆交易，下一輪就自動跟上。出清的標的停止更新，
但 `prices.db` 與 Sheet 的舊列會留著當最後已知價。

每筆報價都帶 `來源` 與 `報價時間`，降級時網頁看得出新鮮度，
不會像 GOOGLEFINANCE 失效時直接噴 `#N/A` 把整張表算爆。

HKD / JPY 標的目前跳過（yfinance 需要交易所後綴），維持原本「即時價格與beta」的價格。

## 淨值歷史

曲線本身不存，只存每日收盤，每次都從交易紀錄重算 —— 補登舊交易或新增分割事件後重跑一次就自動修正。

```
daily_close (symbol, date, close)   每檔每日收盤
daily_fx    (date, usdtwd)          每日匯率，美股部位要用當日匯率換算
```

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
./venv/bin/python build_history.py --dry-run              # 只印最後幾列，不寫 Sheet
./venv/bin/python build_history.py --csv history.csv
```

## 設定

`config.json`（不進版控，格式見 `config.example.json`）一份搞定所有腳本：

```json
{
  "profiles": [
    { "name": "rick",  "spreadsheet_id": "...", "credentials_path": "credentials/service-account.json" },
    { "name": "另一本", "spreadsheet_id": "...", "credentials_path": "credentials/service-account.json" }
  ],
  "fubon": { "id": "...", "api_key": "...", "cert_path": "credentials/憑證.p12", "cert_password": "..." },
  "sinopac": { "api_key": "...", "secret_key": "..." }
}
```

路徑可寫相對於 `pipeline/` 的位置。憑證放 `credentials/`，`.gitignore` 已排除。
舊版單一 `google_sheet` 的寫法仍然可用，會被當成一本名為 `default` 的帳本。

## 多帳本

`profiles` 每一筆就是一份 Google Sheet。報價與日線是共用的 —— `quote_latest`、
`daily_close`、`daily_fx` 都以「代號 + 日期」為鍵，跟持有人無關，所以：

```
各帳本持倉 → 取聯集 → 抓一次價 → 分別寫回各自的「即時報價」
                              ↘ 共用 daily_close → 各自重算自己的「淨值歷史」
```

兩本重疊的標的（例如都持有 2330）只會抓一次，多一本帳本幾乎不增加抓價成本。

```bash
./venv/bin/python fetch_prices.py                    # 全部帳本
./venv/bin/python fetch_prices.py --profile rick     # 只跑一本
./venv/bin/python build_history.py --profile 另一本
```

**券商同步只對主帳本（`profiles` 第一本）有意義**，因為用的是 config 裡那組 API Key。
其他帳本請手動輸入交易紀錄，不要把別人的券商憑證放進來。

新增一本的步驟：

1. 複製一份試算表，保留 `股票交易紀錄`、`分割事件`、`質押借貸資料` 的欄位格式
   （`即時報價` 與 `淨值歷史` 會自動建立）
2. 把 service account 的信箱加為該試算表的**編輯者**
3. 該試算表綁一份 Apps Script（貼同一份 `gas/Code.gs`）並部署，取得專屬的 `/exec` 網址
4. `config.json` 的 `profiles` 加一筆
5. 跑 `backfill_history.py` 補歷史日線，再跑 `build_history.py`
6. 網頁的資料同步視窗貼上那組 GAS 網址即可切換帳本

## 環境

三支腳本共用 `pipeline/venv`（Python 3.14）：

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
./venv/bin/python fetch_prices.py                     # 寫 prices.db + Sheet
./venv/bin/python fetch_prices.py --symbols 2330,QQQ  # 指定標的，跳過持倉計算
./venv/bin/python sync_fubon.py
./venv/bin/python sync_sinopac.py
```

## 排程（launchd）

| Label | 內容 | 時機 |
|---|---|---|
| `com.portfolio.prices` | `fetch_prices.py --market-hours-only` | 每 180 秒，非交易時段會直接結束 |
| `com.portfolio.sync` | `scripts/sync_all.sh`（永豐 → 富邦 → 報價） | 每日 14:00 |

```bash
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.portfolio.prices.plist
launchctl kickstart -k gui/501/com.portfolio.prices   # 手動觸發一次
launchctl bootout gui/501/com.portfolio.prices        # 停用
```

日誌：報價在 `pipeline/log/`，每日同步在 `log/sync_<date>.log`。
