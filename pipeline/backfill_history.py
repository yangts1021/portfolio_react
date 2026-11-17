#!/usr/bin/env python3
"""
回補每日收盤與匯率，讓資產曲線可以從第一筆交易那天開始畫。

台股一律向證交所／櫃買中心抓（tw_exchange.py），不用 Yahoo；換成交易所資料的
台股會把舊的 Yahoo 收盤刪掉。月份已經抓過的就跳過，所以每天的排程只抓最近一兩個月。
美股與匯率仍用 yfinance。以下關於 Yahoo 分割調整與後綴的說明只適用於非台股。

標的清單取自 Supabase transactions 出現過的**所有**代號（含已出清、所有帳本），
因為歷史曲線需要當時持有的標的，不只是現在還留著的。

寫入 prices.db 之後也同步 upsert 到 Supabase daily_close / daily_fx。

分割：近期有分割生效的標的會整檔重新下載（不受 --start 限制），而且下載回來的收盤
如果還是分割前的價格（Yahoo 對台股 ETF 的調整常慢幾天），會在這裡先換算成分割後
單位再寫入，詳見 splits.py。

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
import tw_exchange
from splits import effective, recently_split, to_current_units
from supa import SupabaseError, from_config, list_books, load_splits, load_transactions

FX_TICKER = 'TWD=X'  # USD/TWD


def all_traded_symbols(txs: list[dict]) -> dict[str, str]:
    """回傳 {代號: 幣別}，涵蓋交易紀錄裡出現過的所有標的（含已出清）"""
    return {tx['symbol']: tx['currency'] for tx in txs}


def first_dates_by_symbol(txs: list[dict]) -> dict[str, str]:
    """每檔最早一筆交易日期"""
    out: dict[str, str] = {}
    for tx in txs:
        if tx['symbol'] not in out or tx['date'] < out[tx['symbol']]:
            out[tx['symbol']] = tx['date']
    return out


def close_on_or_after(conn, symbol: str, day: str) -> float | None:
    """prices.db 裡這一檔在 day 當天或之後最早的一筆收盤（含盤中記下的價格）"""
    row = conn.execute(
        'SELECT close FROM daily_close WHERE symbol = ? AND date >= ? ORDER BY date LIMIT 1',
        (symbol, day),
    ).fetchone()
    return row[0] if row else None


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
        first_dates: dict[str, str] = {}
    else:
        # 日線與匯率是共用的，多帳本取標的聯集、起點取最早的一筆交易
        book_id = list_books(client, args.profile)[0]['id'] if args.profile else None
        txs = load_transactions(client, book_id)
        held = all_traded_symbols(txs)
        start = args.start or first_trade_date(txs)
        first_dates = first_dates_by_symbol(txs)

    if client is not None:
        splits = effective(load_splits(client))
    else:
        splits = {}
        print('未連線 Supabase，略過分割檢查（收盤照 Yahoo 回傳的寫入）', file=sys.stderr)

    # yfinance 的 end 是開區間，多加一天才會含今天
    end = args.end or (date.today() + timedelta(days=1)).isoformat()
    print(f'回補區間 {start} ~ {end}，共 {len(held)} 檔')

    total = 0
    remote_close: list[dict] = []
    remote_fx: list[dict] = []
    today = date.today().isoformat()
    tw_replaced: list[str] = []
    for symbol, currency in sorted(held.items()):
        rows = []
        used = ''
        if looks_tw(symbol):
            # 台股一律用交易所資料，不用 Yahoo（見 tw_exchange.py）
            first = min(start, first_dates.get(symbol, start))
            closes, source = tw_exchange.history(conn, symbol, first, start, today)
            if source is None:
                print(f'  {symbol:8} 證交所與櫃買中心都查無資料', file=sys.stderr)
                continue
            rows = [(symbol, d, c, source) for d, c in closes]
            print(f'  {symbol:8} {source:12} {len(rows):5} 筆'
                  + (f'  {rows[0][1]} ~ {rows[-1][1]}' if rows else '（已是最新）'))
            if not args.dry_run:
                pricedb.upsert_daily_close(conn, rows)
                remote_close += [
                    {'symbol': s, 'date': d, 'close': round(c, 6), 'source': src}
                    for s, d, c, src in rows
                ]
                tw_replaced.append(symbol)
            total += len(rows)
            continue
        events = splits.get(symbol, [])
        # 剛分割的標的：prices.db 裡更早的收盤是分割前下載的舊單位，整檔重抓才換得掉
        symbol_start = start
        if events and recently_split(events):
            symbol_start = min(start, first_dates.get(symbol, start))
        for ticker in yf_candidates(conn, symbol, currency):
            closes = download_closes(ticker, symbol_start, end)
            if closes:
                used = ticker
                closes, applied = to_current_units(
                    closes, events, lambda eff, s=symbol: close_on_or_after(conn, s, eff)
                )
                for eff, ratio in applied:
                    print(f'  {symbol:8} Yahoo 尚未調整 {eff} 的分割，{eff} 之前的收盤已除以 {ratio:g}')
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

    # 台股換成交易所資料後，舊的 Yahoo 收盤（含停牌期間 Yahoo 自己補的價格）一併刪掉
    yahoo_sources = ('yfinance_hist', 'yfinance')
    for symbol in tw_replaced:
        conn.execute(
            'DELETE FROM daily_close WHERE symbol = ? AND source IN (?, ?)', (symbol, *yahoo_sources)
        )
    conn.commit()
    conn.close()

    if write_remote:
        try:
            if remote_close:
                client.upsert('daily_close', remote_close, 'symbol,date')
            if remote_fx:
                client.upsert('daily_fx', remote_fx, 'date')
            for symbol in tw_replaced:
                client.delete('daily_close', {'symbol': f'eq.{symbol}',
                                              'source': f'in.({",".join(yahoo_sources)})'})
            print(f'Supabase：收盤 {len(remote_close)} 筆、匯率 {len(remote_fx)} 筆')
        except SupabaseError as e:
            # prices.db 已寫好；下次回補（或 --start 指定區間重跑）會再補上
            print(f'寫入 Supabase 失敗：{e}', file=sys.stderr)
            return 1
    print(f'{"（dry-run，未寫入）" if args.dry_run else "已寫入"} 收盤 {total} 筆')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
