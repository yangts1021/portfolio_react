import React, { useState } from 'react';
import { Transaction, ActionType, CurrencyType } from '../../types';
import { BROKERS, CURRENCIES } from '../../constants';

interface TransactionsTabProps {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  gasUrl: string;
  showToast: (msg: string) => void;
}

const TransactionsTab: React.FC<TransactionsTabProps> = ({
  transactions,
  setTransactions,
  gasUrl,
  showToast,
}) => {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    action: 'BUY' as ActionType,
    symbol: '',
    broker: BROKERS[0],
    qty: '',
    price: '',
    currency: 'TWD' as CurrencyType,
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.symbol || !form.qty || !form.price) return;

    const newTx: Transaction = {
      id: Date.now(),
      date: form.date,
      action: form.action,
      symbol: form.symbol.toUpperCase().trim(),
      broker: form.broker,
      qty: parseFloat(form.qty),
      price: parseFloat(form.price),
      currency: form.currency,
    };

    setTransactions((prev) => [newTx, ...prev]);
    setForm((f) => ({ ...f, symbol: '', qty: '', price: '' }));

    if (gasUrl) {
      setLoading(true);
      try {
        await fetch(gasUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            ...newTx,
            action: newTx.action === 'BUY' ? '買' : '賣',
            symbol: "'" + newTx.symbol,
          }),
        });
        showToast('已新增並同步至雲端');
      } catch (err) {
        showToast('雲端同步失敗，已存於本地');
      } finally {
        setLoading(false);
      }
    } else {
      showToast('已新增紀錄');
    }
  };

  const deleteTx = (id: number) => {
    if (confirm('確定要刪除本地紀錄嗎？')) {
      setTransactions((prev) => prev.filter((t) => t.id !== id));
      showToast('紀錄已移除');
    }
  };

  return (
    <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in'>
      <div className='lg:col-span-1'>
        <div className='bg-white dark:bg-gray-900 rounded-xl shadow-sm p-6 border border-gray-100 dark:border-gray-800 sticky top-6'>
          <h2 className='text-lg font-bold mb-4 flex items-center dark:text-white'>
            <i className='fa-solid fa-plus-circle text-blue-500 mr-2'></i> 新增交易
          </h2>
          <form onSubmit={handleSubmit} className='space-y-4'>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <label className='block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'>
                  日期
                </label>
                <input
                  type='date'
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                  className='w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2.5 text-sm dark:text-white'
                />
              </div>
              <div>
                <label className='block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'>
                  動作
                </label>
                <select
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value as ActionType })}
                  className={`w-full border border-gray-300 dark:border-gray-700 rounded-lg p-2.5 text-sm ${form.action === 'BUY' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}
                >
                  <option value='BUY'>買入 (Buy)</option>
                  <option value='SELL'>賣出 (Sell)</option>
                </select>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <label className='block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'>
                  代碼
                </label>
                <input
                  type='text'
                  placeholder='2330, AAPL'
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                  required
                  className='uppercase w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2.5 text-sm dark:text-white'
                />
              </div>
              <div>
                <label className='block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'>
                  券商
                </label>
                <select
                  value={form.broker}
                  onChange={(e) => setForm({ ...form, broker: e.target.value })}
                  className='w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2.5 text-sm dark:text-white'
                >
                  {BROKERS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <label className='block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'>
                  股數
                </label>
                <input
                  type='number'
                  step='any'
                  value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  required
                  className='w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2.5 text-sm dark:text-white'
                />
              </div>
              <div>
                <label className='block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'>
                  成交單價
                </label>
                <input
                  type='number'
                  step='any'
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                  className='w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2.5 text-sm dark:text-white'
                />
              </div>
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'>
                幣別
              </label>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value as CurrencyType })}
                className='w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2.5 text-sm dark:text-white'
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <button
              type='submit'
              disabled={loading}
              className='w-full text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-sm px-5 py-3 flex justify-center items-center transition-all'
            >
              {loading ? <i className='fa-solid fa-circle-notch fa-spin'></i> : '新增紀錄'}
            </button>
          </form>
        </div>
      </div>

      <div className='lg:col-span-2'>
        <div className='bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden flex flex-col h-full'>
          <div className='p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50'>
            <h3 className='font-bold text-gray-700 dark:text-gray-200'>交易歷史明細</h3>
            <span className='text-xs text-gray-500 bg-gray-200 dark:bg-gray-700 dark:text-gray-400 px-2 py-1 rounded-full'>
              {transactions.length} 筆
            </span>
          </div>
          <div className='overflow-x-auto flex-1'>
            <table className='w-full text-sm text-left text-gray-500 dark:text-gray-400'>
              <thead className='text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-800 sticky top-0 shadow-sm z-10'>
                <tr>
                  <th className='px-4 py-3'>日期</th>
                  <th className='px-4 py-3'>代碼</th>
                  <th className='px-4 py-3'>動作</th>
                  <th className='px-4 py-3 text-right'>股數</th>
                  <th className='px-4 py-3 text-right'>單價</th>
                  <th className='px-4 py-3 text-right'>總額</th>
                  <th className='px-4 py-3 text-center'>操作</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-gray-100 dark:divide-gray-800'>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className='bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'
                  >
                    <td className='px-4 py-4 whitespace-nowrap font-medium text-gray-900 dark:text-white'>
                      {tx.date}
                    </td>
                    <td className='px-4 py-4 font-bold text-blue-600 dark:text-blue-400'>
                      {tx.symbol}
                      <span className='text-[10px] text-gray-400 dark:text-gray-500 font-normal block'>
                        {tx.broker}
                      </span>
                    </td>
                    <td className='px-4 py-4'>
                      <span
                        className={`${tx.action === 'BUY' ? 'bg-red-600' : 'bg-green-600'} text-white px-2 py-0.5 rounded text-[10px] font-bold`}
                      >
                        {tx.action === 'BUY' ? '買入' : '賣出'}
                      </span>
                    </td>
                    <td className='px-4 py-4 text-right font-mono'>{tx.qty.toLocaleString()}</td>
                    <td className='px-4 py-4 text-right font-mono'>
                      {tx.price.toLocaleString()}{' '}
                      <span className='text-[10px] text-gray-400 dark:text-gray-500'>
                        {tx.currency}
                      </span>
                    </td>
                    <td className='px-4 py-4 text-right font-mono dark:text-gray-200'>
                      {(tx.qty * tx.price).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className='px-4 py-4 text-center'>
                      <button
                        onClick={() => deleteTx(tx.id)}
                        className='text-gray-400 hover:text-red-500'
                      >
                        <i className='fa-solid fa-trash-can'></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transactions.length === 0 && (
              <div className='p-10 text-center text-gray-400 dark:text-gray-600'>
                <i className='fa-solid fa-receipt text-4xl mb-3'></i>
                <p>目前沒有交易紀錄</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransactionsTab;
