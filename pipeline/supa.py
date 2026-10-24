"""Supabase 精簡 client：直接打 PostgREST 與 Auth admin API。

用已安裝的 requests，不另外引入 supabase-py。pipeline 一律使用 service_role key，
會略過 RLS，所以這把 key 只能放在本機的 config.json，絕不能進前端。
"""

import sys

import requests

CHUNK = 500  # 單次寫入筆數；daily_close 有上萬筆，分批避免請求過大
PAGE = 1000  # PostgREST 預設單次回傳上限


class SupabaseError(RuntimeError):
    pass


class Supabase:
    def __init__(self, url: str, service_key: str):
        self.url = url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'application/json',
        })

    def _check(self, res: requests.Response, what: str) -> requests.Response:
        if not res.ok:
            raise SupabaseError(f'{what} 失敗 (HTTP {res.status_code})：{res.text[:500]}')
        return res

    def _rest(self, table: str) -> str:
        return f'{self.url}/rest/v1/{table}'

    def select(self, table: str, params: dict | None = None) -> list[dict]:
        """讀取整張表（自動分頁）。params 用 PostgREST 語法，如 {'book_id': 'eq.<uuid>'}"""
        rows: list[dict] = []
        offset = 0
        while True:
            # 呼叫端給的 limit 優先；筆數少於 PAGE 時迴圈自然結束
            query = {'limit': PAGE, 'offset': offset, **(params or {})}
            res = self._check(self.session.get(self._rest(table), params=query), f'讀取 {table}')
            batch = res.json()
            rows.extend(batch)
            if len(batch) < PAGE:
                return rows
            offset += PAGE

    def insert(self, table: str, rows: list[dict], returning: bool = False) -> list[dict]:
        prefer = 'return=representation' if returning else 'return=minimal'
        out: list[dict] = []
        for i in range(0, len(rows), CHUNK):
            res = self._check(
                self.session.post(
                    self._rest(table), json=rows[i : i + CHUNK], headers={'Prefer': prefer}
                ),
                f'寫入 {table}',
            )
            if returning:
                out.extend(res.json())
        return out

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        """依 on_conflict 欄位合併：已存在就更新，不存在就新增"""
        for i in range(0, len(rows), CHUNK):
            self._check(
                self.session.post(
                    self._rest(table),
                    params={'on_conflict': on_conflict},
                    json=rows[i : i + CHUNK],
                    headers={'Prefer': 'resolution=merge-duplicates,return=minimal'},
                ),
                f'寫入 {table}',
            )

    def update(self, table: str, filters: dict, data: dict) -> list[dict]:
        """依條件更新部分欄位，回傳被更新的列"""
        if not filters:
            raise ValueError('update 必須指定條件')
        res = self._check(
            self.session.patch(
                self._rest(table), params=filters, json=data,
                headers={'Prefer': 'return=representation'},
            ),
            f'更新 {table}',
        )
        return res.json()

    def delete(self, table: str, filters: dict) -> None:
        """PostgREST 要求 DELETE 一定要帶條件，避免誤刪整張表"""
        if not filters:
            raise ValueError('delete 必須指定條件')
        self._check(self.session.delete(self._rest(table), params=filters), f'刪除 {table}')

    def find_user_id(self, email: str) -> str | None:
        """用 Auth admin API 依 email 找使用者 id"""
        page = 1
        while True:
            res = self._check(
                self.session.get(
                    f'{self.url}/auth/v1/admin/users', params={'page': page, 'per_page': 200}
                ),
                '查詢使用者',
            )
            users = res.json().get('users', [])
            for user in users:
                if str(user.get('email', '')).lower() == email.lower():
                    return user['id']
            if len(users) < 200:
                return None
            page += 1


def from_config(config: dict) -> Supabase:
    cfg = config.get('supabase') or {}
    if not cfg.get('url') or not cfg.get('service_role_key'):
        print('錯誤：config.json 缺少 supabase.url 或 supabase.service_role_key', file=sys.stderr)
        sys.exit(1)
    return Supabase(cfg['url'], cfg['service_role_key'])


# --------------------------------------------------------------------------- #
# pipeline 共用的讀取
# --------------------------------------------------------------------------- #

def list_books(client: Supabase, only: str | None = None) -> list[dict]:
    """回傳 [{id, name}]，依建立順序。only 指定帳本名稱，找不到就結束程式"""
    books = client.select('books', {'select': 'id,name', 'order': 'created_at'})
    if only:
        books = [b for b in books if b['name'] == only]
        if not books:
            print(f'錯誤：Supabase 找不到帳本「{only}」', file=sys.stderr)
            sys.exit(1)
    return books


def load_transactions(client: Supabase, book_id: str | None = None) -> list[dict]:
    """回傳 [{date, symbol, action, qty, price, currency}]，依日期排序。book_id 為空則取全部帳本"""
    params = {'select': 'trade_date,symbol,action,qty,price,currency', 'order': 'trade_date,id'}
    if book_id:
        params['book_id'] = f'eq.{book_id}'
    return [
        {
            'date': r['trade_date'],
            'symbol': r['symbol'],
            'action': r['action'],
            'qty': float(r['qty']),
            'price': float(r['price']),
            'currency': r['currency'],
        }
        for r in client.select('transactions', params)
    ]


def load_pledged_symbols(client: Supabase, book_id: str | None = None) -> set[str]:
    params = {'select': 'symbol'}
    if book_id:
        params['book_id'] = f'eq.{book_id}'
    return {r['symbol'] for r in client.select('pledges', params)}


def load_splits(client: Supabase) -> dict[str, list[tuple[str, float]]]:
    """回傳 {代號: [(生效日, 比例), ...]}。分割事件是所有帳本共用的"""
    splits: dict[str, list[tuple[str, float]]] = {}
    for r in client.select('split_events', {'select': 'symbol,effective_date,ratio'}):
        splits.setdefault(r['symbol'], []).append((r['effective_date'], float(r['ratio'])))
    return splits


def update_auto_bank(client: Supabase, book_id: str, source: str, twd: float) -> str | None:
    """更新帳本中 auto_source = source 那一列的 TWD，回傳銀行名稱；沒有標記的列回傳 None。

    依 auto_source 欄位找列而不是比對名稱（見 supabase/migrations/0002），
    每本帳本每個來源最多一列，由唯一索引保證。
    """
    updated = client.update(
        'bank_accounts',
        {'book_id': f'eq.{book_id}', 'auto_source': f'eq.{source}'},
        {'twd': twd},
    )
    return updated[0]['bank'] if updated else None
