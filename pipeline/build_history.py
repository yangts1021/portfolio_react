#!/usr/bin/env python3
"""
重算每日資產淨值與損益曲線，寫入 Sheet「淨值歷史」。

不存曲線本身、只存每日收盤，曲線一律從交易紀錄重算 —— 這樣補登舊交易或
新增分割事件之後，重跑一次歷史就會自動修正，而不是永遠錯下去。

單位問題（重要）：Yahoo 的歷史收盤會回溯調整分割，例如 00685L 在 2026-07-07
一拆 24，之前的收盤都已除以 24。所以這裡一律把股數換算成「現行單位」：
    某日持有的 1 股 = R(該日) 股現行單位，R(D) = D 之後所有分割比例的乘積
換算後就能直接乘上調整後收盤，分割前後的曲線是連續的。

金額不需要調整（成本就是成本），均價則是 總成本 / 現行單位股數。

用法：
    python build_history.py              # 重算並寫入 Sheet
    python build_history.py --dry-run    # 只印最後幾列
    python build_history.py --csv out.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime

import pricedb
from common import get_or_create_worksheet, load_config, open_spreadsheet

TX_SHEET = '股票交易紀錄'
SPLIT_SHEET = '分割事件'
HISTORY_SHEET = '淨值歷史'
HISTORY_HEADER = ['日期', '總市值TWD', '總成本TWD', '未實現TWD', '已實現累計TWD', '報酬率%']

SELL_WORDS = ('賣', 'SELL', 'S')


def parse_date(raw) -> str | None:
    """Sheet 的日期可能是 2025/03/11 或 2025-03-11，統一成 YYYY-MM-DD"""
    text = str(raw).strip()[:10]
    for fmt in ('%Y-%m-%d', '%Y/%m/%d'):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def to_float(val) -> float:
    try:
        return float(str(val).replace(',', '').strip())
    except (TypeError, ValueError):
        return 0.0


def read_transactions(sh) -> list[dict]:
    rows = sh.worksheet(TX_SHEET).get_all_values()
    txs = []
    for row in rows[1:]:
        if len(row) < 6:
            continue
        symbol = str(row[2]).strip().upper()
        day = parse_date(row[0])
        if not symbol or not day:
            continue
        txs.append({
            'date': day,
            'symbol': symbol,
            'action': 'SELL' if str(row[3]).strip().upper() in SELL_WORDS else 'BUY',
            'qty': to_float(row[4]),
            'price': to_float(row[5]),
            'currency': (str(row[6]).strip().upper() if len(row) > 6 else '') or 'TWD',
        })
    txs.sort(key=lambda t: t['date'])
    return txs


def read_splits(sh) -> dict[str, list[tuple[str, float]]]:
    """回傳 {代號: [(生效日, 比例), ...]}"""
    try:
        rows = sh.worksheet(SPLIT_SHEET).get_all_values()
    except Exception:  # noqa: BLE001  沒有這張表就當作沒有分割
        return {}
    splits: dict[str, list[tuple[str, float]]] = {}
    for row in rows[1:]:
        if len(row) < 3:
            continue
        symbol = str(row[0]).strip().upper()
        day = parse_date(row[1])
        ratio = to_float(row[2])
        if symbol and day and ratio > 0:
            splits.setdefault(symbol, []).append((day, ratio))
    return splits


def split_factor(splits: dict, symbol: str, day: str) -> float:
    """R(D)：該日之後發生的所有分割比例乘積。用來把當時的股數換算成現行單位"""
    factor = 1.0
    for eff_date, ratio in splits.get(symbol, []):
        if eff_date > day:
            factor *= ratio
    return factor


def load_closes(conn, splits: dict) -> dict[str, list[tuple[str, float]]]:
    """回傳 {代號: [(日期, 現行單位收盤), ...]}，依日期排序"""
    out: dict[str, list[tuple[str, float]]] = {}
    for symbol, day, close, source in conn.execute(
        'SELECT symbol, date, close, source FROM daily_close ORDER BY symbol, date'
    ):
        # yfinance 的歷史收盤已回溯調整分割，是現行單位；
        # 盤中即時記錄下來的則是「當日單位」，要除以 R(D) 換算
        price = close if source == 'yfinance_hist' else close / split_factor(splits, symbol, day)
        out.setdefault(symbol, []).append((day, price))
    return out


def load_fx(conn) -> list[tuple[str, float]]:
    return list(conn.execute('SELECT date, usdtwd FROM daily_fx ORDER BY date'))


def pick(series: list[tuple[str, float]], day: str, cursor: int) -> tuple[float | None, int]:
    """在已排序序列中取最後一筆 <= day 的值，回傳 (值, 新游標)"""
    value = None
    while cursor < len(series) and series[cursor][0] <= day:
        value = series[cursor][1]
        cursor += 1
    return value, cursor


def build(conn, txs: list[dict], splits: dict) -> list[list]:
    closes = load_closes(conn, splits)
    fx_series = load_fx(conn)
    if not txs:
        return []

    start = txs[0]['date']
    all_dates = sorted({d for series in closes.values() for d, _ in series if d >= start})
    if not all_dates:
        return []

    # 每檔的執行狀態：股數為現行單位，成本與已實現為原幣
    state: dict[str, dict] = {}
    realized_twd = 0.0
    tx_index = 0
    cursors = {symbol: 0 for symbol in closes}
    last_close: dict[str, float] = {}
    fx_cursor = 0
    fx_rate = 32.5  # 尚無匯率資料時的保底值，第一筆匯率進來就會被覆蓋

    rows: list[list] = []
    for day in all_dates:
        rate, fx_cursor = pick(fx_series, day, fx_cursor)
        if rate:
            fx_rate = rate

        # 先結算當日（含之前尚未處理）的交易
        while tx_index < len(txs) and txs[tx_index]['date'] <= day:
            tx = txs[tx_index]
            tx_index += 1
            factor = split_factor(splits, tx['symbol'], tx['date'])
            qty = tx['qty'] * factor  # 換算成現行單位
            amount = tx['qty'] * tx['price']  # 金額不受分割影響
            pos = state.setdefault(
                tx['symbol'],
                {'qty': 0.0, 'cost': 0.0, 'currency': tx['currency']},
            )
            if tx['action'] == 'BUY':
                pos['qty'] += qty
                pos['cost'] += amount
            else:
                avg = pos['cost'] / pos['qty'] if pos['qty'] > 1e-9 else 0.0
                cost_basis = avg * qty
                gain = amount - cost_basis
                realized_twd += gain * (fx_rate if pos['currency'] == 'USD' else 1.0)
                pos['qty'] -= qty
                pos['cost'] -= cost_basis
                if pos['qty'] <= 1e-6:
                    pos['qty'] = 0.0
                    pos['cost'] = 0.0

        # 收盤價前推：沒有當日資料就沿用最後一筆
        for symbol in closes:
            price, cursors[symbol] = pick(closes[symbol], day, cursors[symbol])
            if price is not None:
                last_close[symbol] = price

        market_value = 0.0
        cost_total = 0.0
        for symbol, pos in state.items():
            if pos['qty'] <= 1e-6:
                continue
            price = last_close.get(symbol)
            if price is None:
                continue
            rate_for = fx_rate if pos['currency'] == 'USD' else 1.0
            market_value += pos['qty'] * price * rate_for
            cost_total += pos['cost'] * rate_for

        unrealized = market_value - cost_total
        roi = (unrealized / cost_total * 100) if cost_total > 0 else 0.0
        rows.append([
            day,
            round(market_value, 2),
            round(cost_total, 2),
            round(unrealized, 2),
            round(realized_twd, 2),
            round(roi, 2),
        ])
    return rows


def push_to_sheet(sh, rows: list[list]) -> None:
    ws = get_or_create_worksheet(sh, HISTORY_SHEET, HISTORY_HEADER)
    ws.clear()
    ws.update([HISTORY_HEADER] + rows, value_input_option='RAW')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='只印結果，不寫 Sheet')
    parser.add_argument('--csv', help='另存一份 CSV')
    parser.add_argument('--tail', type=int, default=8, help='印出最後幾列')
    args = parser.parse_args()

    sh = open_spreadsheet(load_config())
    txs = read_transactions(sh)
    splits = read_splits(sh)
    conn = pricedb.connect()
    rows = build(conn, txs, splits)
    conn.close()

    if not rows:
        print('沒有可用的歷史資料，請先跑 backfill_history.py', file=sys.stderr)
        return 1

    print(f'{rows[0][0]} ~ {rows[-1][0]}，共 {len(rows)} 個交易日')
    print(f'{"日期":<12}{"總市值":>14}{"總成本":>14}{"未實現":>14}{"已實現累計":>14}{"報酬率":>9}')
    for row in rows[-args.tail:]:
        print(f'{row[0]:<12}{row[1]:>14,.0f}{row[2]:>14,.0f}{row[3]:>14,.0f}{row[4]:>14,.0f}'
              f'{row[5]:>8.2f}%')

    if args.csv:
        with open(args.csv, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(HISTORY_HEADER)
            writer.writerows(rows)
        print(f'CSV 已寫入 {args.csv}')

    if not args.dry_run:
        push_to_sheet(sh, rows)
        print(f'Sheet「{HISTORY_SHEET}」已更新 {len(rows)} 列')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
