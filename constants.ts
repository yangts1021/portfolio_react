export const CATEGORY_COLORS: Record<string, string> = {
  原型: '#3b82f6', // Blue
  槓桿: '#a855f7', // Purple
  類現金: '#22c55e', // Green
  其他: '#9ca3af', // Gray
};

export const BROKERS = ['國泰證券', '富邦證券', '元大證券', '台北富邦', 'Firstrade'];

export const CURRENCIES = ['TWD', 'USD', 'HKD', 'JPY'];

export const STORAGE_KEYS = {
  BOOK_ID: 'my_book_id',
  // Per-book snapshot of transactions / bank / pledges / history, suffixed with `:<book_id>`
  BOOK_CACHE: 'my_book_cache',
  PRICES: 'my_current_prices',
  PRICE_META: 'my_price_meta',
  BETAS: 'my_symbol_betas',
  SPLITS: 'my_split_events',
  RATES: 'my_exchange_rates',
  RATE_MODE: 'my_rate_mode',
};

// Keys from the Google Sheet era, removed on startup
export const LEGACY_STORAGE_KEYS = [
  'my_transactions',
  'my_bank_data',
  'my_pledge_data',
  'my_history',
  'my_gas_url',
  'my_pionex_data',
  'my_bitfinex_data',
];
