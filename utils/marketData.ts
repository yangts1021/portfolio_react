// 價格來源：本機 pipeline/fetch_prices.py 定期抓價（台股富邦、美股 yfinance）
// 寫入 Google Sheet「即時報價」，網頁透過 GAS 讀那張表。
// GAS 讀不到時會自行退回 TWSE MIS，再退回 GOOGLEFINANCE 價格。

export type PriceSource = 'live' | 'twse' | 'sheet';

export interface PriceResult {
  prices: Record<string, number>;
  source: PriceSource | null;
  updatedAt?: string;
}

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  live: '即時報價',
  twse: 'TWSE',
  sheet: 'Sheet 延遲價',
};

export const fetchPrices = async (symbols: string[], gasUrl: string): Promise<PriceResult> => {
  if (symbols.length === 0 || !gasUrl) return { prices: {}, source: null };
  const query = encodeURIComponent(symbols.join(','));

  try {
    const res = await fetch(`${gasUrl}?type=twPrices&symbols=${query}`);
    if (res.ok) {
      const json = await res.json();
      if (json.twPrices && Object.keys(json.twPrices).length > 0) {
        const source: PriceSource =
          json.twSource === 'live' ? 'live' : json.twSource === 'sheet' ? 'sheet' : 'twse';
        return { prices: json.twPrices, source, updatedAt: json.twUpdatedAt };
      }
    }
  } catch {
    // 網路或 GAS 失敗，回傳空結果讓呼叫端提示
  }

  return { prices: {}, source: null };
};

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
