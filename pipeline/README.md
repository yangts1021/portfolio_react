# pipeline

本機資料管線：券商 → Google Sheet、行情 → Google Sheet。網頁本身不直接連券商或行情商，
一律透過 GAS 讀 Sheet，所以手機、外網也能拿到同一份資料。

| 腳本 | 做什麼 | 寫到哪 |
|---|---|---|
| `sync_fubon.py` | 富邦庫存、近 30 天成交、未實現損益快照 | 「富邦庫存」「富邦交易紀錄」「富邦持倉快照」 |
| `sync_sinopac.py` | 永豐庫存、交易明細、交割帳戶餘額 | 「永豐庫存」「永豐交易紀錄」「銀行系統餘額」 |
| `fetch_prices.py` | 持倉報價（取代 GOOGLEFINANCE） | 「即時報價」＋ `prices.db` |
| `common.py` | 三支共用的設定載入與 Sheet 連線 | — |

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

## 設定

`config.json`（不進版控，格式見 `config.example.json`）一份搞定三支腳本：

```json
{
  "google_sheet": { "spreadsheet_id": "...", "credentials_path": "credentials/service-account.json" },
  "fubon": { "id": "...", "api_key": "...", "cert_path": "credentials/憑證.p12", "cert_password": "..." },
  "sinopac": { "api_key": "...", "secret_key": "..." }
}
```

路徑可寫相對於 `pipeline/` 的位置。憑證放 `credentials/`，`.gitignore` 已排除。

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
