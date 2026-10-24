// 價格來源：本機 pipeline/fetch_prices.py 定期抓價（台股富邦 → TWSE MIS → 快取，美股 yfinance），
// 寫入 Supabase `quotes`，網頁直接讀那張表（utils/db.ts 的 loadQuotes）。

// 每檔報價的出處，持倉明細用來標示來源與報價時間
export interface PriceQuoteMeta {
  source: string; // fubon / twse_mis / yfinance / cache
  quoteTs?: string;
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
