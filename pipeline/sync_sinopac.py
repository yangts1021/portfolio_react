import os
import sys
import threading

import gspread
import shioaji as sj

from common import enum_name, get_or_create_worksheet, load_config, open_spreadsheet


def login_sinopac(config):
    """用 API Key 登入永豐 Shioaji，回傳 api 物件"""
    cfg = config['sinopac']
    api = sj.Shioaji()
    accounts = api.login(
        cfg['api_key'],
        cfg['secret_key'],
        contracts_timeout=10000,
    )
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


def sync_bank_balance(sh, api):
    """查詢交割帳戶餘額，更新 Google Sheet 銀行系統餘額"""
    result = api.account_balance()
    if result.status.value != 'Fetched':
        print(f'查詢餘額失敗：{result.errmsg}')
        return

    balance = result.acc_balance

    try:
        ws = sh.worksheet('銀行系統餘額')
    except gspread.WorksheetNotFound:
        print('找不到「銀行系統餘額」工作表')
        return

    # 找到永豐大戶那一列
    rows = ws.col_values(1)
    for i, name in enumerate(rows):
        if '永豐' in name:
            ws.update_cell(i + 1, 3, balance)
            print(f'永豐銀行餘額已更新：{balance}')
            return

    print('找不到永豐大戶的列')


def main():
    config = load_config()
    api = login_sinopac(config)
    try:
        sh = open_spreadsheet(config)
        positions, rows = fetch_positions(api)
        write_positions_to_sheet(sh, rows)
        print(f'庫存同步完成，共 {len(rows)} 筆')
        sync_trade_records(sh, api, positions)
        sync_bank_balance(sh, api)
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
