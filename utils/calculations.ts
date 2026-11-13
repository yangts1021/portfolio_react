import { Transaction, PortfolioItem, ExchangeRates, SplitEvent } from '../types';

export const getCategoryFromBeta = (beta: number): string => {
  if (beta < 0.5) return '類現金';
  if (beta > 1.5) return '槓桿';
  return '原型';
};

export const formatMoney = (
  num: number | undefined | null,
  options: Intl.NumberFormatOptions = {},
): string => {
  if (num === undefined || num === null) return '0';
  const defaultOptions = { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  return num.toLocaleString(undefined, { ...defaultOptions, ...options });
};

export const getColorClass = (val: number): string => {
  if (val > 0) return 'text-red-500';
  if (val < 0) return 'text-green-500';
  return 'text-gray-400';
};

// 某數量在 sinceDate 之後經歷的分割調整（質押股數等用）
export const applySplitsToQty = (
  symbol: string,
  qty: number,
  sinceDate: string,
  splitEvents: SplitEvent[],
): number => {
  const sym = String(symbol).toUpperCase();
  const since = new Date(sinceDate).getTime();
  let adjusted = qty;
  splitEvents.forEach((sp) => {
    if (String(sp.symbol).toUpperCase() !== sym) return;
    if (!(sp.ratio > 0)) return;
    if (new Date(sp.date).getTime() > since) adjusted *= sp.ratio;
  });
  return adjusted;
};

export const calculatePortfolio = (
  transactions: Transaction[],
  currentPrices: Record<string, number>,
  symbolBetas: Record<string, number>,
  exchangeRates: ExchangeRates,
  splitEvents: SplitEvent[] = [],
) => {
  const portfolio: Record<string, PortfolioItem> = {};
  const brokerMap: Record<
    string,
    Record<string, { inventory: number; totalCost: number; avgCost: number }>
  > = {};

  // 交易與分割事件合併後依時間序處理；同日時分割先套用（生效日當天的交易視為分割後單位）
  type PortfolioEvent =
    | { time: number; kind: 'split'; split: SplitEvent }
    | { time: number; kind: 'tx'; tx: Transaction };
  const events: PortfolioEvent[] = [
    ...transactions.map(
      (tx): PortfolioEvent => ({ time: new Date(tx.date).getTime(), kind: 'tx', tx }),
    ),
    ...splitEvents
      .filter((sp) => sp.ratio > 0)
      .map(
        (sp): PortfolioEvent => ({ time: new Date(sp.date).getTime(), kind: 'split', split: sp }),
      ),
  ].sort((a, b) => a.time - b.time || (a.kind === 'split' ? 0 : 1) - (b.kind === 'split' ? 0 : 1));

  events.forEach((ev) => {
    // 分割：庫存股數乘上比例、均價除以比例，成本總額不變，原始交易不動
    if (ev.kind === 'split') {
      const sym = String(ev.split.symbol).toUpperCase();
      const p = portfolio[sym];
      if (p && p.inventory > 0.000001) {
        p.inventory *= ev.split.ratio;
        p.avgCost = p.totalCost / p.inventory;
      }
      Object.values(brokerMap[sym] || {}).forEach((b) => {
        if (b.inventory > 0.000001) {
          b.inventory *= ev.split.ratio;
          b.avgCost = b.totalCost / b.inventory;
        }
      });
      return;
    }

    const tx = ev.tx;
    if (!portfolio[tx.symbol]) {
      const beta = symbolBetas[tx.symbol] ?? 1.0;
      portfolio[tx.symbol] = {
        symbol: tx.symbol,
        currency: tx.currency,
        beta,
        category: getCategoryFromBeta(beta),
        inventory: 0,
        totalCost: 0,
        totalBuyQty: 0,
        totalBuyAmt: 0,
        soldQty: 0,
        realizedPnL: 0,
        avgCost: 0,
        currentPrice: 0,
        marketValue: 0,
        unrealizedPnL: 0,
        unrealizedPnLTWD: 0,
        roi: 0,
        marketValueTWD: 0,
        allocation: 0,
        brokerDetails: [],
      };
    }
    if (!brokerMap[tx.symbol]) brokerMap[tx.symbol] = {};
    if (!brokerMap[tx.symbol][tx.broker]) {
      brokerMap[tx.symbol][tx.broker] = { inventory: 0, totalCost: 0, avgCost: 0 };
    }

    const p = portfolio[tx.symbol];
    const b = brokerMap[tx.symbol][tx.broker];
    if (tx.action === 'BUY') {
      p.inventory += tx.qty;
      p.totalCost += tx.qty * tx.price;
      p.totalBuyQty += tx.qty;
      p.totalBuyAmt += tx.qty * tx.price;
      if (p.inventory > 0) p.avgCost = p.totalCost / p.inventory;

      b.inventory += tx.qty;
      b.totalCost += tx.qty * tx.price;
      if (b.inventory > 0) b.avgCost = b.totalCost / b.inventory;
    } else if (tx.action === 'SELL') {
      const costBasis = p.avgCost * tx.qty;
      const revenue = tx.price * tx.qty;
      p.realizedPnL += revenue - costBasis;
      p.inventory -= tx.qty;
      p.totalCost -= costBasis;
      p.soldQty += tx.qty;
      if (p.inventory <= 0.000001) {
        p.inventory = 0;
        p.totalCost = 0;
        p.avgCost = 0;
      }

      const bCostBasis = b.avgCost * tx.qty;
      b.inventory -= tx.qty;
      b.totalCost -= bCostBasis;
      if (b.inventory <= 0.000001) {
        b.inventory = 0;
        b.totalCost = 0;
        b.avgCost = 0;
      }
    }
  });

  const items = Object.values(portfolio).map((p) => {
    const currentPrice = currentPrices[p.symbol] ?? p.avgCost;
    const marketValue = p.inventory * currentPrice;
    const unrealizedPnL = marketValue - p.totalCost;
    const roi = p.totalCost > 0 ? (unrealizedPnL / p.totalCost) * 100 : 0;
    const rate = exchangeRates[p.currency] ?? 1;
    const marketValueTWD = marketValue * rate;
    const unrealizedPnLTWD = unrealizedPnL * rate;

    const brokerDetails = Object.entries(brokerMap[p.symbol] || {})
      .filter(([, bd]) => bd.inventory > 0.000001)
      .map(([broker, bd]) => {
        const mv = bd.inventory * currentPrice;
        const uPnL = mv - bd.totalCost;
        const bRoi = bd.totalCost > 0 ? (uPnL / bd.totalCost) * 100 : 0;
        return {
          broker,
          inventory: bd.inventory,
          totalCost: bd.totalCost,
          avgCost: bd.avgCost,
          currentPrice,
          marketValue: mv,
          unrealizedPnL: uPnL,
          unrealizedPnLTWD: uPnL * rate,
          roi: bRoi,
          marketValueTWD: mv * rate,
        };
      });

    return {
      ...p,
      currentPrice,
      marketValue,
      unrealizedPnL,
      unrealizedPnLTWD,
      roi,
      marketValueTWD,
      brokerDetails,
    };
  });

  return items;
};

// --------------------------------------------------------------------------- //
// 最大回撤
// --------------------------------------------------------------------------- //

export interface MaxDrawdown {
  pct: number; // 負值，例如 -12.3 代表從高點跌了 12.3%
  amount: number; // 高點到低點之間總損益的變化（TWD，負值）
  peakDate: string;
  troughDate: string;
}

// 直接拿市值算回撤會被加碼、賣出扭曲（賣股換現金市值會掉，但沒有虧損），
// 所以先用「當日總損益變化 ÷ 前一日市值」串成報酬指數，再在指數上找最大的高點到低點跌幅。
// 當日的買賣視為收盤後才發生，是近似值。沒有回撤（一路上漲）時回傳 null。
export const calculateMaxDrawdown = (
  points: { date: string; marketValue: number; unrealized: number; realized: number }[],
): MaxDrawdown | null => {
  if (points.length < 2) return null;
  const total = (i: number) => points[i].unrealized + points[i].realized;

  let index = 1;
  let peakIndex = 1;
  let peakAt = 0;
  let worst = 0;
  let result: MaxDrawdown | null = null;

  for (let i = 1; i < points.length; i++) {
    const base = points[i - 1].marketValue;
    if (base > 0) index *= 1 + (total(i) - total(i - 1)) / base;
    if (index > peakIndex) {
      peakIndex = index;
      peakAt = i;
    }
    const drawdown = index / peakIndex - 1;
    if (drawdown < worst) {
      worst = drawdown;
      result = {
        pct: drawdown * 100,
        amount: total(i) - total(peakAt),
        peakDate: points[peakAt].date,
        troughDate: points[i].date,
      };
    }
  }
  return result;
};
