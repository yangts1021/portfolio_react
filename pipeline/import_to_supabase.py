"""一次性匯入：Google Sheet + prices.db -> Supabase。

每個 config.json profile 對應一本 Supabase 帳本（books.name = profile 名稱）。

    帳本資料（每本各自）  股票交易紀錄 / 質押借貸資料 / 銀行系統餘額 / Pionex / Bitfinex / 淨值歷史
    共用資料（所有帳本）  即時價格與beta 的 beta、分割事件 -> symbols / split_events
                          prices.db 的 quote_latest / daily_close / daily_fx -> quotes / daily_close / daily_fx

用法：
    ./venv/bin/python import_to_supabase.py --dry-run     # 只讀取與檢查，不寫入
    ./venv/bin/python import_to_supabase.py               # 匯入；帳本已有交易時會中止
    ./venv/bin/python import_to_supabase.py --replace     # 清空帳本資料後重新匯入
    ./venv/bin/python import_to_supabase.py --profile rick

讀取用 UNFORMATTED_VALUE，數字拿到的是原始值而非顯示值（例如利率是 0.0248 不是 2.48%），
與 GAS getValues() 給前端的值一致。日期則用格式化字串再解析。
"""

import argparse
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime

import gspread
from gspread.utils import DateTimeOption, ValueRenderOption

import pricedb
from common import load_config, open_sheet, profiles
from supa import Supabase, SupabaseError, from_config

CURRENCIES = {'TWD', 'USD', 'HKD', 'JPY'}
BUY_WORDS = {'買', 'BUY', 'B'}
SELL_WORDS = {'賣', 'SELL', 'S'}
CURRENCY_EXCHANGE = {'USD': 'us', 'HKD': 'hk', 'JPY': 'jp'}

# 帳本資料表：--replace 時依序清空
BOOK_TABLES = ['transactions', 'pledges', 'bank_accounts', 'crypto_positions', 'nav_history']


# --------------------------------------------------------------------------- #
# parsing
# --------------------------------------------------------------------------- #

@dataclass
class Problems:
    """匯入時跳過或修正的資料列，最後統一列出讓使用者檢查"""

    items: list[str] = field(default_factory=list)

    def add(self, book: str, sheet: str, row_no: int | None, msg: str) -> None:
        where = f'{sheet} 第 {row_no} 列' if row_no else sheet
        self.items.append(f'[{book}] {where}：{msg}')


def cell(row: list, idx: int):
    return row[idx] if idx < len(row) else ''


def is_blank(val) -> bool:
    return val is None or str(val).strip() == ''


def parse_date(raw) -> str | None:
    """2025/3/11、2025-03-11、2025/03/11 13:00:00 都轉成 YYYY-MM-DD"""
    if is_blank(raw):
        return None
    text = str(raw).strip().split()[0]
    for fmt in ('%Y-%m-%d', '%Y/%m/%d'):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_num(raw) -> float | None:
    if is_blank(raw):
        return None
    if isinstance(raw, (int, float)):
        return raw
    try:
        return float(str(raw).replace(',', '').strip())
    except ValueError:
        return None


def parse_symbol(raw, problems: Problems, book: str, sheet: str, row_no: int) -> str:
    """代號若被 Sheet 當成數字存，0050 會變成 50，無法還原，只能提醒"""
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        sym = str(int(raw))
        problems.add(book, sheet, row_no, f'代號 {sym} 是數字格式，可能遺失開頭的 0，請確認')
        return sym
    return str(raw).strip().lstrip("'").upper()


def read_rows(sh, title: str) -> list[list] | None:
    """回傳去掉標題列的資料；工作表不存在回傳 None"""
    try:
        ws = sh.worksheet(title)
    except gspread.WorksheetNotFound:
        return None
    rows = ws.get_all_values(
        value_render_option=ValueRenderOption.unformatted,
        date_time_render_option=DateTimeOption.formatted_string,
    )
    return rows[1:]


# --------------------------------------------------------------------------- #
# per-book sheets
# --------------------------------------------------------------------------- #

