#!/usr/bin/env python3
"""
用 yfinance 回補每日收盤與匯率，讓資產曲線可以從第一筆交易那天開始畫。

標的清單取自 Supabase transactions 出現過的**所有**代號（含已出清、所有帳本），
因為歷史曲線需要當時持有的標的，不只是現在還留著的。

寫入 prices.db 之後也同步 upsert 到 Supabase daily_close / daily_fx。

台股代號要加交易所後綴：上市 .TW、上櫃 .TWO。prices.db 的 tw_symbol_market
已經記過的直接用，沒記過的兩邊都試。

用法：
    python backfill_history.py                 # 從最早一筆交易補到今天
    python backfill_history.py --start 2024-01-01
    python backfill_history.py --symbols 2330,QQQ
    python backfill_history.py --dry-run       # 只印筆數，不寫 DB
    python backfill_history.py --no-remote     # 只寫 prices.db，不寫 Supabase
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta

import pricedb
from common import load_config
from fetch_prices import looks_tw
from supa import SupabaseError, from_config, list_books, load_transactions

FX_TICKER = 'TWD=X'  # USD/TWD


def all_traded_symbols(txs: list[dict]) -> dict[str, str]:
    """回傳 {代號: 幣別}，涵蓋交易紀錄裡出現過的所有標的（含已出清）"""
    return {tx['symbol']: tx['currency'] for tx in txs}


def first_trade_date(txs: list[dict]) -> str:
    """最早一筆交易日期，當作回補起點"""
    dates = [tx['date'] for tx in txs]
    return min(dates) if dates else (date.today() - timedelta(days=365)).isoformat()


def yf_candidates(conn, symbol: str, currency: str) -> list[str]:
    """回傳這個代號在 yfinance 可能的 ticker，依可能性排序"""
    if not looks_tw(symbol) and currency != 'TWD':
        return [symbol]
    row = conn.execute(
        'SELECT ex FROM tw_symbol_market WHERE symbol = ?', (symbol,)
    ).fetchone()
    if row and row[0] == 'otc':
        return [f'{symbol}.TWO', f'{symbol}.TW']
    if row and row[0] == 'tse':
        return [f'{symbol}.TW', f'{symbol}.TWO']
    return [f'{symbol}.TW', f'{symbol}.TWO']


def download_closes(ticker: str, start: str, end: str):
    """回傳 [(date, close)]，抓不到就空清單"""
    import yfinance as yf

    try:
        # auto_adjust=False 拿原始收盤；Yahoo 的 Close 已對分割回溯調整，
        # 與 build_history 一律換算成「現行股數單位」的做法一致
        hist = yf.Ticker(ticker).history(start=start, end=end, auto_adjust=False)
    except Exception as exc:  # noqa: BLE001
        print(f'[hist] {ticker} 下載失敗：{exc}', file=sys.stderr)
        return []
    if hist is None or hist.empty or 'Close' not in hist:
        return []
    out = []
    for idx, close in hist['Close'].items():
        if close is None or close != close or close <= 0:  # NaN / 無效值
            continue
        out.append((idx.date().isoformat(), float(close)))
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', help='回補起點 YYYY-MM-DD，預設為最早一筆交易日')
    parser.add_argument('--end', help='回補終點 YYYY-MM-DD，預設為今天')
    parser.add_argument('--symbols', help='指定標的（逗號分隔），跳過從交易紀錄取清單')
    parser.add_argument('--skip-fx', action='store_true', help='不回補匯率')
    parser.add_argument('--dry-run', action='store_true', help='只印結果，不寫 DB')
    parser.add_argument('--no-remote', action='store_true', help='只寫 prices.db，不寫 Supabase')
    parser.add_argument('--profile', help='只取指定帳本（Supabase books.name）的標的，預設全部')
    args = parser.parse_args()

    write_remote = not args.dry_run and not args.no_remote
    client = from_config(load_config()) if (write_remote or not args.symbols) else None
    conn = pricedb.connect()

    if args.symbols:
        held = {s.strip().upper(): ('TWD' if looks_tw(s.strip()) else 'USD')
                for s in args.symbols.split(',') if s.strip()}
        start = args.start or (date.today() - timedelta(days=365 * 3)).isoformat()
    else:
        # 日線與匯率是共用的，多帳本取標的聯集、起點取最早的一筆交易
        book_id = list_books(client, args.profile)[0]['id'] if args.profile else None
        txs = load_transactions(client, book_id)
        held = all_traded_symbols(txs)
        start = args.start or first_trade_date(txs)

    # yfinance 的 end 是開區間，多加一天才會含今天
    end = args.end or (date.today() + timedelta(days=1)).isoformat()
    print(f'回補區間 {start} ~ {end}，共 {len(held)} 檔')

    total = 0
    remote_close: list[dict] = []
    remote_fx: list[dict] = []
    for symbol, currency in sorted(held.items()):
        rows = []
        used = ''
        for ticker in yf_candidates(conn, symbol, currency):
            closes = download_closes(ticker, start, end)
            if closes:
                used = ticker
                rows = [(symbol, d, c, 'yfinance_hist') for d, c in closes]
                break
        if not rows:
            print(f'  {symbol:8} 查無資料', file=sys.stderr)
            continue
        print(f'  {symbol:8} {used:12} {len(rows):5} 筆  {rows[0][1]} ~ {rows[-1][1]}')
        if not args.dry_run:
            pricedb.upsert_daily_close(conn, rows)
            remote_close += [
                {'symbol': s, 'date': d, 'close': round(c, 6), 'source': src}
                for s, d, c, src in rows
            ]
        total += len(rows)

    if not args.skip_fx:
        fx = download_closes(FX_TICKER, start, end)
        print(f'  匯率 USD/TWD  {len(fx):5} 筆')
        if fx and not args.dry_run:
            pricedb.upsert_daily_fx(conn, [(d, c, 'yfinance_hist') for d, c in fx])
            remote_fx = [{'date': d, 'usdtwd': round(c, 6), 'source': 'yfinance_hist'} for d, c in fx]

    conn.close()

    if write_remote:
        try:
            if remote_close:
                client.upsert('daily_close', remote_close, 'symbol,date')
            if remote_fx:
                client.upsert('daily_fx', remote_fx, 'date')
            print(f'Supabase：收盤 {len(remote_close)} 筆、匯率 {len(remote_fx)} 筆')
        except SupabaseError as e:
            # prices.db 已寫好；下次回補（或 --start 指定區間重跑）會再補上
            print(f'寫入 Supabase 失敗：{e}', file=sys.stderr)
            return 1
    print(f'{"（dry-run，未寫入）" if args.dry_run else "已寫入"} 收盤 {total} 筆')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
