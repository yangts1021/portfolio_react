import React from 'react';
import { BankAccount, ExchangeRates } from '../../types';
import { formatMoney } from '../../utils/calculations';

interface BankTabProps {
  bankData: BankAccount[];
  setBankData: React.Dispatch<React.SetStateAction<BankAccount[]>>;
  exchangeRates: ExchangeRates;
  gasUrl: string;
  showToast: (msg: string) => void;
  onRefresh: () => void;
}

const BankTab: React.FC<BankTabProps> = ({
  bankData,
  setBankData,
  exchangeRates,
  gasUrl,
  showToast,
  onRefresh,
}) => {
  // 分別計算所有銀行的 USD 與 TWD 原始總額
  const totalUSD = bankData.reduce((sum, b) => sum + (b.usd || 0), 0);
  const totalTWD = bankData.reduce((sum, b) => sum + (b.twd || 0), 0);

  const handleUpdate = async (bank: string, field: keyof BankAccount, rawValue: string) => {
    // 移除逗號並解析為數字
    const val = parseFloat(rawValue.replace(/,/g, '')) || 0;

    const updated = bankData.map((b) => (b.bank === bank ? { ...b, [field]: val } : b));
    setBankData(updated);

    if (gasUrl) {
      const target = updated.find((b) => b.bank === bank);
      if (!target) return;
      try {
        await fetch(gasUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ type: 'updateBank', ...target }),
        });
        showToast(`已儲存 ${bank} 的資料`);
      } catch (e) {
        showToast('雲端儲存失敗');
      }
    }
  };

  return (
    <div className='animate-fade-in space-y-6'>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        {/* 上方總額摘要卡片 - USD 總額 */}
        <div className='bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col items-center justify-center text-center transition-colors'>
          <div className='text-gray-400 dark:text-gray-500 text-xs font-medium uppercase tracking-wider mb-1'>
            銀行總餘額 (USD)
          </div>
          <div className='text-3xl font-bold text-gray-800 dark:text-white'>
            {formatMoney(totalUSD, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
          </div>
        </div>
        {/* 上方總額摘要卡片 - TWD 總額 */}
        <div className='bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col items-center justify-center text-center transition-colors'>
          <div className='text-gray-400 dark:text-gray-500 text-xs font-medium uppercase tracking-wider mb-1'>
            銀行總餘額 (TWD)
          </div>
          <div className='text-3xl font-bold text-gray-800 dark:text-white'>
            {formatMoney(totalTWD, { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      <div className='bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors'>
        <div className='p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center'>
          <h3 className='font-bold text-gray-700 dark:text-gray-200'>
            <i className='fa-solid fa-building-columns text-blue-500 mr-2'></i>銀行系統餘額
          </h3>
          <button
            onClick={onRefresh}
            className='text-xs text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-md transition-colors shadow-sm'
          >
            <i className='fa-solid fa-rotate mr-1'></i> 刷新
          </button>
        </div>
        <div className='overflow-x-auto'>
          <table className='w-full text-sm text-left text-gray-500 dark:text-gray-400'>
            <thead className='text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-800'>
              <tr>
                <th className='px-6 py-3 w-1/4'>銀行</th>
                <th className='px-6 py-3 text-right w-1/4'>USD</th>
                <th className='px-6 py-3 text-right w-1/4'>TWD</th>
                <th className='px-6 py-3 text-right w-1/4'>貸款 (TWD)</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-100 dark:divide-gray-800'>
              {bankData.map((b) => (
                <tr
                  key={b.bank}
                  className='bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
                >
                  <td className='px-6 py-4 font-bold text-gray-800 dark:text-white'>{b.bank}</td>
                  <td className='px-6 py-4'>
                    <input
                      type='text'
                      defaultValue={formatMoney(b.usd)}
                      onFocus={(e) => {
                        e.target.value = e.target.value.replace(/,/g, '');
                      }}
                      onBlur={(e) => {
                        handleUpdate(b.bank, 'usd', e.target.value);
                        e.target.value = formatMoney(
                          parseFloat(e.target.value.replace(/,/g, '')) || 0,
                        );
                      }}
                      className='w-full text-right bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 focus:bg-white dark:focus:bg-gray-700 focus:ring-1 focus:ring-blue-500 rounded p-1 font-mono outline-none dark:text-gray-200'
                    />
                  </td>
                  <td className='px-6 py-4'>
                    <input
                      type='text'
                      defaultValue={formatMoney(b.twd)}
                      onFocus={(e) => {
                        e.target.value = e.target.value.replace(/,/g, '');
                      }}
                      onBlur={(e) => {
                        handleUpdate(b.bank, 'twd', e.target.value);
                        e.target.value = formatMoney(
                          parseFloat(e.target.value.replace(/,/g, '')) || 0,
                        );
                      }}
                      className='w-full text-right bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 focus:bg-white dark:focus:bg-gray-700 focus:ring-1 focus:ring-blue-500 rounded p-1 font-mono outline-none dark:text-gray-200'
                    />
                  </td>
                  <td className='px-6 py-4'>
                    <input
                      type='text'
                      defaultValue={formatMoney(b.loan)}
                      onFocus={(e) => {
                        e.target.value = e.target.value.replace(/,/g, '');
                      }}
                      onBlur={(e) => {
                        handleUpdate(b.bank, 'loan', e.target.value);
                        e.target.value = formatMoney(
                          parseFloat(e.target.value.replace(/,/g, '')) || 0,
                        );
                      }}
                      className='w-full text-right bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 focus:bg-white dark:focus:bg-gray-700 focus:ring-1 focus:ring-red-500 rounded p-1 font-mono text-red-500 dark:text-red-400 outline-none'
                    />
                  </td>
                </tr>
              ))}
              {bankData.length === 0 && (
                <tr>
                  <td colSpan={4} className='p-10 text-center text-gray-400 dark:text-gray-600'>
                    目前沒有銀行資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BankTab;