def read_transactions(sh, book: str, problems: Problems) -> list[dict]:
    sheet = '股票交易紀錄'
    rows = read_rows(sh, sheet)
    if rows is None:
        problems.add(book, sheet, None, '找不到工作表')
        return []
    out = []
    # 欄位：日期(0) 券商(1) 代號(2) 買賣(3) 股數(4) 價格(5) 幣別(6)
    for i, row in enumerate(rows, start=2):
        if is_blank(cell(row, 0)) and is_blank(cell(row, 2)):
            continue
        day = parse_date(cell(row, 0))
        symbol = parse_symbol(cell(row, 2), problems, book, sheet, i)
        action_raw = str(cell(row, 3)).strip().upper()
        action = 'BUY' if action_raw in BUY_WORDS else 'SELL' if action_raw in SELL_WORDS else None
        qty = parse_num(cell(row, 4))
        price = parse_num(cell(row, 5))
        currency = str(cell(row, 6)).strip().upper() or 'TWD'

        errors = []
        if not day:
            errors.append(f'日期無法解析「{cell(row, 0)}」')
        if not symbol:
            errors.append('缺少代號')
        if not action:
            errors.append(f'買賣欄位無法辨識「{cell(row, 3)}」')
        if qty is None or qty <= 0:
            errors.append(f'股數須大於 0「{cell(row, 4)}」')
        if price is None or price < 0:
            errors.append(f'價格無效「{cell(row, 5)}」')
        if currency not in CURRENCIES:
            errors.append(f'幣別無法辨識「{currency}」')
        if errors:
            problems.add(book, sheet, i, '已跳過：' + '；'.join(errors))
            continue

        out.append({
            'trade_date': day,
            'broker': str(cell(row, 1)).strip(),
            'symbol': symbol,
            'action': action,
            'qty': qty,
            'price': price,
            'currency': currency,
        })
    return out


def read_pledges(sh, book: str, problems: Problems) -> list[dict]:
    sheet = '質押借貸資料'
    rows = read_rows(sh, sheet)
    if rows is None:
        return []
    out = []
    # 欄位：匯撥日期(0) 標的(1) 股數(2) 券商(3) 擔保價值(4, 公式不匯入) 借款日期(5)
    #       借款金額(6) 利率(7) 還款日期(8) 利息(9, 公式不匯入)
    for i, row in enumerate(rows, start=2):
        if is_blank(cell(row, 0)) and is_blank(cell(row, 1)):
            continue
        transfer = parse_date(cell(row, 0))
        symbol = parse_symbol(cell(row, 1), problems, book, sheet, i)
        qty = parse_num(cell(row, 2))
        if not transfer or not symbol or qty is None or qty <= 0:
            problems.add(book, sheet, i, '已跳過：匯撥日期、標的或股數無效')
            continue

        optional = {}
        for key, idx in (('loan_date', 5), ('repayment_date', 8)):
            raw = cell(row, idx)
            optional[key] = parse_date(raw)
            if optional[key] is None and not is_blank(raw):
                problems.add(book, sheet, i, f'{key} 無法解析「{raw}」，已留空')

        out.append({
            'transfer_date': transfer,
            'symbol': symbol,
            'qty': qty,
            'broker': str(cell(row, 3)).strip(),
            'loan_date': optional['loan_date'],
            'loan_amount': parse_num(cell(row, 6)),
            'rate': parse_num(cell(row, 7)),
            'repayment_date': optional['repayment_date'],
        })
    return out


def read_banks(sh, book: str, problems: Problems) -> list[dict]:
    sheet = '銀行系統餘額'
    rows = read_rows(sh, sheet)
    if rows is None:
        return []
    by_bank: dict[str, dict] = {}
    for i, row in enumerate(rows, start=2):
        bank = str(cell(row, 0)).strip()
        if not bank:
            continue
        if bank in by_bank:
            problems.add(book, sheet, i, f'銀行「{bank}」重複，以這一列為準')
        by_bank[bank] = {
            'bank': bank,
            'usd': parse_num(cell(row, 1)) or 0,
            'twd': parse_num(cell(row, 2)) or 0,
            'loan': parse_num(cell(row, 3)) or 0,
        }
    return list(by_bank.values())


