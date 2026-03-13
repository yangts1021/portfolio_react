import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials
from fubon_neo.sdk import FubonSDK


def load_config():
    """讀取 config.json"""
    config_path = Path(__file__).parent / 'config.json'
    if not config_path.exists():
        print('錯誤：找不到 config.json，請複製 config.example.json 並填入設定')
        sys.exit(1)
    with open(config_path, encoding='utf-8') as f:
        return json.load(f)


def login_fubon(config):
    """用 API Key 登入富邦 SDK，回傳 (sdk, account)"""
    cfg = config['fubon']
    sdk = FubonSDK()
    accounts = sdk.apikey_login(
        cfg['id'],
        cfg['api_key'],
        cfg['cert_path'],
        cfg.get('cert_password', ''),
    )
    if not accounts.is_success:
        print(f'登入失敗：{accounts.message}')
        sys.exit(1)
    return sdk, accounts.data[0]


def fetch_inventories(sdk, account):
    """查詢庫存，回傳結果"""
    result = sdk.accounting.inventories(account)
    if not result.is_success:
        print(f'查詢庫存失敗：{result.message}')
        sys.exit(1)
    return result.data


def fetch_unrealized_pnl(sdk, account):
    """查詢未實現損益，回傳 dict[stock_no -> item]"""
    result = sdk.accounting.unrealized_gains_and_loses(account)
    if not result.is_success:
        print(f'查詢未實現損益失敗：{result.message}')
        sys.exit(1)
    pnl_map = {}
    for item in result.data:
        pnl_map[item.stock_no] = item
    return pnl_map


def merge_data(inventories, unrealized):
    """合併庫存 + 未實現損益，產生寫入 Sheet 的資料"""
    rows = []
    for inv in inventories:
        pnl = unrealized.get(inv.stock_no, None)
        if pnl:
            cost_price = pnl.cost_price
            unrealized_pnl = pnl.unrealized_profit + pnl.unrealized_loss
        else:
            cost_price = 0
            unrealized_pnl = 0
        rows.append([
            inv.stock_no,
            inv.today_qty,
            cost_price,
            unrealized_pnl,
        ])
    return rows


def _enum_name(val):
    """安全取得 enum 的 name，非 enum 則轉字串"""
    return val.name if hasattr(val, 'name') else str(val)


def open_spreadsheet(config):
    """建立 Google Sheet 連線，回傳 spreadsheet 物件"""
    creds = Credentials.from_service_account_file(
        config['google_sheet']['credentials_path'],
        scopes=['https://www.googleapis.com/auth/spreadsheets'],
    )
    gc = gspread.authorize(creds)
    return gc.open_by_key(config['google_sheet']['spreadsheet_id'])


def write_positions_to_sheet(sh, rows):
    """寫入庫存到 Google Sheet「富邦庫存」工作表"""
    try:
        ws = sh.worksheet('富邦庫存')
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet('富邦庫存', rows=100, cols=10)

    ws.clear()
    header = ['代碼', '庫存股數', '成本價', '未實現損益']
    ws.update([header] + rows, value_input_option='RAW')


def sync_trade_records(sh, sdk, account):
    """查詢近 30 天成交歷史，同步到 Google Sheet「富邦交易紀錄」，只新增不重複的紀錄"""
    header = ['成交日期', '代碼', '買賣', '成交價', '成交股數', '委託序號']

    try:
        ws = sh.worksheet('富邦交易紀錄')
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet('富邦交易紀錄', rows=100, cols=len(header))
        ws.update([header])

    # 查詢近 30 天成交紀錄
    end_date = datetime.now().strftime('%Y%m%d')
    start_date = (datetime.now() - timedelta(days=30)).strftime('%Y%m%d')
    result = sdk.stock.filled_history(account, start_date, end_date)
    if not result.is_success:
        print(f'查詢成交歷史失敗：{result.message}')
        return

    if not result.data:
        print('富邦交易紀錄：近 30 天無成交')
        return

    # 讀取既有資料做去重（用所有欄位組成 key 避免遺漏）
    existing = ws.get_all_values()
    existing_keys = set()
    for row in existing[1:]:
        existing_keys.add(tuple(row))

    to_append = []
    for item in result.data:
        # 動態取得所有欄位（首次執行時會印出欄位供確認）
        attrs = sorted([a for a in dir(item) if not a.startswith('_')])
        row = [str(getattr(item, a)) for a in attrs]
        if tuple(row) not in existing_keys:
            to_append.append(row)

    # 首次有資料時，用實際欄位名更新表頭
    if to_append:
        attrs = sorted([a for a in dir(result.data[0]) if not a.startswith('_')])
        current_header = ws.row_values(1)
        if current_header != attrs:
            ws.update([attrs], value_input_option='RAW')

        ws.append_rows(to_append, value_input_option='RAW')
        print(f'富邦交易紀錄：新增 {len(to_append)} 筆')
    else:
        print('富邦交易紀錄：無新資料')


def sync_position_snapshot(sh, unrealized_data):
    """將未實現損益快照同步到 Google Sheet「富邦持倉快照」，每日一筆"""
    header = ['日期', '代碼', '方向', '庫存股數', '成本價', '未實現獲利', '未實現虧損', '交易類型']

    try:
        ws = sh.worksheet('富邦持倉快照')
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet('富邦持倉快照', rows=100, cols=len(header))
        ws.update([header])

    existing = ws.get_all_values()
    existing_keys = set()
    for row in existing[1:]:
        if len(row) >= 2:
            existing_keys.add((row[0], row[1]))

    to_append = []
    for item in unrealized_data:
        key = (str(item.date), str(item.stock_no))
        if key not in existing_keys:
            to_append.append([
                str(item.date),
                item.stock_no,
                _enum_name(item.buy_sell),
                item.today_qty,
                float(item.cost_price),
                float(item.unrealized_profit),
                float(item.unrealized_loss),
                _enum_name(item.order_type),
            ])

    if to_append:
        ws.append_rows(to_append, value_input_option='RAW')
        print(f'富邦持倉快照：新增 {len(to_append)} 筆')
    else:
        print('富邦持倉快照：無新資料')


def main():
    config = load_config()
    sdk, account = login_fubon(config)
    sh = open_spreadsheet(config)
    inventories = fetch_inventories(sdk, account)
    unrealized = fetch_unrealized_pnl(sdk, account)
    rows = merge_data(inventories, unrealized)
    write_positions_to_sheet(sh, rows)
    print(f'庫存同步完成，共 {len(rows)} 筆')
    sync_trade_records(sh, sdk, account)
    sync_position_snapshot(sh, unrealized.values())


if __name__ == '__main__':
    main()
