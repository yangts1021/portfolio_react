import React from 'react';
import { PionexAsset, ExchangeRates } from '../../types';
import { formatMoney, getColorClass } from '../../utils/calculations';

interface PionexTabProps {
  pionexData: PionexAsset[];
  exchangeRates: ExchangeRates;
}

const PionexTab: React.FC<PionexTabProps> = ({ pionexData, exchangeRates }) => {
  const usdToTwd = exchangeRates.USD || 32.5;

  const enriched = pionexData.map((asset) => {
    const marketValue = asset.qty * asset.currentPrice;
    const cost = asset.qty * asset.avgCost;
    const pnl = marketValue - cost;
    const pnlPct = cost !== 0 ? (pnl / cost) * 100 : 0;
    return { ...asset, marketValue, cost, pnl, pnlPct };
  });

  const totalMarketValueUSD = enriched.reduce((sum, a) => sum + a.marketValue, 0);
  const totalCostUSD = enriched.reduce((sum, a) => sum + a.cost, 0);
  const totalPnlUSD = totalMarketValueUSD - totalCostUSD;

  if (pionexData.length === 0) {
    return (
      <div className='bg-white dark:bg-gray-900 rounded-xl shadow p-8 text-center'>
        <i className='fa-solid fa-bitcoin-sign text-4xl text-gray-300 dark:text-gray-600 mb-4'></i>
        <p className='text-gray-500 dark:text-gray-400 text-lg mb-2'>尚無 Pionex 資料</p>
        <p className='text-gray-400 dark:text-gray-500 text-sm'>
          請點擊右上角「同步」按鈕從 Google Sheet 取得資料
        </p>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* Summary Cards */}
      <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
        <div className='bg-white dark:bg-gray-900 rounded-xl shadow p-5'>
          <p className='text-xs text-gray-500 dark:text-gray-400 mb-1'>總市值 (USD)</p>
          <p className='text-2xl font-bold dark:text-white'>$ {formatMoney(totalMarketValueUSD)}</p>
        </div>
        <div className='bg-white dark:bg-gray-900 rounded-xl shadow p-5'>
          <p className='text-xs text-gray-500 dark:text-gray-400 mb-1'>總市值 (TWD)</p>
          <p className='text-2xl font-bold dark:text-white'>
            $ {formatMoney(totalMarketValueUSD * usdToTwd)}
          </p>
        </div>
        <div className='bg-white dark:bg-gray-900 rounded-xl shadow p-5'>
          <p className='text-xs text-gray-500 dark:text-gray-400 mb-1'>總損益 (USD)</p>
          <p className={`text-2xl font-bold ${getColorClass(totalPnlUSD)}`}>
            $ {formatMoney(totalPnlUSD)}
          </p>
        </div>
      </div>

      {/* Holdings Table */}
      <div className='bg-white dark:bg-gray-900 rounded-xl shadow overflow-hidden'>
        <div className='px-5 py-4 border-b border-gray-200 dark:border-gray-700'>
          <h2 className='text-lg font-semibold dark:text-white'>
            <i className='fa-solid fa-bitcoin-sign mr-2 text-yellow-500'></i>
            Pionex 持倉明細
          </h2>
        </div>
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300'>
              <tr>
                <th className='px-4 py-3 text-left'>幣種</th>
                <th className='px-4 py-3 text-right'>數量</th>
                <th className='px-4 py-3 text-right'>均價 (USD)</th>
                <th className='px-4 py-3 text-right'>現價 (USD)</th>
                <th className='px-4 py-3 text-right'>市值 (USD)</th>
                <th className='px-4 py-3 text-right'>未實現損益</th>
                <th className='px-4 py-3 text-right'>損益 %</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-100 dark:divide-gray-800'>
              {enriched.map((item) => (
                <tr
                  key={item.coin}
                  className='hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
                >
                  <td className='px-4 py-3 font-medium dark:text-white'>{item.coin}</td>
                  <td className='px-4 py-3 text-right dark:text-gray-300'>
                    {formatMoney(item.qty, { maximumFractionDigits: 8 })}
                  </td>
                  <td className='px-4 py-3 text-right dark:text-gray-300'>
                    {formatMoney(item.avgCost, { maximumFractionDigits: 6 })}
                  </td>
                  <td className='px-4 py-3 text-right dark:text-gray-300'>
                    {formatMoney(item.currentPrice, { maximumFractionDigits: 6 })}
                  </td>
                  <td className='px-4 py-3 text-right dark:text-gray-300'>
                    {formatMoney(item.marketValue)}
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${getColorClass(item.pnl)}`}>
                    {formatMoney(item.pnl)}
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${getColorClass(item.pnlPct)}`}>
                    {item.pnlPct >= 0 ? '+' : ''}
                    {formatMoney(item.pnlPct)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PionexTab;