def read_crypto(sh, book: str, problems: Problems) -> list[dict]:
    out = []
    empty = {'account': None, 'available': None, 'avg_cost': None}

    # Pionex：account(0) type(1) coin(2) qty(3) avgCost(4) currentPrice(5)
    for i, row in enumerate(read_rows(sh, 'Pionex') or [], start=2):
        coin = str(cell(row, 2)).strip()
        if not coin:
            continue
        out.append({
            **empty,
            'exchange': 'pionex',
            'account': str(cell(row, 0)).strip() or None,
            'wallet_type': str(cell(row, 1)).strip() or 'spot',
            'coin': coin,
            'qty': parse_num(cell(row, 3)) or 0,
            'avg_cost': parse_num(cell(row, 4)),
            'current_price': parse_num(cell(row, 5)),
        })

    # Bitfinex：type(0) coin(1) qty(2) available(3) currentPrice(4)
    for i, row in enumerate(read_rows(sh, 'Bitfinex') or [], start=2):
        coin = str(cell(row, 1)).strip()
        if not coin:
            continue
        out.append({
            **empty,
            'exchange': 'bitfinex',
            'wallet_type': str(cell(row, 0)).strip() or 'exchange',
            'coin': coin,
            'qty': parse_num(cell(row, 2)) or 0,
            'available': parse_num(cell(row, 3)),
            'current_price': parse_num(cell(row, 4)),
        })
    return out


def read_nav(sh, book: str, problems: Problems) -> list[dict]:
    sheet = '淨值歷史'
    by_date: dict[str, dict] = {}
    for i, row in enumerate(read_rows(sh, sheet) or [], start=2):
        day = parse_date(cell(row, 0))
        if not day:
            continue
        nums = [parse_num(cell(row, idx)) for idx in range(1, 6)]
        if any(n is None for n in nums):
            problems.add(book, sheet, i, '已跳過：數值欄位不完整')
            continue
        by_date[day] = dict(
            zip(['date', 'market_value', 'cost', 'unrealized', 'realized', 'roi'], [day, *nums])
        )
    return list(by_date.values())


# --------------------------------------------------------------------------- #
# shared data
# --------------------------------------------------------------------------- #

def read_betas(sh, book: str, problems: Problems) -> dict[str, float | None]:
    betas: dict[str, float | None] = {}
    sheet = '即時價格與beta'
    # 欄位：代號(0) 價格(1, GOOGLEFINANCE 不匯入) beta(2)
    for i, row in enumerate(read_rows(sh, sheet) or [], start=2):
        if is_blank(cell(row, 0)):
            continue
        symbol = parse_symbol(cell(row, 0), problems, book, sheet, i)
        betas[symbol] = parse_num(cell(row, 2))
    return betas


def read_splits(sh, book: str, problems: Problems) -> list[dict]:
    sheet = '分割事件'
    out = []
    for i, row in enumerate(read_rows(sh, sheet) or [], start=2):
        if is_blank(cell(row, 0)):
            continue
        symbol = parse_symbol(cell(row, 0), problems, book, sheet, i)
        day = parse_date(cell(row, 1))
        ratio = parse_num(cell(row, 2))
        if not day or ratio is None or ratio <= 0:
            problems.add(book, sheet, i, '已跳過：生效日或比例無效')
            continue
        out.append({'symbol': symbol, 'effective_date': day, 'ratio': ratio})
    return out


