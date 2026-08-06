"""pipeline 共用工具：設定載入、Google Sheet 連線、工作表存取。

三支腳本（sync_fubon / sync_sinopac / fetch_prices）共用同一份 config.json
與同一個 venv，這裡放它們重複的部分。
"""

import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import gspread
from google.oauth2.service_account import Credentials

BASE = Path(__file__).resolve().parent
CONFIG_PATH = BASE / 'config.json'

TPE = ZoneInfo('Asia/Taipei')

SCOPES = ['https://www.googleapis.com/auth/spreadsheets']


def load_config():
    """讀取 pipeline/config.json"""
    if not CONFIG_PATH.exists():
        print('錯誤：找不到 config.json，請複製 config.example.json 並填入設定', file=sys.stderr)
        sys.exit(1)
    with open(CONFIG_PATH, encoding='utf-8') as f:
        return json.load(f)


def resolve_path(path):
    """設定檔的路徑允許相對於 pipeline/ 撰寫"""
    p = Path(path)
    return p if p.is_absolute() else BASE / p


def open_spreadsheet(config):
    """建立 Google Sheet 連線，回傳 spreadsheet 物件"""
    creds = Credentials.from_service_account_file(
        str(resolve_path(config['google_sheet']['credentials_path'])),
        scopes=SCOPES,
    )
    gc = gspread.authorize(creds)
    return gc.open_by_key(config['google_sheet']['spreadsheet_id'])


def get_or_create_worksheet(sh, title, header=None):
    """取得工作表，不存在就建立；建立時可一併寫入標題列"""
    try:
        return sh.worksheet(title)
    except gspread.WorksheetNotFound:
        cols = len(header) if header else 10
        ws = sh.add_worksheet(title, rows=100, cols=cols)
        if header:
            ws.update([header], value_input_option='RAW')
        return ws


def enum_name(val):
    """安全取得 enum 的 name，非 enum 則轉字串"""
    return val.name if hasattr(val, 'name') else str(val)
