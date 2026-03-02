import React, { useMemo } from 'react';
import { PionexAsset, ExchangeRates } from '../../types';
import { formatMoney, getColorClass } from '../../utils/calculations';

interface PionexTabProps {
  pionexData: PionexAsset[];
  exchangeRates: ExchangeRates;
}

interface EnrichedAsset extends PionexAsset {
  marketValue: number;
  cost: number;
  pnl: number;
  pnlPct: number;
}

const PionexTab: React.FC<PionexTabProps> = ({ pionexData, exchangeRates }) => {
  const usdToTwd = exchangeRates.USD || 32.5;

  const enriched: EnrichedAsset[] = useMemo(
    () =>
      pionexData.map((asset) => {
        const absQty = Math.abs(asset.qty);
        const marketValue = absQty * asset.currentPrice;
        const cost = absQty * asset.avgCost;
        const pnl =
          asset.type === 'futures' && asset.qty < 0
            ? cost - marketValue // 空頭：賣高買低
            : marketValue - cost;
        const pnlPct = cost !== 0 ? (pnl / cost) * 100 : 0;
        return { ...asset, marketValue, cost, pnl, pnlPct };
      }),
    [pionexData],
  );

  const accountGroups = useMemo(() => {
    const groups: Record<string, EnrichedAsset[]> = {};
    enriched.forEach((item) => {
      const key = item.account || '未分類';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [enriched]);

  const accountNames = useMemo(() => Object.keys(accountGroups), [accountGroups]);

  const totalMarketValueUSD = enriched.reduce((sum, a) => sum + a.marketValue, 0);
  const totalPnlUSD = enriched.reduce((sum, a) => sum + a.pnl, 0);

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
      {/* Summary Cards — 全帳戶合計 */}
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

      {/* 各帳戶持倉 */}
      {accountNames.map((accountName) => {
        const items = accountGroups[accountName];
        const spotItems = items.filter((i) => i.type === 'spot');
        const futuresItems = items.filter((i) => i.type === 'futures');
        const acctMarketValue = items.reduce((s, a) => s + a.marketValue, 0);
        const acctPnl = items.reduce((s, a) => s + a.pnl, 0);

        return (
          <div
            key={accountName}
            className='bg-white dark:bg-gray-900 rounded-xl shadow overflow-hidden'
          >
            <div className='px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between'>
              <h2 className='text-lg font-semibold dark:text-white'>
                <i className='fa-solid fa-bitcoin-sign mr-2 text-yellow-500'></i>
                {accountName} 持倉明細
              </h2>
              <div className='text-sm text-gray-500 dark:text-gray-400'>
                市值{' '}
                <span className='font-semibold dark:text-white'>
                  $ {formatMoney(acctMarketValue)}
                </span>
                {' / 損益 '}
                <span className={`font-semibold ${getColorClass(acctPnl)}`}>
                  $ {formatMoney(acctPnl)}
                </span>
              </div>
            </div>

            {/* 現貨持倉 */}
            {spotItems.length > 0 && (
              <AssetTable
                label='現貨持倉'
                items={spotItems}
                accountName={accountName}
                isFutures={false}
              />
            )}

            {/* 合約持倉 */}
            {futuresItems.length > 0 && (
              <AssetTable
                label='合約持倉'
                items={futuresItems}
                accountName={accountName}
                isFutures={true}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

/** 可複用的持倉表格子元件 */
const AssetTable: React.FC<{
  label: string;
  items: EnrichedAsset[];
  accountName: string;
  isFutures: boolean;
}> = ({ label, items, accountName, isFutures }) => {
  const subtotalMarketValue = items.reduce((s, a) => s + a.marketValue, 0);
  const subtotalPnl = items.reduce((s, a) => s + a.pnl, 0);

  return (
    <div>
      <div className='px-5 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700'>
        <span className='text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
          {isFutures ? '⚡ ' : ''}
          {label}
        </span>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead className='bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300'>
            <tr>
              <th className='px-4 py-3 text-left'>幣種</th>
              <th className='px-4 py-3 text-right'>{isFutures ? '方向 / 數量' : '數量'}</th>
              <th className='px-4 py-3 text-right'>均價 (USD)</th>
              <th className='px-4 py-3 text-right'>現價 (USD)</th>
              <th className='px-4 py-3 text-right'>市值 (USD)</th>
              <th className='px-4 py-3 text-right'>未實現損益</th>
              <th className='px-4 py-3 text-right'>損益 %</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-100 dark:divide-gray-800'>
            {items.map((item) => (
              <tr
                key={`${accountName}-${item.type}-${item.coin}`}
                className='hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
              >
                <td className='px-4 py-3 font-medium dark:text-white'>{item.coin}</td>
                <td className='px-4 py-3 text-right dark:text-gray-300'>
                  {isFutures && (
                    <span
                      className={`inline-block mr-1 text-xs font-bold px-1.5 py-0.5 rounded ${
                        item.qty >= 0
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {item.qty >= 0 ? '多' : '空'}
                    </span>
                  )}
                  {formatMoney(Math.abs(item.qty), { maximumFractionDigits: 8 })}
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
          <tfoot className='bg-gray-50 dark:bg-gray-800 font-semibold text-sm'>
            <tr>
              <td className='px-4 py-3 dark:text-white'>小計</td>
              <td className='px-4 py-3' />
              <td className='px-4 py-3' />
              <td className='px-4 py-3' />
              <td className='px-4 py-3 text-right dark:text-white'>
                {formatMoney(subtotalMarketValue)}
              </td>
              <td className={`px-4 py-3 text-right font-medium ${getColorClass(subtotalPnl)}`}>
                {formatMoney(subtotalPnl)}
              </td>
              <td className='px-4 py-3' />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default PionexTab;