def read_pricedb() -> dict[str, list]:
    conn = pricedb.connect()
    conn.row_factory = sqlite3.Row
    try:
        return {
            'quote_latest': [dict(r) for r in conn.execute('SELECT * FROM quote_latest')],
            'tw_market': dict(conn.execute('SELECT symbol, ex FROM tw_symbol_market').fetchall()),
            'daily_close': [
                {'symbol': r['symbol'], 'date': r['date'], 'close': round(r['close'], 6),
                 'source': r['source']}
                for r in conn.execute('SELECT * FROM daily_close')
            ],
            'daily_fx': [
                {'date': r['date'], 'usdtwd': round(r['usdtwd'], 6), 'source': r['source']}
                for r in conn.execute('SELECT * FROM daily_fx')
            ],
        }
    finally:
        conn.close()


def build_symbols(books: dict, betas_by_book: dict, db: dict, problems: Problems) -> list[dict]:
    """彙整所有帳本與 prices.db 出現過的代號。beta 衝突時以 config 中較前面的帳本為準"""
    info: dict[str, dict] = {}

    def entry(sym: str) -> dict:
        return info.setdefault(
            sym, {'symbol': sym, 'name': None, 'currency': None, 'exchange': None, 'beta': None}
        )

    for data in books.values():
        for tx in data['transactions']:
            entry(tx['symbol'])['currency'] = tx['currency']
        for p in data['pledges']:
            e = entry(p['symbol'])
            e['currency'] = e['currency'] or 'TWD'

    for q in db['quote_latest']:
        e = entry(q['symbol'])
        e['name'] = q['name'] or e['name']
        if q['market'] == 'us':
            e['exchange'] = 'us'
            e['currency'] = e['currency'] or 'USD'
        else:
            e['currency'] = e['currency'] or 'TWD'

    for sym, ex in db['tw_market'].items():
        entry(sym)['exchange'] = ex

    seen_beta: dict[str, tuple[str, float | None]] = {}
    for book, betas in betas_by_book.items():
        for sym, beta in betas.items():
            if sym in seen_beta:
                first_book, first_beta = seen_beta[sym]
                if beta is not None and first_beta is not None and beta != first_beta:
                    problems.add(
                        book, '即時價格與beta', None,
                        f'{sym} beta {beta} 與「{first_book}」的 {first_beta} 不同，採用「{first_book}」',
                    )
                if first_beta is not None or beta is None:
                    continue
            seen_beta[sym] = (book, beta)
            entry(sym)['beta'] = beta

    for e in info.values():
        if e['exchange'] is None and e['currency'] in CURRENCY_EXCHANGE:
            e['exchange'] = CURRENCY_EXCHANGE[e['currency']]
    return sorted(info.values(), key=lambda e: e['symbol'])


def merge_splits(splits_by_book: dict, problems: Problems) -> list[dict]:
    merged: dict[tuple, dict] = {}
    for book, splits in splits_by_book.items():
        for s in splits:
            key = (s['symbol'], s['effective_date'])
            if key in merged and merged[key]['ratio'] != s['ratio']:
                problems.add(
                    book, '分割事件', None,
                    f'{key[0]} {key[1]} 比例 {s["ratio"]} 與其他帳本的 {merged[key]["ratio"]} 不同，'
                    '採用較前面的帳本',
                )
                continue
            merged.setdefault(key, s)
    return list(merged.values())


# --------------------------------------------------------------------------- #
# write
# --------------------------------------------------------------------------- #

def ensure_book(client: Supabase, owner_id: str, name: str) -> tuple[str, bool]:
    """回傳 (book_id, 是否已有交易)"""
    found = client.select('books', {'owner_id': f'eq.{owner_id}', 'name': f'eq.{name}'})
    if found:
        book_id = found[0]['id']
        has_tx = bool(
            client.select('transactions', {'book_id': f'eq.{book_id}', 'select': 'id', 'limit': 1})
        )
        return book_id, has_tx
    created = client.insert('books', [{'owner_id': owner_id, 'name': name}], returning=True)
    return created[0]['id'], False


def write_book(client: Supabase, book_id: str, data: dict) -> None:
    for table in reversed(BOOK_TABLES):
        client.delete(table, {'book_id': f'eq.{book_id}'})
    for table in BOOK_TABLES:
        rows = [{**r, 'book_id': book_id} for r in data[table]]
        if rows:
            client.insert(table, rows)


