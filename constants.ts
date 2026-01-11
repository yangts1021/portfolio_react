export const CATEGORY_COLORS: Record<string, string> = {
  原型: '#3b82f6', // Blue
  槓桿: '#a855f7', // Purple
  類現金: '#22c55e', // Green
  其他: '#9ca3af', // Gray
};

export const BROKERS = ['國泰證券', '富邦證券', '元大證券', '台北富邦', 'Firstrade'];

export const CURRENCIES = ['TWD', 'USD', 'HKD', 'JPY'];

export const STORAGE_KEYS = {
  TRANSACTIONS: 'my_transactions',
  PRICES: 'my_current_prices',
  BETAS: 'my_symbol_betas',
  BANK: 'my_bank_data',
  PLEDGE: 'my_pledge_data',
  GAS_URL: 'my_gas_url',
  RATES: 'my_exchange_rates',
  RATE_MODE: 'my_rate_mode',
};
