// 台股即時價格來源：優先打本機 Fubon 價格伺服器，失敗時退回 GAS 代理的 TWSE MIS API

const LOCAL_PRICE_SERVER = 'http://127.0.0.1:8787';
const LOCAL_TIMEOUT_MS = 2000;

export type TwPriceSource = 'fubon' | 'twse' | 'sheet';

export interface TwPriceResult {
  prices: Record<string, number>;
  source: TwPriceSource | null;
}

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const fetchTwPrices = async (symbols: string[], gasUrl: string): Promise<TwPriceResult> => {
  if (symbols.length === 0) return { prices: {}, source: null };
  const query = encodeURIComponent(symbols.join(','));

  // 1. 本機 Fubon 價格伺服器（盤中即時）
  try {
    const res = await fetchWithTimeout(
      `${LOCAL_PRICE_SERVER}/quotes?symbols=${query}`,
      LOCAL_TIMEOUT_MS,
    );
    if (res.ok) {
      const json = await res.json();
      if (json.prices && Object.keys(json.prices).length > 0) {
        return { prices: json.prices, source: 'fubon' };
      }
    }
  } catch {
    // 本機伺服器沒開，改走備援
  }

  // 2. GAS 代理 TWSE MIS API（約 5 秒延遲）；MIS 不通時 GAS 會回 Sheet 的 GOOGLEFINANCE 價
  if (gasUrl) {
    try {
      const res = await fetch(`${gasUrl}?type=twPrices&symbols=${query}`);
      if (res.ok) {
        const json = await res.json();
        if (json.twPrices && Object.keys(json.twPrices).length > 0) {
          return { prices: json.twPrices, source: json.twSource === 'sheet' ? 'sheet' : 'twse' };
        }
      }
    } catch {
      // 備援也失敗，回傳空結果
    }
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
