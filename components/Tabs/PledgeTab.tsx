
import React, { useState, useMemo } from 'react';
import { PledgeRecord } from '../../types';
import { formatMoney } from '../../utils/calculations';

interface PledgeTabProps {
  pledgeData: PledgeRecord[];
  setPledgeData: React.Dispatch<React.SetStateAction<PledgeRecord[]>>;
  currentPrices: Record<string, number>;
  gasUrl: string;
  showToast: (msg: string) => void;
}

const PledgeTab: React.FC<PledgeTabProps> = ({ pledgeData, setPledgeData, currentPrices, gasUrl, showToast }) => {
  const [form, setForm] = useState({
    transferDate: new Date().toISOString().split('T')[0],
    symbol: '',
    qty: '',
    broker: '元大證金',
    loanDate: new Date().toISOString().split('T')[0],
    loanAmount: '',
    rate: '2.48'
  });
  const [loading, setLoading] = useState(false);

  const { totalLoan, overallRatio } = useMemo(() => {
    let loans = 0;
    let collaterals = 0;
    pledgeData.forEach(p => {
      loans += p.loanAmount;
      const price = currentPrices[p.symbol] ?? 0;
      collaterals += (p.qty * price);
    });
    return { totalLoan: loans, overallRatio: loans > 0 ? (collaterals / loans) * 100 : 0 };
  }, [pledgeData, currentPrices]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(form.qty);
    const symbol = form.symbol.toUpperCase();
    const loanDate = new Date(form.loanDate);
    const repayDate = new Date(loanDate);
    repayDate.setMonth(repayDate.getMonth() + 6);
    repayDate.setDate(repayDate.getDate() - 1);

    const newPledge: PledgeRecord = {
      transferDate: form.transferDate,
      symbol,
      qty,
      broker: form.broker,
      collateralValue: qty * (currentPrices[symbol] || 0),
      loanDate: form.loanDate,
      loanAmount: parseFloat(form.loanAmount),
      rate: parseFloat(form.rate) / 100,
      repaymentDate: repayDate.toISOString().split('T')[0]
    };

    setPledgeData(prev => [...prev, newPledge]);
    setForm(f => ({ ...f, symbol: '', qty: '', loanAmount: '' }));

    if (gasUrl) {
      setLoading(true);
      try {
        await fetch(gasUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ type: 'addPledge', ...newPledge })
        });
        showToast('質押紀錄已新增');
      } catch (err) { showToast('雲端同步失敗'); }
      finally { setLoading(false); }
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 text-center transition-colors">
          <div className="text-gray-400 dark:text-gray-500 text-xs uppercase mb-1">總質押借款</div>
          <div className="text-3xl font-bold text-red-600 dark:text-red-400">{formatMoney(totalLoan)}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 text-center transition-colors">
          <div className="text-gray-400 dark:text-gray-500 text-xs uppercase mb-1">整戶維持率</div>
          <div className={`text-3xl font-bold ${overallRatio < 140 ? 'text-red-600' : overallRatio < 166 ? 'text-yellow-600' : 'text-green-600'} dark:opacity-90`}>
            {overallRatio.toFixed(2)}%
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">安全線 &gt; 166% | 追繳線 &lt; 130%</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 transition-colors">
            <h2 className="text-lg font-bold mb-4 flex items-center dark:text-white"><i className="fa-solid fa-hand-holding-dollar text-blue-500 mr-2"></i> 新增質借</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">日期</label>
                  <input type="date" value={form.transferDate} onChange={e => setForm({ ...form, transferDate: e.target.value })} className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded p-2 text-xs dark:text-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">券商</label>
                  <select value={form.broker} onChange={e => setForm({ ...form, broker: e.target.value })} className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded p-2 text-xs dark:text-white">
                    <option>元大證金</option><option>群益證券</option><option>富邦證券</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">標的</label>
                  <input type="text" value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value })} placeholder="2330" className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded p-2 text-xs uppercase dark:text-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">股數</label>
                  <input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded p-2 text-xs dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">借款金額</label>
                  <input type="number" value={form.loanAmount} onChange={e => setForm({ ...form, loanAmount: e.target.value })} className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded p-2 text-xs dark:text-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">利率 (%)</label>
                  <input type="number" step="0.01" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded p-2 text-xs dark:text-white" />
                </div>
              </div>
              <button disabled={loading} className="w-full bg-blue-600 text-white rounded p-3 text-sm font-bold hover:bg-blue-700 transition-colors">
                {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : '新增紀錄'}
              </button>
            </form>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden flex flex-col transition-colors">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left text-gray-500 dark:text-gray-400">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 uppercase">
                <tr>
                  <th className="px-4 py-3">匯撥/借款日</th>
                  <th className="px-4 py-3">標的/股數</th>
                  <th className="px-4 py-3 text-right">借款金額</th>
                  <th className="px-4 py-3 text-right">維持率</th>
                  <th className="px-4 py-3 text-center">還款日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {pledgeData.map((p, i) => {
                  const ratio = (currentPrices[p.symbol] * p.qty) / p.loanAmount * 100;
                  return (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-4 py-4">{p.transferDate}<br/><span className="text-[9px] text-gray-400 dark:text-gray-500">{p.loanDate}</span></td>
                      <td className="px-4 py-4 font-bold text-gray-800 dark:text-white">{p.symbol}<br/><span className="text-gray-400 dark:text-gray-500 font-normal">{p.qty.toLocaleString()}</span></td>
                      <td className="px-4 py-4 text-right text-red-600 dark:text-red-400 font-bold">{formatMoney(p.loanAmount)}</td>
                      <td className={`px-4 py-4 text-right font-bold ${ratio < 140 ? 'text-red-600' : 'text-green-600'} dark:opacity-90`}>{ratio.toFixed(1)}%</td>
                      <td className="px-4 py-4 text-center dark:text-gray-300">{p.repaymentDate}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pledgeData.length === 0 && <div className="p-10 text-center text-gray-400 dark:text-gray-600">目前沒有質押資料</div>}
        </div>
      </div>
    </div>
  );
};

export default PledgeTab;
