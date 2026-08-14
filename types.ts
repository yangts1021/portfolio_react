export type ActionType = 'BUY' | 'SELL';
export type CurrencyType = 'TWD' | 'USD' | 'HKD' | 'JPY';
export type TabType = 'transactions' | 'overview' | 'bank' | 'pledge' | 'crypto';
export type CryptoSubTab = 'pionex' | 'bitfinex';
export type RateMode = 'manual' | 'auto';

export interface Transaction {
  id: number;
  date: string;
  action: ActionType;
  symbol: string;
  broker: string;
  qty: number;
  price: number;
  currency: CurrencyType;
}

// 股票分割事件：原始交易紀錄不動，計算時依生效日動態調整股數與均價
export interface SplitEvent {
  id: number;
  symbol: string;
  date: string; // 生效日 YYYY-MM-DD，當日起的交易視為分割後單位
  ratio: number; // 1 股拆成幾股；反向合併用小數（如 4 併 1 = 0.25）
}

// 淨值歷史的一天，由 pipeline/build_history.py 依每日收盤重算
export interface HistoryPoint {
  date: string; // YYYY-MM-DD
  marketValue: number; // 總市值 TWD
  cost: number; // 總成本 TWD
  unrealized: number; // 未實現損益 TWD
  realized: number; // 已實現損益累計 TWD
  roi: number; // 報酬率 %
}

export interface BankAccount {
  bank: string;
  usd: number;
  twd: number;
  loan: number;
}

export interface PledgeRecord {
  transferDate: string;
  symbol: string;
  qty: number;
  broker: string;
  collateralValue: number;
  loanDate: string;
  loanAmount: number;
  rate: number;
  repaymentDate: string;
  interest?: number;
}

export interface BrokerDetail {
  broker: string;
  inventory: number;
  totalCost: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLTWD: number;
  roi: number;
  marketValueTWD: number;
}

export interface PortfolioItem {
  symbol: string;
  currency: CurrencyType;
  beta: number;
  category: string;
  inventory: number;
  totalCost: number;
  totalBuyQty: number;
  totalBuyAmt: number;
  soldQty: number;
  realizedPnL: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLTWD: number;
  roi: number;
  marketValueTWD: number;
  allocation: number;
  brokerDetails: BrokerDetail[];
}

export interface PionexAsset {
  coin: string;
  qty: number;
  avgCost: number;
  currentPrice: number;
  account: string;
  type: 'spot' | 'futures';
}

export interface BitfinexAsset {
  walletType: string; // 'exchange' | 'margin' | 'funding'
  coin: string;
  qty: number;
  available: number;
  currentPrice: number;
}

export interface ExchangeRates {
  [key: string]: number;
}

export interface MarketData {
  symbol: string;
  price: number;
  beta?: number;
}
