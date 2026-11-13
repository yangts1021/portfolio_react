// 價格來源：本機 pipeline/fetch_prices.py 定期抓價（台股富邦 → TWSE MIS → 快取，美股 yfinance），
// 寫入 Supabase `quotes`，網頁直接讀那張表（utils/db.ts 的 loadQuotes）。

// 每檔報價的出處，持倉明細用來標示來源與報價時間
export interface PriceQuoteMeta {
  source: string; // fubon / twse_mis / yfinance / cache
  prevClose?: number; // 前一交易日收盤，今日損益的基準
  quoteTs?: string; // 交易所產生這個價格的時間
  fetchedAt?: string; // pipeline 這一輪寫入的時間；判斷抓價程式是否還在跑要看這個
}

// 單檔來源顯示用的短標籤
export const QUOTE_SOURCE_LABEL: Record<string, string> = {
  fubon: '富邦',
  twse_mis: 'TWSE',
  yfinance: 'yfinance',
  cache: '快取',
  googlefinance: 'Sheet',
};

export const quoteSourceLabel = (source?: string): string =>
  (source && QUOTE_SOURCE_LABEL[source]) || source || '';

// 台股交易時段（含開盤前試撮與收盤後緩衝）：平日 08:55–14:00
export const isTwMarketHours = (): boolean => {
  const now = new Date();
  const taipei = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const day = taipei.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = taipei.getHours() * 60 + taipei.getMinutes();
  return minutes >= 8 * 60 + 55 && minutes <= 14 * 60;
};

// 美股常規盤換算台北時間：夏令 21:30–04:00、冬令 22:30–05:00，取聯集
export const isUsMarketHours = (): boolean => {
  const now = new Date();
  const taipei = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const day = taipei.getDay();
  const minutes = taipei.getHours() * 60 + taipei.getMinutes();
  if (day === 0) return false;
  if (day === 6 && minutes > 5 * 60) return false;
  return minutes >= 21 * 60 + 30 || minutes <= 5 * 60;
};

export const isMarketHours = (): boolean => isTwMarketHours() || isUsMarketHours();

// --------------------------------------------------------------------------- //
// 報價新鮮度
// --------------------------------------------------------------------------- //

// 抓價每 3 分鐘一輪、網頁每 60 秒重讀，正常情況最多落後約 4 分鐘
export const QUOTE_FRESH_MINUTES = 6;
export const QUOTE_DELAYED_MINUTES = 15;

// live 即時 / delayed 落後 / stale 過舊（抓價程式可能停了）/ closed 休市 / unknown 還沒有資料
export type QuoteFreshnessLevel = 'live' | 'delayed' | 'stale' | 'closed' | 'unknown';

export interface QuoteFreshness {
  level: QuoteFreshnessLevel;
  updatedAt: Date | null; // 自動報價標的中最舊的一筆寫入時間
  ageMinutes: number | null;
  cacheSymbols: string[]; // 這一輪抓不到、沿用最後已知價
  missingSymbols: string[]; // 應該有自動報價卻沒有紀錄
  manualSymbols: string[]; // pipeline 不抓的幣別（HKD / JPY）
}

// 以「最舊的一筆」為準：只要有一檔沒跟上，損益就不是當下的數字
export const summarizeQuoteFreshness = (
  holdings: { symbol: string; currency: string }[],
  meta: Record<string, PriceQuoteMeta>,
  now: Date = new Date(),
  marketOpen: boolean = isMarketHours(),
): QuoteFreshness => {
  const cacheSymbols: string[] = [];
  const missingSymbols: string[] = [];
  const manualSymbols: string[] = [];
  let oldest: number | null = null;

  holdings.forEach(({ symbol, currency }) => {
    if (currency !== 'TWD' && currency !== 'USD') {
      manualSymbols.push(symbol);
      return;
    }
    const m = meta[symbol];
    const t = m?.fetchedAt ? new Date(m.fetchedAt).getTime() : NaN;
    if (isNaN(t)) {
      missingSymbols.push(symbol);
      return;
    }
    if (m.source === 'cache') cacheSymbols.push(symbol);
    if (oldest === null || t < oldest) oldest = t;
  });

  if (oldest === null) {
    return {
      level: 'unknown',
      updatedAt: null,
      ageMinutes: null,
      cacheSymbols,
      missingSymbols,
      manualSymbols,
    };
  }

  const ageMinutes = Math.max(0, (now.getTime() - oldest) / 60000);
  let level: QuoteFreshnessLevel = 'closed';
  if (marketOpen) {
    if (ageMinutes <= QUOTE_FRESH_MINUTES) level = 'live';
    else if (ageMinutes <= QUOTE_DELAYED_MINUTES) level = 'delayed';
    else level = 'stale';
  }
  return {
    level,
    updatedAt: new Date(oldest),
    ageMinutes,
    cacheSymbols,
    missingSymbols,
    manualSymbols,
  };
};

