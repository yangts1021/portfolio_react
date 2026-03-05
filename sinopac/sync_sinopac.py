import json
import sys
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials
import shioaji as sj


def load_config():
    """讀取 config.json"""
    config_path = Path(__file__).parent / 'config.json'
    if not config_path.exists():
        print('錯誤：找不到 config.json，請複製 config.example.json 並填入設定')
        sys.exit(1)
    with open(config_path, encoding='utf-8') as f:
        return json.load(f)


def login_sinopac(config):
    """用 API Key 登入永豐 Shioaji，回傳 api 物件"""
    cfg = config['sinopac']
    api = sj.Shioaji()
    accounts = api.login(cfg['api_key'], cfg['secret_key'])
    if not accounts:
        print('登入失敗：請確認 API Key 和 Secret Key')
        sys.exit(1)
    print(f'登入成功，帳號數：{len(accounts)}')
    return api


def fetch_positions(api):
    """查詢股票庫存，回傳寫入 Sheet 的資料列"""
    positions = api.list_positions(api.stock_account)
    rows = []
    for pos in positions:
        rows.append([
            pos.code,
            pos.quantity,
            pos.price,
            pos.last_price,
            pos.pnl,
        ])
    return rows


def write_to_sheet(config, rows):
    """用 gspread 寫入 Google Sheet「永豐庫存」工作表"""
    creds = Credentials.from_service_account_file(
        config['google_sheet']['credentials_path'],
        scopes=['https://www.googleapis.com/auth/spreadsheets'],
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(config['google_sheet']['spreadsheet_id'])

    try:
        ws = sh.worksheet('永豐庫存')
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet('永豐庫存', rows=100, cols=10)

    ws.clear()
    header = ['代碼', '庫存股數', '成本均價', '現價', '未實現損益']
    ws.update([header] + rows)


def main():
    config = load_config()
    api = login_sinopac(config)
    rows = fetch_positions(api)
    write_to_sheet(config, rows)
    print(f'同步完成，共 {len(rows)} 筆')
    api.logout()


if __name__ == '__main__':
    main()
