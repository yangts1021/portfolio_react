"""分割事件的共用邏輯：哪些已生效、下載回來的歷史收盤是不是已經換算成分割後單位。

build_history 假設 source = yfinance_hist 的收盤都是「現行單位」（Yahoo 會回溯調整分割）。
這個假設在新增分割事件的當下會破掉，有兩種情況：

1. prices.db 裡的歷史收盤是分割前下載的，當時 Yahoo 還沒調整，數字是分割前的價格。
2. Yahoo 對台股 ETF 的調整常慢幾天，分割後重新下載拿到的還是分割前的價格。

兩種情況下 build_history 都會拿「乘過比例的股數 × 沒除過比例的價格」，
那一檔在分割前的市值會被放大成比例倍（1 拆 5 就是 5 倍），損益曲線整段失真。
"""

from __future__ import annotations

from datetime import date, timedelta

# 生效日在這段期間內的分割，回補時整檔重新下載，把分割前下載的舊收盤換掉
REFETCH_DAYS = 60

# 往生效日前找價格跳動的範圍（涵蓋 ETF 分割前的停牌期間與 Yahoo 半調整的區段）
SEARCH_DAYS = 30

# 相鄰兩筆收盤倍數落在 比例 ÷ TOLERANCE ~ 比例 × TOLERANCE 之間，視為尚未調整
TOLERANCE = 1.5


def effective(splits: dict[str, list[tuple[str, float]]], today: str | None = None):
    """只留已生效的分割。生效日還沒到的不能先套用：價格還是分割前的"""
    today = today or date.today().isoformat()
    out = {}
    for symbol, events in splits.items():
        kept = [(eff, ratio) for eff, ratio in events if eff <= today and ratio > 0]
        if kept:
            out[symbol] = kept
    return out


def recently_split(events: list[tuple[str, float]], today: str | None = None) -> bool:
    """這一檔是否在 REFETCH_DAYS 內有分割生效"""
    today_d = date.fromisoformat(today) if today else date.today()
    floor = (today_d - timedelta(days=REFETCH_DAYS)).isoformat()
    return any(floor <= eff <= today_d.isoformat() for eff, _ in events)


def to_current_units(closes, events, later_close=None):
    """把 [(日期, 收盤)] 換算成現行單位，回傳 (新序列, 套用了哪些分割)。

    對每個分割，從生效日往前找相鄰兩筆收盤的倍數接近分割比例的地方，把那之前的
    收盤全部除以比例。已經調整過的序列找不到這種跳動，不會被動到，所以重複執行是
    安全的。

    不能只比生效日前後兩筆：Yahoo 有時只調整了一半，例如 00662 在 2026-11-17 生效，
    Yahoo 把 11/9 之後（含停牌期間補的價格）除了 5，11/6 以前卻還是分割前的價格，
    跳動出現在 11/6 → 11/9，生效日前後兩筆的倍數是 1。

    later_close(生效日) 用來在下載區間還沒有生效日之後的資料時，改拿 prices.db 裡
    盤中記下的價格來比。
    """
    closes = sorted(closes)
    applied = []
    for eff, ratio in sorted(events):
        # 比例太接近 1 時跟一般漲跌分不出來，不處理
        if not ratio > 0 or 1 / TOLERANCE < ratio < TOLERANCE:
            continue
        series = list(closes)
        if not any(d >= eff for d, _ in series) and later_close:
            extra = later_close(eff)
            if extra:
                series.append((eff, extra))
        floor = (date.fromisoformat(eff) - timedelta(days=SEARCH_DAYS)).isoformat()
        cut = None
        # 從生效日起第一筆往前，找最靠近生效日的跳動
        start = next((i for i, (d, _) in enumerate(series) if d >= eff), len(series) - 1)
        for i in range(start, 0, -1):
            if series[i][0] < floor:
                break
            prev, cur = series[i - 1][1], series[i][1]
            if cur and ratio / TOLERANCE < prev / cur < ratio * TOLERANCE:
                cut = series[i][0]
                break
        if cut:
            closes = [(d, c / ratio if d < cut else c) for d, c in closes]
            applied.append((eff, ratio))
    return closes, applied
