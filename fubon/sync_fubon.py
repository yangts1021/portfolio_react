import json
import sys
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


def write_to_sheet(config, rows):
    """用 gspread 寫入 Google Sheet「富邦庫存」工作表"""
    creds = Credentials.from_service_account_file(
        config['google_sheet']['credentials_path'],
        scopes=['https://www.googleapis.com/auth/spreadsheets'],
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(config['google_sheet']['spreadsheet_id'])

    # 取得或建立工作表
    try:
        ws = sh.worksheet('富邦庫存')
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet('富邦庫存', rows=100, cols=10)

    # 清除舊資料，寫入標題 + 新資料
    ws.clear()
    header = ['代碼', '庫存股數', '成本價', '未實現損益']
    ws.update([header] + rows)


def main():
    config = load_config()
    sdk, account = login_fubon(config)
    inventories = fetch_inventories(sdk, account)
    unrealized = fetch_unrealized_pnl(sdk, account)
    rows = merge_data(inventories, unrealized)
    write_to_sheet(config, rows)
    print(f'同步完成，共 {len(rows)} 筆')


if __name__ == '__main__':
    main()
