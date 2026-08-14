"""prices.db 的結構與連線。

即時報價快取與歷史日線都放這裡，抓價（fetch_prices）、回補（backfill_history）
與淨值重算（build_history）三支腳本共用。
"""

import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / 'prices.db'

SCHEMA = """
CREATE TABLE IF NOT EXISTS quote_latest (
    symbol      TEXT PRIMARY KEY,
    market      TEXT NOT NULL,
    name        TEXT,
    price       REAL NOT NULL,
    prev_close  REAL,
    source      TEXT NOT NULL,
    quote_ts    TEXT NOT NULL,
    fetched_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_history (
    symbol      TEXT NOT NULL,
    price       REAL NOT NULL,
    prev_close  REAL,
    source      TEXT NOT NULL,
    quote_ts    TEXT NOT NULL,
    PRIMARY KEY (symbol, quote_ts)
);

-- 記住台股代號屬上市(tse)或上櫃(otc)，之後只查正確的那一邊
CREATE TABLE IF NOT EXISTS tw_symbol_market (
    symbol  TEXT PRIMARY KEY,
    ex      TEXT NOT NULL
);

-- 每日收盤，畫資產曲線用。盤中每輪會覆寫當日，收盤後最後一輪即為收盤價
CREATE TABLE IF NOT EXISTS daily_close (
    symbol  TEXT NOT NULL,
    date    TEXT NOT NULL,   -- YYYY-MM-DD
    close   REAL NOT NULL,
    source  TEXT NOT NULL,   -- fubon / twse_mis / yfinance / yfinance_hist
    PRIMARY KEY (symbol, date)
);

-- 每日匯率。美股部位要用「當日」匯率換算，否則會把匯率變動誤算成投資損益
CREATE TABLE IF NOT EXISTS daily_fx (
    date    TEXT PRIMARY KEY,  -- YYYY-MM-DD
    usdtwd  REAL NOT NULL,
    source  TEXT NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    """開啟 prices.db 並確保結構存在"""
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def upsert_daily_close(conn, rows) -> int:
    """rows: iterable of (symbol, date, close, source)"""
    rows = list(rows)
    conn.executemany(
        """INSERT INTO daily_close (symbol, date, close, source)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(symbol, date) DO UPDATE SET
               close=excluded.close, source=excluded.source""",
        rows,
    )
    conn.commit()
    return len(rows)


def upsert_daily_fx(conn, rows) -> int:
    """rows: iterable of (date, usdtwd, source)"""
    rows = list(rows)
    conn.executemany(
        """INSERT INTO daily_fx (date, usdtwd, source)
           VALUES (?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET
               usdtwd=excluded.usdtwd, source=excluded.source""",
        rows,
    )
    conn.commit()
    return len(rows)
