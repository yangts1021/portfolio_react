import React, { useMemo } from 'react';
import { BitfinexAsset, ExchangeRates } from '../../types';
import { formatMoney } from '../../utils/calculations';

interface BitfinexTabProps {
  bitfinexData: BitfinexAsset[];
  exchangeRates: ExchangeRates;
  hideAmounts: boolean;
}

interface EnrichedAsset extends BitfinexAsset {
  marketValue: number;
}

const WALLET_LABELS: Record<string, string> = {
  exchange: '現貨錢包 (Exchange)',
  margin: '保證金錢包 (Margin)',
  funding: '融資錢包 (Funding)',
};

const BitfinexTab: React.FC<BitfinexTabProps> = ({ bitfinexData, exchangeRates, hideAmounts }) => {
  const fm: typeof formatMoney = hideAmounts ? () => '••••' : formatMoney;
  const usdToTwd = exchangeRates.USD || 32.5;

  const enriched: EnrichedAsset[] = useMemo(
    () =>
      bitfinexData.map((asset) => ({
        ...asset,
        marketValue: Math.abs(asset.qty) * asset.currentPrice,
      })),
    [bitfinexData],
  );

  const walletGroups = useMemo(() => {
    const groups: Record<string, EnrichedAsset[]> = {};
    enriched.forEach((item) => {
      const key = item.walletType || 'exchange';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [enriched]);

  const walletTypes = useMemo(() => Object.keys(walletGroups), [walletGroups]);

  const totalMarketValueUSD = enriched.reduce((sum, a) => sum + a.marketValue, 0);

  if (bitfinexData.length === 0) {
    return (
      <div className='bg-white dark:bg-gray-900 rounded-xl shadow p-8 text-center'>
        <i className='fa-solid fa-bitcoin-sign text-4xl text-gray-300 dark:text-gray-600 mb-4'></i>
        <p className='text-gray-500 dark:text-gray-400 text-lg mb-2'>尚無 Bitfinex 資料</p>
        <p className='text-gray-400 dark:text-gray-500 text-sm'>
          請點擊右上角「同步」按鈕從 Google Sheet 取得資料
        </p>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* Summary */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        <div className='bg-white dark:bg-gray-900 rounded-xl shadow p-5'>
          <p className='text-xs text-gray-500 dark:text-gray-400 mb-1'>總市值 (USD)</p>
          <p className='text-2xl font-bold dark:text-white'>$ {fm(totalMarketValueUSD)}</p>
        </div>
        <div className='bg-white dark:bg-gray-900 rounded-xl shadow p-5'>
          <p className='text-xs text-gray-500 dark:text-gray-400 mb-1'>總市值 (TWD)</p>
          <p className='text-2xl font-bold dark:text-white'>
            $ {fm(totalMarketValueUSD * usdToTwd)}
          </p>
        </div>
      </div>

      {walletTypes.map((walletType) => {
        const items = walletGroups[walletType];
        const walletTotal = items.reduce((s, a) => s + a.marketValue, 0);

        return (
          <div
            key={walletType}
            className='bg-white dark:bg-gray-900 rounded-xl shadow overflow-hidden'
          >
            <div className='px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between'>
              <h2 className='text-lg font-semibold dark:text-white'>
                <i className='fa-solid fa-wallet mr-2 text-yellow-500'></i>
                {WALLET_LABELS[walletType] || walletType}
              </h2>
              <div className='text-sm text-gray-500 dark:text-gray-400'>
                市值 <span className='font-semibold dark:text-white'>$ {fm(walletTotal)}</span>
              </div>
            </div>

            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead className='bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300'>
                  <tr>
                    <th className='px-4 py-3 text-left'>幣種</th>
                    <th className='px-4 py-3 text-right'>持有數量</th>
                    <th className='px-4 py-3 text-right'>可用數量</th>
                    <th className='px-4 py-3 text-right'>現價 (USD)</th>
                    <th className='px-4 py-3 text-right'>市值 (USD)</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-gray-100 dark:divide-gray-800'>
                  {items.map((item) => (
                    <tr
                      key={`${walletType}-${item.coin}`}
                      className='hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
                    >
                      <td className='px-4 py-3 font-medium dark:text-white'>{item.coin}</td>
                      <td className='px-4 py-3 text-right dark:text-gray-300'>
                        {fm(item.qty, { maximumFractionDigits: 8 })}
                      </td>
                      <td className='px-4 py-3 text-right dark:text-gray-300'>
                        {fm(item.available, { maximumFractionDigits: 8 })}
                      </td>
                      <td className='px-4 py-3 text-right dark:text-gray-300'>
                        {fm(item.currentPrice, { maximumFractionDigits: 6 })}
                      </td>
                      <td className='px-4 py-3 text-right dark:text-gray-300'>
                        {fm(item.marketValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className='bg-gray-50 dark:bg-gray-800 font-semibold text-sm'>
                  <tr>
                    <td className='px-4 py-3 dark:text-white'>小計</td>
                    <td className='px-4 py-3' />
                    <td className='px-4 py-3' />
                    <td className='px-4 py-3' />
                    <td className='px-4 py-3 text-right dark:text-white'>{fm(walletTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default BitfinexTab;
