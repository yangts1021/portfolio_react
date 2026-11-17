"""台股每日收盤：直接向證交所（上市）與櫃買中心（上櫃）逐月抓個股成交資料。

台股一律不用 Yahoo：Yahoo 對台股 ETF 的分割常常只調整一半（00662 在 2026-11-17 生效，
Yahoo 只把 11/9 之後除了 5），停牌期間還會自己補價格。交易所給的是當天實際的
收盤價（分割前就是分割前的價格），寫入時 source 記為 twse_hist / tpex_hist，
build_history 會把它當成「當日單位」，依分割事件換算成現行單位。

證交所會擋短時間內的大量請求，每次請求之間要停一下。
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from datetime import date

TWSE_URL = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date={y}{m:02d}01&stockNo={code}&response=json'
TPEX_URL = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code={code}&date={y}/{m:02d}/01&response=json'
SOURCES = {'tse': 'twse_hist', 'otc': 'tpex_hist'}
PAUSE = {'tse': 3.0, 'otc': 1.0}


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read())
        except Exception as exc:  # noqa: BLE001
            if attempt == 2:
                print(f'[exchange] {url} 失敗：{exc}', file=sys.stderr)
                return {}
            time.sleep(5 * (attempt + 1))
    return {}


def _num(s: str) -> float | None:
    try:
        v = float(str(s).replace(',', '').strip())
        return v if v > 0 else None
    except ValueError:
        return None  # 「--」：當天沒有成交


def month_closes(market: str, code: str, y: int, m: int) -> list[tuple[str, float]]:
    """一個月份的 [(YYYY-MM-DD, 收盤)]；沒有資料回傳空清單"""
    url = (TWSE_URL if market == 'tse' else TPEX_URL).format(code=code, y=y, m=m)
    j = _get(url)
    time.sleep(PAUSE[market])
    if market == 'tse':
        rows = j.get('data', []) if j.get('stat') == 'OK' else []
    else:
        tables = j.get('tables') or [{}]
        rows = tables[0].get('data', [])
    out = []
    for r in rows:
        # 日期是民國年：115/11/17
        ry, rm, rd = (int(x) for x in r[0].strip().split('/'))
        close = _num(r[6])
        if close:
            out.append((f'{ry + 1911}-{rm:02d}-{rd:02d}', close))
    return out


def months(start: str, end: str) -> list[tuple[int, int]]:
    y, m = int(start[:4]), int(start[5:7])
    ey, em = int(end[:4]), int(end[5:7])
    out = []
    while (y, m) <= (ey, em):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def market_of(conn, code: str, first: str) -> str | None:
    """上市 tse / 上櫃 otc。prices.db 沒記過就兩邊試抓，並記下來。

    試抓的月份是第一筆交易的那個月和本月，已下市的標的也找得到。
    """
    row = conn.execute('SELECT ex FROM tw_symbol_market WHERE symbol = ?', (code,)).fetchone()
    if row and row[0] in SOURCES:
        return row[0]
    today = date.today()
    probe = list(dict.fromkeys([(int(first[:4]), int(first[5:7])), (today.year, today.month)]))
    for market in ('tse', 'otc'):
        for y, m in probe:
            if month_closes(market, code, y, m):
                conn.execute('INSERT OR REPLACE INTO tw_symbol_market (symbol, ex) VALUES (?, ?)', (code, market))
                conn.commit()
                return market
    return None


def history(conn, code: str, first: str, refresh_from: str, end: str):
    """回傳 (收盤列表, source)。

    first ~ end 之間的月份：與 refresh_from ~ end 重疊的一定重抓；更早的月份如果
    prices.db 已經有交易所的資料就跳過，所以每天的排程只會抓最近一兩個月，
    第一次跑則會把整段歷史補齊。
    """
    market = market_of(conn, code, first)
    if market is None:
        return [], None
    source = SOURCES[market]
    out: list[tuple[str, float]] = []
    for y, m in months(first, end):
        month_end = f'{y}-{m:02d}-31'
        if month_end < refresh_from:
            have = conn.execute(
                'SELECT 1 FROM daily_close WHERE symbol = ? AND source = ? AND date LIKE ? LIMIT 1',
                (code, source, f'{y}-{m:02d}-%'),
            ).fetchone()
            if have:
                continue
        out += [(d, c) for d, c in month_closes(market, code, y, m) if first <= d <= end]
    return out, source
