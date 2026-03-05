import { Transaction, PortfolioItem, ExchangeRates } from '../types';

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

export const calculatePortfolio = (
  transactions: Transaction[],
  currentPrices: Record<string, number>,
  symbolBetas: Record<string, number>,
  exchangeRates: ExchangeRates,
) => {
  const portfolio: Record<string, PortfolioItem> = {};
  const brokerMap: Record<string, Record<string, { inventory: number; totalCost: number; avgCost: number }>> = {};

  // Sort by date to ensure accurate average cost calculation
  const sortedTx = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  sortedTx.forEach((tx) => {
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
