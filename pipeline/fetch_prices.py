#!/usr/bin/env python3
"""
持倉報價抓取器，取代 Google Sheet 裡的 GOOGLEFINANCE()。

資料流：
    Sheet「股票交易紀錄」+「質押借貸資料」 -> 算出目前需要報價的標的
        -> TW : 富邦 fubon_neo -> TWSE MIS -> prices.db 最後已知價
        -> US : yfinance               -> prices.db 最後已知價
        -> 寫回 prices.db 與 Sheet「即時報價」
    網頁再透過 GAS 讀「即時報價」。

每筆報價都帶 source 與 quote_ts，降級時網頁看得出新鮮度，
不會像 GOOGLEFINANCE 失效時直接噴 #N/A 把整張表算爆。

用法：
    python fetch_prices.py                     # 抓價 -> 寫 DB + Sheet
    python fetch_prices.py --dry-run           # 只印結果，什麼都不寫
    python fetch_prices.py --no-sheet          # 只寫 prices.db，不碰 Sheet
    python fetch_prices.py --symbols 2330,QQQ  # 指定標的，跳過 Sheet 的持倉計算
    python fetch_prices.py --market-hours-only # 台美股都收盤就直接結束（給排程用）
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests

import pricedb
from common import TPE, get_or_create_worksheet, load_config, open_sheet, profiles, resolve_path

BASE = Path(__file__).resolve().parent

MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp'
MIS_INDEX = 'https://mis.twse.com.tw/stock/index.jsp'
MIS_CHUNK = 40  # 單次請求的 ex_ch 數量；查詢字串太長 MIS 會拒絕

TX_SHEET = '股票交易紀錄'
PLEDGE_SHEET = '質押借貸資料'
QUOTE_SHEET = '即時報價'
QUOTE_HEADER = ['代號', '名稱', '價格', '昨收', '幣別', '來源', '報價時間', '更新時間']

# yfinance 用美股代號；其他幣別的標的暫不支援（需要交易所後綴）
US_CURRENCIES = {'USD'}
TW_CURRENCIES = {'TWD'}


# --------------------------------------------------------------------------- #
# model
# --------------------------------------------------------------------------- #

@dataclass
class Quote:
    symbol: str
    market: str          # "tw" | "us"
    name: str
    price: float
    prev_close: float | None
    source: str          # "fubon" | "twse_mis" | "yfinance" | "cache"
    quote_ts: str        # ISO8601，交易所產生這個價格的時間
    stale: bool          # True 代表取自快取

    @property
    def change_pct(self) -> float | None:
        if self.prev_close in (None, 0):
            return None
        return round((self.price - self.prev_close) / self.prev_close * 100, 2)


# --------------------------------------------------------------------------- #
# 交易時段
# --------------------------------------------------------------------------- #

def tw_market_open() -> bool:
    """台股：平日 08:55–14:00（含試撮與收盤後緩衝）"""
    now = datetime.now(TPE)
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 8 * 60 + 55 <= minutes <= 14 * 60


def us_market_open() -> bool:
    """美股常規盤換算台北時間：夏令 21:30–04:00、冬令 22:30–05:00，取聯集"""
    now = datetime.now(TPE)
    minutes = now.hour * 60 + now.minute
    if now.weekday() == 6:  # 台北時間週日全天休市
        return False
    if now.weekday() == 5 and minutes > 5 * 60:  # 週六清晨收完就休
        return False
    return minutes >= 21 * 60 + 30 or minutes <= 5 * 60


# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #

def save_quotes(conn: sqlite3.Connection, quotes: list[Quote]) -> None:
    now = datetime.now(TPE).isoformat(timespec='seconds')
    fresh = [q for q in quotes if not q.stale]
    conn.executemany(
        """INSERT INTO quote_latest
               (symbol, market, name, price, prev_close, source, quote_ts, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(symbol) DO UPDATE SET
               market=excluded.market, name=excluded.name, price=excluded.price,
               prev_close=excluded.prev_close, source=excluded.source,
               quote_ts=excluded.quote_ts, fetched_at=excluded.fetched_at""",
        [(q.symbol, q.market, q.name, q.price, q.prev_close, q.source, q.quote_ts, now)
         for q in fresh],
    )
    conn.executemany(
        """INSERT OR IGNORE INTO quote_history
               (symbol, price, prev_close, source, quote_ts)
           VALUES (?, ?, ?, ?, ?)""",
        [(q.symbol, q.price, q.prev_close, q.source, q.quote_ts) for q in fresh],
    )
    conn.commit()

    # 順手記當日收盤：盤中每輪覆寫，收盤後最後一輪留下來的就是收盤價
    pricedb.upsert_daily_close(
        conn, [(q.symbol, q.quote_ts[:10], q.price, q.source) for q in fresh]
    )


def load_cached(conn: sqlite3.Connection, symbol: str) -> Quote | None:
    row = conn.execute(
        """SELECT symbol, market, name, price, prev_close, source, quote_ts
             FROM quote_latest WHERE symbol = ?""",
        (symbol,),
    ).fetchone()
    if not row:
        return None
    return Quote(
        symbol=row[0], market=row[1], name=row[2] or row[0], price=row[3],
        prev_close=row[4], source='cache', quote_ts=row[6], stale=True,
    )


# --------------------------------------------------------------------------- #
# 持倉：直接從 Sheet 算，不另外維護持倉檔
# --------------------------------------------------------------------------- #

def _to_float(val) -> float:
    try:
        return float(str(val).replace(',', '').strip())
    except (TypeError, ValueError):
        return 0.0


def looks_tw(symbol: str) -> bool:
    """台股代號：4~6 碼數字，可帶一個字尾字母（00670L、00865B）"""
    s = symbol.upper()
    body = s[:-1] if s and s[-1].isalpha() else s
    return body.isdigit() and 4 <= len(body) <= 6


def resolve_holdings(sh) -> dict[str, str]:
    """回傳 {代號: 幣別}，內容為淨庫存 > 0 的標的加上質押中的標的。

    出清的標的不再更新，但 prices.db 與 Sheet 既有的列會留著當最後已知價。
    """
    holdings: dict[str, float] = {}
    currency: dict[str, str] = {}

    rows = sh.worksheet(TX_SHEET).get_all_values()
    # 欄位：日期(0) 券商(1) 代號(2) 買賣(3) 股數(4) 價格(5) 幣別(6)
    for row in rows[1:]:
        if len(row) < 5:
            continue
        sym = str(row[2]).strip().upper()
        if not sym:
            continue
        action = str(row[3]).strip().upper()
        qty = _to_float(row[4])
        signed = -qty if action in ('賣', 'SELL', 'S') else qty
        holdings[sym] = holdings.get(sym, 0.0) + signed
        cur = str(row[6]).strip().upper() if len(row) > 6 else ''
        if cur:
            currency[sym] = cur

    held = {s: currency.get(s, 'TWD') for s, qty in holdings.items() if qty > 1e-6}

    try:
        pledge_rows = sh.worksheet(PLEDGE_SHEET).get_all_values()
    except Exception:  # noqa: BLE001  沒有這張表就跳過
        pledge_rows = []
    for row in pledge_rows[1:]:
        if len(row) < 2:
            continue
        sym = str(row[1]).strip().upper()
        if sym:
            held.setdefault(sym, 'TWD')

    return held


def split_by_market(held: dict[str, str]) -> tuple[list[str], list[str]]:
    tw, us, skipped = [], [], []
    for sym, cur in sorted(held.items()):
        if cur in TW_CURRENCIES:
            tw.append(sym)
        elif cur in US_CURRENCIES:
            us.append(sym)
        else:
            skipped.append(f'{sym}({cur})')
    if skipped:
        print(f'[skip] 尚未支援的幣別，維持原本的 Sheet 價格：{", ".join(skipped)}',
              file=sys.stderr)
    return tw, us


# --------------------------------------------------------------------------- #
# TW 主力來源：富邦 fubon_neo
# --------------------------------------------------------------------------- #

def _epoch_to_iso(raw) -> str:
    """富邦的時間戳可能是秒／毫秒／微秒，一律轉成台北時間 ISO8601"""
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return datetime.now(TPE).isoformat(timespec='seconds')
    for divisor in (1e6, 1e3, 1):  # 微秒 -> 毫秒 -> 秒
        seconds = val / divisor
        if 1e9 < seconds < 4e9:  # 落在 2001–2096 才視為合理
            return datetime.fromtimestamp(seconds, TPE).isoformat(timespec='seconds')
    return datetime.now(TPE).isoformat(timespec='seconds')


def _fubon_price(quote: dict) -> float | None:
    """盤中最後成交價，未成交時退回試撮／昨收"""
    for key in ('closePrice', 'lastPrice', 'previousClose'):
        price = quote.get(key)
        if isinstance(price, (int, float)) and price > 0:
            return float(price)
    price = (quote.get('lastTrade') or {}).get('price')
    if isinstance(price, (int, float)) and price > 0:
        return float(price)
    return None


def fetch_tw_fubon(config: dict, symbols: list[str]) -> dict[str, Quote]:
    """富邦行情。憑證或 API Key 失效時回傳 {}，交給 MIS 接手。"""
    if not symbols or 'fubon' not in config:
        return {}
    try:
        from fubon_neo.sdk import FubonSDK, Mode
    except ImportError:
        print('[tw] 未安裝 fubon_neo，改用 MIS', file=sys.stderr)
        return {}

    cfg = config['fubon']
    sdk = None
    try:
        sdk = FubonSDK()
        accounts = sdk.apikey_login(
            cfg['id'],
            cfg['api_key'],
            str(resolve_path(cfg['cert_path'])),
            cfg.get('cert_password', ''),
        )
        if not accounts.is_success:
            print(f'[tw] 富邦登入失敗，改用 MIS：{accounts.message}', file=sys.stderr)
            return {}
        sdk.init_realtime(Mode.Speed)
        rest = sdk.marketdata.rest_client.stock

        out: dict[str, Quote] = {}
        for sym in symbols:
            try:
                quote = rest.intraday.quote(symbol=sym)
            except Exception as exc:  # noqa: BLE001  單一標的失敗不影響其他
                print(f'[tw] {sym} 富邦查詢失敗：{exc}', file=sys.stderr)
                continue
            if not isinstance(quote, dict):
                continue
            price = _fubon_price(quote)
            if price is None:
                continue
            prev = quote.get('previousClose')
            out[sym] = Quote(
                symbol=sym, market='tw', name=quote.get('name') or sym,
                price=price,
                prev_close=float(prev) if isinstance(prev, (int, float)) and prev > 0 else None,
                source='fubon',
                quote_ts=_epoch_to_iso(quote.get('lastUpdated')),
                stale=False,
            )
        return out
    except Exception as exc:  # noqa: BLE001  任何失敗都要掉回 MIS
        print(f'[tw] 富邦行情不可用，改用 MIS：{exc}', file=sys.stderr)
        return {}
    finally:
        if sdk is not None:
            try:
                sdk.logout()
            except Exception:  # noqa: BLE001
                pass


# --------------------------------------------------------------------------- #
# TW 備援：TWSE MIS
# --------------------------------------------------------------------------- #

def _mis_float(raw: str | None) -> float | None:
    """MIS 用 '-' 表示沒有值；委買賣價欄位是 '_' 分隔的多檔報價"""
    if not raw or raw == '-':
        return None
    first = raw.split('_')[0]
    try:
        return float(first)
    except ValueError:
        return None


def fetch_tw_mis(conn: sqlite3.Connection, symbols: list[str]) -> dict[str, Quote]:
    """查 TWSE MIS。不知道上市或上櫃的代號同時查 tse_ 與 otc_，
    哪邊有回應就用哪邊，並把結果記起來。"""
    if not symbols:
        return {}

    known = dict(conn.execute('SELECT symbol, ex FROM tw_symbol_market').fetchall())
    channels: list[str] = []
    for sym in symbols:
        if sym in known:
            channels.append(f'{known[sym]}_{sym}.tw')
        else:
            channels.append(f'tse_{sym}.tw')
            channels.append(f'otc_{sym}.tw')

    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Referer': MIS_INDEX,
        'Accept': 'application/json, text/plain, */*',
    })
    try:
        session.get(MIS_INDEX, timeout=10)  # 先取得 session cookie
    except requests.RequestException:
        pass

    out: dict[str, Quote] = {}
    for i in range(0, len(channels), MIS_CHUNK):
        chunk = channels[i:i + MIS_CHUNK]
        params = {'ex_ch': '|'.join(chunk), 'json': '1', 'delay': '0',
                  '_': str(int(time.time() * 1000))}
        try:
            resp = session.get(MIS_URL, params=params, timeout=15)
            resp.raise_for_status()
            payload = resp.json()
        except (requests.RequestException, ValueError) as exc:
            print(f'[tw] MIS 請求失敗：{exc}', file=sys.stderr)
            continue

        for item in payload.get('msgArray') or []:
            sym = item.get('c')
            if not sym:
                continue
            # 成交價 z -> 最佳買價 b -> 昨收 y
            price = _mis_float(item.get('z')) or _mis_float(item.get('b')) \
                or _mis_float(item.get('y'))
            if price is None:
                continue
            tlong = item.get('tlong')
            ts = (datetime.fromtimestamp(int(tlong) / 1000, TPE) if tlong
                  else datetime.now(TPE)).isoformat(timespec='seconds')
            out[sym] = Quote(
                symbol=sym, market='tw', name=item.get('n') or sym,
                price=price, prev_close=_mis_float(item.get('y')),
                source='twse_mis', quote_ts=ts, stale=False,
            )
            ex = item.get('ex')
            if ex in ('tse', 'otc'):
                conn.execute(
                    'INSERT OR REPLACE INTO tw_symbol_market (symbol, ex) VALUES (?, ?)',
                    (sym, ex),
                )
        time.sleep(0.4)  # MIS 會擋太密集的請求

    conn.commit()
    return out


# --------------------------------------------------------------------------- #
# US: yfinance
# --------------------------------------------------------------------------- #

def fetch_us(symbols: list[str]) -> dict[str, Quote]:
    if not symbols:
        return {}
    try:
        import yfinance as yf
    except ImportError:
        print('[us] 未安裝 yfinance', file=sys.stderr)
        return {}

    out: dict[str, Quote] = {}
    for sym in symbols:
        try:
            info = yf.Ticker(sym).fast_info
            price = info.get('lastPrice') or info.get('last_price')
            prev = info.get('previousClose') or info.get('previous_close')
            if price is None:
                continue
            out[sym] = Quote(
                symbol=sym, market='us', name=sym, price=float(price),
                prev_close=float(prev) if prev else None, source='yfinance',
                quote_ts=datetime.now(timezone.utc).astimezone(TPE).isoformat(timespec='seconds'),
                stale=False,
            )
        except Exception as exc:  # noqa: BLE001
            print(f'[us] {sym} 抓取失敗：{exc}', file=sys.stderr)
    return out


# --------------------------------------------------------------------------- #
# 寫回 Sheet
# --------------------------------------------------------------------------- #

def push_to_sheet(sh, quotes: dict[str, Quote]) -> int:
    """以代號為鍵 upsert 到「即時報價」。既有但這次沒抓到的列保持原樣。"""
    ws = get_or_create_worksheet(sh, QUOTE_SHEET, QUOTE_HEADER)

    existing = ws.get_all_values()
    rows = existing[1:] if existing else []
    index = {str(r[0]).strip().upper(): i for i, r in enumerate(rows) if r and r[0]}

    now = datetime.now(TPE).isoformat(timespec='seconds')
    for sym, q in quotes.items():
        row = [
            sym,
            q.name,
            q.price,
            q.prev_close if q.prev_close is not None else '',
            'TWD' if q.market == 'tw' else 'USD',
            q.source,
            q.quote_ts,
            now,
        ]
        if sym in index:
            rows[index[sym]] = row
        else:
            index[sym] = len(rows)
            rows.append(row)

    # 補齊長度不一的舊列，避免 update 時欄數對不上
    rows = [list(r) + [''] * (len(QUOTE_HEADER) - len(r)) for r in rows]
    ws.update([QUOTE_HEADER] + rows, value_input_option='RAW')
    return len(quotes)


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='抓價並印出結果，不寫 DB 也不寫 Sheet')
    parser.add_argument('--no-sheet', action='store_true',
                        help='只寫 prices.db，不寫 Sheet')
    parser.add_argument('--symbols',
                        help='指定標的（逗號分隔），跳過從 Sheet 計算持倉；'
                             '4~6 碼數字視為台股，其餘視為美股')
    parser.add_argument('--market-hours-only', action='store_true',
                        help='台股與美股都收盤時直接結束（給排程用）')
    parser.add_argument('--profile', help='只跑指定帳本，預設全部')
    args = parser.parse_args()

    if args.market_hours_only and not (tw_market_open() or us_market_open()):
        return 0

    config = load_config()
    # 每個帳本的持倉各自算，抓價取聯集 —— 報價與代號綁定、與持有人無關，
    # 兩本重疊的標的只會抓一次
    books: list[tuple[dict, object, dict[str, str]]] = []
    held: dict[str, str] = {}

    if args.symbols:
        syms = [s.strip().upper() for s in args.symbols.split(',') if s.strip()]
        held = {s: ('TWD' if looks_tw(s) else 'USD') for s in syms}
    else:
        for profile in profiles(config, args.profile):
            sheet = open_sheet(profile)
            holdings = resolve_holdings(sheet)
            if not holdings:
                print(f'[{profile["name"]}] 沒有需要報價的標的', file=sys.stderr)
                continue
            books.append((profile, sheet, holdings))
            held.update(holdings)
        if not held:
            print('所有帳本都沒有需要報價的標的', file=sys.stderr)
            return 1

    tw_symbols, us_symbols = split_by_market(held)

    conn = pricedb.connect()

    quotes: dict[str, Quote] = {}

    # --- 台股：富邦優先，缺的補 MIS ---
    quotes.update(fetch_tw_fubon(config, tw_symbols))
    missing_tw = [s for s in tw_symbols if s not in quotes]
    quotes.update(fetch_tw_mis(conn, missing_tw))

    # --- 美股 ---
    quotes.update(fetch_us(us_symbols))

    # --- 最後手段：最後已知價 ---
    for sym in tw_symbols + us_symbols:
        if sym not in quotes:
            cached = load_cached(conn, sym)
            if cached:
                quotes[sym] = cached
                print(f'[cache] {sym} 取自快取（{cached.quote_ts}）', file=sys.stderr)
            else:
                print(f'[miss] {sym} 抓不到價格且沒有快取', file=sys.stderr)

    if args.dry_run:
        for sym in sorted(quotes):
            q = quotes[sym]
            pct = f'{q.change_pct:+.2f}%' if q.change_pct is not None else '   -  '
            flag = ' (stale)' if q.stale else ''
            print(f'{sym:8} {q.name:12} {q.price:>12,.2f}  {pct:>8}  '
                  f'{q.source:9} {q.quote_ts}{flag}')
        conn.close()
        return 0

    save_quotes(conn, list(quotes.values()))
    conn.close()

    # 各帳本只寫回自己持有的那幾檔
    written = []
    if not args.no_sheet:
        if not books:
            books = [(p, open_sheet(p), held) for p in profiles(config, args.profile)]
        for profile, sheet, holdings in books:
            subset = {s: q for s, q in quotes.items() if s in holdings}
            push_to_sheet(sheet, subset)
            written.append(f'{profile["name"]} {len(subset)} 檔')

    stale = sum(1 for q in quotes.values() if q.stale)
    summary = '　'.join(written) if written else '未寫入'
    print(f'{datetime.now(TPE).isoformat(timespec="seconds")}  '
          f'報價 {len(quotes)} 檔（快取 {stale} 檔）  Sheet：{summary}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
