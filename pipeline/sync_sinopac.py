import os
import sys
import threading

import shioaji as sj

from common import enum_name, get_or_create_worksheet, load_config, open_spreadsheet, profiles
from supa import SupabaseError, from_config, list_books


def login_sinopac(config):
    """用 API Key 登入永豐 Shioaji，回傳 api 物件"""
    cfg = config['sinopac']
    api = sj.Shioaji()
    # shioaji 1.7 起移除 contracts_timeout，登入參數只剩 api_key / secret_key
    accounts = api.login(cfg['api_key'], cfg['secret_key'])
    if not accounts:
        print('登入失敗：請確認 API Key 和 Secret Key')
        sys.exit(1)
    print(f'登入成功，帳號數：{len(accounts)}')
    return api


def fetch_positions(api):
    """查詢股票庫存，回傳 (positions 原始物件, 寫入 Sheet 的資料列)"""
    positions = api.list_positions(api.stock_account)
    rows = []
    for pos in positions:
        rows.append([
            pos.code,
            enum_name(pos.direction),
            pos.quantity * 1000,
            float(pos.price),
            float(pos.last_price),
            float(pos.pnl),
            enum_name(pos.cond),
        ])
    return positions, rows


def write_positions_to_sheet(sh, rows):
    """寫入庫存到 Google Sheet「永豐庫存」工作表"""
    ws = get_or_create_worksheet(sh, '永豐庫存')
    ws.clear()
    header = ['代碼', '方向', '庫存股數', '成本均價', '現價', '未實現損益', '交易類型']
    ws.update([header] + rows, value_input_option='RAW')


def fetch_position_details(api, positions):
    """查詢所有庫存的交易明細"""
    rows = []
    for pos in positions:
        details = api.list_position_detail(api.stock_account, detail_id=pos.id)
        for d in details:
            rows.append([
                str(d.date),
                d.code,
                enum_name(d.direction),
                d.quantity * 1000,
                float(d.price),
                float(d.last_price),
                float(d.pnl),
                float(d.fee),
                enum_name(d.currency),
                enum_name(d.cond),
                d.dseq,
            ])
    return rows


def sync_trade_records(sh, api, positions):
    """將交易明細同步到 Google Sheet「永豐交易紀錄」，只新增不重複的紀錄"""
    header = ['日期', '代碼', '方向', '股數', '成本價', '現價', '損益', '手續費', '幣別', '交易類型', '委託序號']

    ws = get_or_create_worksheet(sh, '永豐交易紀錄', header)

    existing = ws.get_all_values()
    existing_keys = set()
    for row in existing[1:]:
        if len(row) >= 11:
            existing_keys.add((row[0], row[1], row[10]))

    new_rows = fetch_position_details(api, positions)
    to_append = []
    for row in new_rows:
        key = (str(row[0]), str(row[1]), str(row[10]))
        if key not in existing_keys:
            to_append.append(row)

    if to_append:
        ws.append_rows(to_append, value_input_option='RAW')
        print(f'永豐交易紀錄：新增 {len(to_append)} 筆')
    else:
        print('永豐交易紀錄：無新資料')


def sync_bank_balance(config, api):
    """查詢交割帳戶餘額，更新 Supabase bank_accounts 中主帳本的永豐那一列（TWD 欄）

    主帳本 = config.json profiles 的第一本，對應 Supabase 同名帳本；
    券商 API Key 只屬於這一本，其他帳本不動。
    """
    result = api.account_balance()
    if result.status.value != 'Fetched':
        print(f'查詢餘額失敗：{result.errmsg}')
        return

    balance = float(result.acc_balance)
    book_name = profiles(config)[0]['name']

    try:
        client = from_config(config)
        book_id = list_books(client, book_name)[0]['id']
        updated = client.update(
            'bank_accounts',
            {'book_id': f'eq.{book_id}', 'bank': 'ilike.*永豐*'},
            {'twd': balance},
        )
    except SupabaseError as e:
        print(f'更新永豐銀行餘額失敗：{e}')
        return

    if updated:
        print(f'永豐銀行餘額已更新：{balance}（{updated[0]["bank"]}）')
    else:
        print(f'帳本「{book_name}」找不到名稱含「永豐」的銀行')


def main():
    config = load_config()
    api = login_sinopac(config)
    try:
        sh = open_spreadsheet(config)
        positions, rows = fetch_positions(api)
        write_positions_to_sheet(sh, rows)
        print(f'庫存同步完成，共 {len(rows)} 筆')
        sync_trade_records(sh, api, positions)
        sync_bank_balance(config, api)
    except Exception as e:
        import traceback
        traceback.print_exc()
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        # logout 可能 hang 住，設定 5 秒後強制退出
        timer = threading.Timer(5.0, lambda: os._exit(0))
        timer.daemon = True
        timer.start()
        try:
            api.logout()
        except Exception:
            pass


if __name__ == '__main__':
    main()
