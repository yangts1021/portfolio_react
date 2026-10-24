#!/usr/bin/env python3
"""
重算每日資產淨值與損益曲線，寫入 Supabase nav_history（每本帳本各自一份）。

交易紀錄與分割事件讀 Supabase（分割事件共用），每日收盤與匯率讀本機 prices.db。

不存曲線本身、只存每日收盤，曲線一律從交易紀錄重算 —— 這樣補登舊交易或
新增分割事件之後，重跑一次歷史就會自動修正，而不是永遠錯下去。

單位問題（重要）：Yahoo 的歷史收盤會回溯調整分割，例如 00685L 在 2026-07-07
一拆 24，之前的收盤都已除以 24。所以這裡一律把股數換算成「現行單位」：
    某日持有的 1 股 = R(該日) 股現行單位，R(D) = D 之後所有分割比例的乘積
換算後就能直接乘上調整後收盤，分割前後的曲線是連續的。

金額不需要調整（成本就是成本），均價則是 總成本 / 現行單位股數。

用法：
    python build_history.py              # 重算並寫入 Supabase
    python build_history.py --dry-run    # 只印最後幾列
    python build_history.py --profile LR # 只跑指定帳本（Supabase books.name）
    python build_history.py --csv out.csv
"""

from __future__ import annotations

import argparse
import csv
import sys

import pricedb
from common import load_config
from supa import SupabaseError, from_config, list_books, load_splits, load_transactions

CSV_HEADER = ['日期', '總市值TWD', '總成本TWD', '未實現TWD', '已實現累計TWD', '報酬率%']
NAV_FIELDS = ['date', 'market_value', 'cost', 'unrealized', 'realized', 'roi']


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


def push_to_supabase(client, book_id: str, rows: list[list]) -> int:
    """先 upsert 全部，再刪掉這次沒產生的日期 —— 過程中曲線不會有空窗。回傳刪除筆數"""
    client.upsert(
        'nav_history',
        [{'book_id': book_id, **dict(zip(NAV_FIELDS, row))} for row in rows],
        'book_id,date',
    )
    produced = {row[0] for row in rows}
    existing = client.select('nav_history', {'book_id': f'eq.{book_id}', 'select': 'date'})
    stale = sorted(r['date'] for r in existing if r['date'] not in produced)
    for i in range(0, len(stale), 100):
        chunk = ','.join(stale[i : i + 100])
        client.delete('nav_history', {'book_id': f'eq.{book_id}', 'date': f'in.({chunk})'})
    return len(stale)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='只印結果，不寫 Supabase')
    parser.add_argument('--csv', help='另存一份 CSV（多帳本時檔名會加上帳本名）')
    parser.add_argument('--tail', type=int, default=8, help='印出最後幾列')
    parser.add_argument('--profile', help='只跑指定帳本（Supabase books.name），預設全部')
    args = parser.parse_args()

    client = from_config(load_config())
    books = list_books(client, args.profile)
    splits = load_splits(client)
    conn = pricedb.connect()
    failed = 0

    for book in books:
        name = book['name']
        rows = build(conn, load_transactions(client, book['id']), splits)
        if not rows:
            print(f'[{name}] 沒有可用的歷史資料，請先跑 backfill_history.py', file=sys.stderr)
            failed += 1
            continue

        print(f'\n[{name}] {rows[0][0]} ~ {rows[-1][0]}，共 {len(rows)} 個交易日')
        print(f'{"日期":<12}{"總市值":>14}{"總成本":>14}{"未實現":>14}{"已實現累計":>14}{"報酬率":>9}')
        for row in rows[-args.tail:]:
            print(f'{row[0]:<12}{row[1]:>14,.0f}{row[2]:>14,.0f}{row[3]:>14,.0f}{row[4]:>14,.0f}'
                  f'{row[5]:>8.2f}%')

        if args.csv:
            path = args.csv if len(books) == 1 else f'{args.csv.rsplit(".", 1)[0]}_{name}.csv'
            with open(path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(CSV_HEADER)
                writer.writerows(rows)
            print(f'CSV 已寫入 {path}')

        if not args.dry_run:
            try:
                removed = push_to_supabase(client, book['id'], rows)
            except SupabaseError as e:
                print(f'[{name}] 寫入 Supabase 失敗：{e}', file=sys.stderr)
                failed += 1
                continue
            extra = f'，移除 {removed} 個過期日期' if removed else ''
            print(f'[{name}] nav_history 已更新 {len(rows)} 列{extra}')

    conn.close()
    return 1 if failed == len(books) else 0


if __name__ == '__main__':
    raise SystemExit(main())