def write_shared(client: Supabase, shared: dict) -> None:
    client.upsert('symbols', shared['symbols'], 'symbol')
    if shared['split_events']:
        client.upsert('split_events', shared['split_events'], 'symbol,effective_date')
    quotes = [
        {k: q[k] for k in ('symbol', 'price', 'prev_close', 'source', 'quote_ts', 'fetched_at')}
        for q in shared['quote_latest']
    ]
    if quotes:
        client.upsert('quotes', quotes, 'symbol')
    client.upsert('daily_close', shared['daily_close'], 'symbol,date')
    client.upsert('daily_fx', shared['daily_fx'], 'date')


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def main() -> int:
    parser = argparse.ArgumentParser(description='Google Sheet + prices.db 匯入 Supabase')
    parser.add_argument('--profile', help='只匯入指定帳本')
    parser.add_argument('--dry-run', action='store_true', help='只讀取與檢查，不寫入')
    parser.add_argument('--replace', action='store_true', help='帳本已有資料時清空後重新匯入')
    args = parser.parse_args()

    config = load_config()
    problems = Problems()

    books: dict[str, dict] = {}
    betas_by_book: dict[str, dict] = {}
    splits_by_book: dict[str, list] = {}
    for profile in profiles(config, args.profile):
        name = profile['name']
        print(f'讀取帳本「{name}」...')
        sh = open_sheet(profile)
        books[name] = {
            'transactions': read_transactions(sh, name, problems),
            'pledges': read_pledges(sh, name, problems),
            'bank_accounts': read_banks(sh, name, problems),
            'crypto_positions': read_crypto(sh, name, problems),
            'nav_history': read_nav(sh, name, problems),
        }
        betas_by_book[name] = read_betas(sh, name, problems)
        splits_by_book[name] = read_splits(sh, name, problems)

    db = read_pricedb()
    shared = {
        'symbols': build_symbols(books, betas_by_book, db, problems),
        'split_events': merge_splits(splits_by_book, problems),
        'quote_latest': db['quote_latest'],
        'daily_close': db['daily_close'],
        'daily_fx': db['daily_fx'],
    }

    print('\n=== 匯入內容 ===')
    for name, data in books.items():
        counts = '  '.join(f'{t} {len(data[t])}' for t in BOOK_TABLES)
        print(f'[{name}] {counts}')
    print('[共用] ' + '  '.join(f'{k} {len(v)}' for k, v in shared.items()))

    if problems.items:
        print(f'\n=== 需要檢查的資料（{len(problems.items)} 筆） ===')
        for item in problems.items:
            print(item)

    if args.dry_run:
        print('\n--dry-run：未寫入任何資料')
        return 0

    client = from_config(config)
    email = (config.get('supabase') or {}).get('owner_email')
    if not email:
        print('錯誤：config.json 缺少 supabase.owner_email', file=sys.stderr)
        return 1

    try:
        owner_id = client.find_user_id(email)
        if not owner_id:
            print(f'錯誤：Supabase 找不到使用者 {email}，請先在後台建立帳號', file=sys.stderr)
            return 1

        # 先確認所有帳本都能寫，再開始寫入，避免寫到一半才中止
        book_ids = {}
        for name in books:
            book_id, has_tx = ensure_book(client, owner_id, name)
            if has_tx and not args.replace:
                print(
                    f'錯誤：帳本「{name}」已有交易資料。確定要覆蓋請加 --replace '
                    '（前端新增的交易會一併被清掉）',
                    file=sys.stderr,
                )
                return 1
            book_ids[name] = book_id

        print('\n寫入中...')
        write_shared(client, shared)
        for name, data in books.items():
            write_book(client, book_ids[name], data)
            print(f'[{name}] 完成')
    except SupabaseError as e:
        print(f'\n錯誤：{e}', file=sys.stderr)
        print('修正後可加 --replace 重新執行', file=sys.stderr)
        return 1

    print('\n匯入完成')
    return 0


if __name__ == '__main__':
    sys.exit(main())