// 「3 分鐘前」「2 小時前」「4 天前」
export const formatAge = (minutes: number): string => {
  if (minutes < 1) return '不到 1 分鐘前';
  if (minutes < 60) return `${Math.floor(minutes)} 分鐘前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} 小時前`;
  return `${Math.floor(minutes / (60 * 24))} 天前`;
};

// --------------------------------------------------------------------------- //
// 今日損益
// --------------------------------------------------------------------------- //

// 報價所屬的交易日（YYYY-MM-DD，市場當地日期）。
// 不能直接拿報價時間的日期：美股報價在台北白天也會被重抓，時間是「現在」，
// 但價格其實是前一個交易時段的收盤。開盤前與週末一律往回推到最近一個交易日（不含國定假日）。
export const quoteSessionDate = (ts: string | Date, currency: string): string | null => {
  const at = new Date(ts);
  if (isNaN(at.getTime())) return null;
  const us = currency === 'USD';
  const local = new Date(
    at.toLocaleString('en-US', { timeZone: us ? 'America/New_York' : 'Asia/Taipei' }),
  );
  const openMinutes = us ? 9 * 60 + 30 : 9 * 60;
  if (local.getHours() * 60 + local.getMinutes() < openMinutes) {
    local.setDate(local.getDate() - 1);
  }
  while (local.getDay() === 0 || local.getDay() === 6) local.setDate(local.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
};

export interface DayPnL {
  pnl: number; // 原幣
  pnlTWD: number;
  baseTWD: number; // 今天的起算金額：開盤前持股以昨收計 + 今天買進的成本
  pct: number | null; // pnl / base
}

export interface DayPnLSummary {
  bySymbol: Record<string, DayPnL>;
  totalTWD: number;
  pct: number | null;
  missingSymbols: string[]; // 沒有昨收，算不出今日損益
}

// 今日損益 = 現有市值 − 開盤前持股×昨收 − 今天買進成本 + 今天賣出所得。
// 只用「現價 − 昨收」乘上現有股數的話，今天才買的部位會被多算一段昨收到買價的假損益。
export const calculateDayPnL = (
  holdings: { symbol: string; currency: string; inventory: number; currentPrice: number }[],
  transactions: {
    symbol: string;
    date: string;
    action: string;
    qty: number;
    price: number;
  }[],
  meta: Record<string, PriceQuoteMeta>,
  rates: Record<string, number>,
): DayPnLSummary => {
  const bySymbol: Record<string, DayPnL> = {};
  const missingSymbols: string[] = [];
  let totalTWD = 0;
  let baseTotalTWD = 0;

  holdings.forEach((h) => {
    const m = meta[h.symbol];
    const prev = m?.prevClose;
    if (!prev || !(prev > 0) || !(h.currentPrice > 0)) {
      missingSymbols.push(h.symbol);
      return;
    }
    const session = quoteSessionDate(m.fetchedAt || m.quoteTs || '', h.currency);
    let boughtQty = 0;
    let boughtCost = 0;
    let soldQty = 0;
    let soldProceeds = 0;
    if (session) {
      transactions.forEach((tx) => {
        if (String(tx.symbol).toUpperCase() !== h.symbol || tx.date !== session) return;
        if (tx.action === 'BUY') {
          boughtQty += tx.qty;
          boughtCost += tx.qty * tx.price;
        } else {
          soldQty += tx.qty;
          soldProceeds += tx.qty * tx.price;
        }
      });
    }
    const heldAtOpen = Math.max(0, h.inventory - boughtQty + soldQty);
    const base = heldAtOpen * prev + boughtCost;
    const pnl = h.inventory * h.currentPrice + soldProceeds - base;
    const rate = rates[h.currency] || 1;
    bySymbol[h.symbol] = {
      pnl,
      pnlTWD: pnl * rate,
      baseTWD: base * rate,
      pct: base > 0 ? (pnl / base) * 100 : null,
    };
    totalTWD += pnl * rate;
    baseTotalTWD += base * rate;
  });

  return {
    bySymbol,
    totalTWD,
    pct: baseTotalTWD > 0 ? (totalTWD / baseTotalTWD) * 100 : null,
    missingSymbols,
  };
};
