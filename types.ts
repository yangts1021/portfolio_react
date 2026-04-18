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
