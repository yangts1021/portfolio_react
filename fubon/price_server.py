"""本機台股即時價格伺服器

用 fubon_neo SDK 的行情模組取得盤中即時報價，
提供 HTTP API 給 portfolio_react 前端使用。

啟動方式：
    ./venv/bin/python price_server.py [--port 8787]

API：
    GET /health                     -> {"ok": true, "loggedIn": true}
    GET /quotes?symbols=2330,0050   -> {"source": "fubon", "prices": {"2330": 1080.0, ...}}
"""

import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from fubon_neo.sdk import FubonSDK, Mode

CACHE_TTL = 5  # 秒，同一標的報價快取時間，避免打爆行情 API


def load_config():
    config_path = Path(__file__).parent / 'config.json'
    if not config_path.exists():
        print('錯誤：找不到 config.json，請複製 config.example.json 並填入設定')
        sys.exit(1)
    with open(config_path, encoding='utf-8') as f:
        return json.load(f)


class QuoteService:
    """管理 SDK 登入與報價查詢，含快取與斷線重連"""

    def __init__(self, config):
        self.config = config['fubon']
        self.sdk = None
        self.rest_stock = None
        self.lock = threading.Lock()
        self.cache = {}  # symbol -> (timestamp, price)

    def login(self):
        sdk = FubonSDK()
        accounts = sdk.apikey_login(
            self.config['id'],
            self.config['api_key'],
            self.config['cert_path'],
            self.config.get('cert_password', ''),
        )
        if not accounts.is_success:
            raise RuntimeError(f'富邦登入失敗：{accounts.message}')
        sdk.init_realtime(Mode.Speed)
        self.sdk = sdk
        self.rest_stock = sdk.marketdata.rest_client.stock
        print('富邦 SDK 登入成功，行情連線就緒')

    def _query_price(self, symbol):
        quote = self.rest_stock.intraday.quote(symbol=symbol)
        if not isinstance(quote, dict):
            return None
        # 盤中最後成交價，未成交時退回試撮/昨收
        for key in ('closePrice', 'lastPrice', 'previousClose'):
            price = quote.get(key)
            if isinstance(price, (int, float)) and price > 0:
                return float(price)
        last_trade = quote.get('lastTrade') or {}
        price = last_trade.get('price')
        if isinstance(price, (int, float)) and price > 0:
            return float(price)
        return None

    def get_prices(self, symbols):
        prices = {}
        errors = {}
        now = time.time()
        with self.lock:
            for symbol in symbols:
                symbol = symbol.strip().upper()
                if not symbol:
                    continue
                cached = self.cache.get(symbol)
                if cached and now - cached[0] < CACHE_TTL:
                    prices[symbol] = cached[1]
                    continue
                try:
                    price = self._query_price(symbol)
                except Exception as e:
                    # 行情連線失效時重登一次再試
                    try:
                        self.login()
                        price = self._query_price(symbol)
                    except Exception as e2:
                        errors[symbol] = str(e2) or str(e)
                        continue
                if price is None:
                    errors[symbol] = 'no price'
                    continue
                self.cache[symbol] = (time.time(), price)
                prices[symbol] = price
        return prices, errors


service = None


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        # Chrome Private Network Access：允許 https 頁面呼叫 localhost
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/health':
            self._send_json({'ok': True, 'loggedIn': service.sdk is not None})
            return
        if parsed.path == '/quotes':
            params = parse_qs(parsed.query)
            raw = params.get('symbols', [''])[0]
            symbols = [s for s in raw.split(',') if s.strip()]
            if not symbols:
                self._send_json({'error': 'symbols 參數不可為空'}, status=400)
                return
            prices, errors = service.get_prices(symbols)
            result = {'source': 'fubon', 'time': int(time.time()), 'prices': prices}
            if errors:
                result['errors'] = errors
            self._send_json(result)
            return
        self._send_json({'error': 'not found'}, status=404)

    def log_message(self, fmt, *args):
        print(f'[{time.strftime("%H:%M:%S")}] {fmt % args}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8787)
    args = parser.parse_args()

    global service
    service = QuoteService(load_config())
    service.login()

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'價格伺服器啟動：http://127.0.0.1:{args.port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n停止伺服器')


if __name__ == '__main__':
    main()
