
import React, { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Transaction, BankAccount, PledgeRecord, RateMode, ExchangeRates, PortfolioItem } from '../../types';
import { CATEGORY_COLORS } from '../../constants';
import { calculatePortfolio, formatMoney, getColorClass } from '../../utils/calculations';

interface OverviewTabProps {
  transactions: Transaction[];
  currentPrices: Record<string, number>;
  symbolBetas: Record<string, number>;
  exchangeRates: ExchangeRates;
  bankData: BankAccount[];
  pledgeData: PledgeRecord[];
  rateMode: RateMode;
  setRateMode: (mode: RateMode) => void;
  setExchangeRates: React.Dispatch<React.SetStateAction<ExchangeRates>>;
  onRefresh: () => void;
  onRefreshRate: () => void;
  isDarkMode: boolean;
}

const OverviewTab: React.FC<OverviewTabProps> = (props) => {
  const [showSoldOut, setShowSoldOut] = useState(false);

  const portfolioItems = useMemo(() => {
    return calculatePortfolio(props.transactions, props.currentPrices, props.symbolBetas, props.exchangeRates);
  }, [props.transactions, props.currentPrices, props.symbolBetas, props.exchangeRates]);

  const bankSummary = useMemo(() => {
    const usd = props.bankData.reduce((sum, b) => sum + (b.usd || 0), 0);
    const twd = props.bankData.reduce((sum, b) => sum + (b.twd || 0), 0);
    const loans = props.bankData.reduce((sum, b) => sum + (b.loan || 0), 0);
    const totalCashTWD = twd + (usd * props.exchangeRates.USD);
    return { usd, twd, loans, totalCashTWD };
  }, [props.bankData, props.exchangeRates.USD]);

  const pledgeSummary = useMemo(() => {
    const totalLoan = props.pledgeData.reduce((sum, p) => sum + p.loanAmount, 0);
    let totalCollateral = 0;
    props.pledgeData.forEach(p => {
      const price = props.currentPrices[p.symbol] ?? 0;
      totalCollateral += (p.qty * price);
    });
    const ratio = totalLoan > 0 ? (totalCollateral / totalLoan) * 100 : 0;
    return { totalLoan, totalCollateral, ratio };
  }, [props.pledgeData, props.currentPrices]);

  const metrics = useMemo(() => {
    const activeItems = portfolioItems.filter(p => p.inventory > 0.000001);
    const stockMarketValueTWD = activeItems.reduce((sum, p) => sum + p.marketValueTWD, 0);
    const stockCostTWD = activeItems.reduce((sum, p) => sum + (p.totalCost * (props.exchangeRates[p.currency] ?? 1)), 0);
    const unrealizedPnLTWD = stockMarketValueTWD - stockCostTWD;
    const realizedPnLTWD = portfolioItems.reduce((sum, p) => sum + (p.realizedPnL * (props.exchangeRates[p.currency] ?? 1)), 0);
    
    const categoryTotals: Record<string, number> = { '原型': 0, '槓桿': 0, '類現金': bankSummary.totalCashTWD, '其他': 0 };
    activeItems.forEach(p => { categoryTotals[p.category] = (categoryTotals[p.category] || 0) + p.marketValueTWD; });
    
    const totalAssets = stockMarketValueTWD + bankSummary.totalCashTWD;
    const totalLiabilities = bankSummary.loans + pledgeSummary.totalLoan;
    const netWorth = totalAssets - totalLiabilities;
    
    const totalBeta = activeItems.reduce((sum, p) => sum + (p.beta * (p.marketValueTWD / (totalAssets || 1))), 0);

    return {
      stockMarketValueTWD, stockCostTWD, unrealizedPnLTWD, realizedPnLTWD,
      categoryTotals, totalAssets, totalLiabilities, netWorth, totalBeta, activeItems
    };
  }, [portfolioItems, bankSummary, pledgeSummary, props.exchangeRates]);

  const chartData = (Object.entries(metrics.categoryTotals) as [string, number][])
    .filter(([name, value]) => name !== '其他' && value > 0)
    .map(([name, value]) => ({ name, value }));

  const categoryRules: Record<string, string> = {
    '原型': 'beta 1.0',
    '槓桿': 'beta 2.0',
    '類現金': 'beta 0'
  };

  const renderCustomizedLabel = (props: any) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, percent, name } = props;
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 25; 
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill={props.isDarkMode ? "#cbd5e1" : "#334155"}
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        className="text-[12px] md:text-[13px] font-bold"
      >
        {`${name} ${(percent * 100).toFixed(1)}%`}
      </text>
    );
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 現金 & 匯率卡片 */}
        <div className="bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 transition-colors">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-gray-700 dark:text-gray-200 flex items-center">
              <i className="fa-solid fa-piggy-bank mr-2 text-yellow-500"></i> 現金 & 匯率
            </h3>
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 text-xs">
              <button onClick={() => props.setRateMode('manual')} className={`px-2 py-1 rounded-md transition-all ${props.rateMode === 'manual' ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400'}`}>手動</button>
              <button onClick={() => props.setRateMode('auto')} className={`px-2 py-1 rounded-md transition-all ${props.rateMode === 'auto' ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400'}`}>自動</button>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg border border-blue-100 dark:border-blue-900/40">
              <label className="text-blue-600 dark:text-blue-400 font-medium text-sm">USD 匯率</label>
              <div className="flex items-center gap-2">
                {props.rateMode === 'auto' && <button onClick={props.onRefreshRate} className="text-blue-400 hover:text-blue-600 transition-colors"><i className="fa-solid fa-rotate"></i></button>}
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.01"
                    readOnly={props.rateMode === 'auto'} 
                    value={props.rateMode === 'auto' ? props.exchangeRates.USD.toFixed(2) : props.exchangeRates.USD} 
                    onChange={e => props.setExchangeRates({ ...props.exchangeRates, USD: parseFloat(e.target.value) || 0 })} 
                    className={`w-24 bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800 rounded p-1 text-right font-mono font-bold dark:text-white outline-none focus:ring-1 focus:ring-blue-500 transition-all ${props.rateMode === 'auto' ? 'cursor-default' : 'cursor-text'}`} 
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded dark:text-gray-300">
                <span>TWD 總額</span>
                <span className="font-mono font-bold">{formatMoney(bankSummary.twd, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded dark:text-gray-300">
                <span>USD 總額</span>
                <span className="font-mono font-bold">{formatMoney(bankSummary.usd, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 負債卡片 */}
        <div className="bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 transition-colors">
          <h3 className="font-bold text-gray-700 dark:text-gray-200 flex items-center mb-4">
            <i className="fa-solid fa-money-check-dollar mr-2 text-red-500"></i> 負債明細 (TWD)
          </h3>
          <div className="space-y-2 text-sm max-h-[140px] overflow-y-auto pr-1">
            {props.bankData.filter(b => (b.loan || 0) > 0).map(b => (
              <div key={b.bank} className="flex justify-between dark:text-gray-300 items-center">
                <span className="text-gray-500 dark:text-gray-400">{b.bank} 貸款</span>
                <span className="font-mono text-red-500 dark:text-red-400 font-bold">{formatMoney(b.loan, { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
            {pledgeSummary.totalLoan > 0 && (
              <div className="flex justify-between dark:text-gray-300 items-center">
                <span className="text-gray-500 dark:text-gray-400">股票質押 借款</span>
                <span className="font-mono text-red-500 dark:text-red-400 font-bold">{formatMoney(pledgeSummary.totalLoan, { maximumFractionDigits: 0 })}</span>
              </div>
            )}
            {props.bankData.filter(b => (b.loan || 0) > 0).length === 0 && pledgeSummary.totalLoan === 0 && (
              <div className="text-center text-gray-400 py-4">目前無負債紀錄</div>
            )}
          </div>
          <div className="flex justify-between border-t border-gray-100 dark:border-gray-800 pt-2 font-bold dark:text-white mt-2">
            <span>總負債合計</span>
            <span className="font-mono text-red-600 dark:text-red-400">{formatMoney(metrics.totalLiabilities, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 text-center transition-colors">
          <div className="text-gray-500 dark:text-gray-400 text-sm uppercase tracking-wider mb-2 font-medium">證券市值</div>
          <div className="text-2xl font-bold dark:text-white">{formatMoney(metrics.stockMarketValueTWD, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 text-center transition-colors">
          <div className="text-gray-500 dark:text-gray-400 text-sm uppercase tracking-wider mb-2 font-medium">總投入成本</div>
          <div className="text-2xl font-bold dark:text-white">{formatMoney(metrics.stockCostTWD, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 text-center transition-colors">
          <div className="text-gray-500 dark:text-gray-400 text-sm uppercase tracking-wider mb-2 font-medium">現金類價值</div>
          <div className="text-2xl font-bold dark:text-white">{formatMoney(bankSummary.totalCashTWD, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 text-center transition-colors">
          <div className="text-gray-500 dark:text-gray-400 text-sm uppercase tracking-wider mb-2 font-medium">未實現損益</div>
          <div className={`text-2xl font-bold ${getColorClass(metrics.unrealizedPnLTWD)}`}>{formatMoney(metrics.unrealizedPnLTWD, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 text-center transition-colors">
          <div className="text-gray-500 dark:text-gray-400 text-sm uppercase tracking-wider mb-2 font-medium">已實現總損益</div>
          <div className={`text-2xl font-bold ${getColorClass(metrics.realizedPnLTWD)}`}>{formatMoney(metrics.realizedPnLTWD, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 text-center border-l-4 border-blue-400 transition-colors">
          <div className="text-gray-500 dark:text-gray-400 text-sm uppercase tracking-wider mb-2 font-medium">總淨損益</div>
          <div className={`text-2xl font-bold ${getColorClass(metrics.unrealizedPnLTWD + metrics.realizedPnLTWD)}`}>
            {formatMoney(metrics.unrealizedPnLTWD + metrics.realizedPnLTWD, { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-blue-600 to-blue-800 dark:from-blue-700 dark:to-blue-900 p-6 rounded-xl shadow-md text-center text-white transition-all">
        <div className="text-blue-100 text-sm uppercase tracking-wider mb-2 font-medium">淨資產總額</div>
        <div className="text-4xl md:text-5xl font-bold">{formatMoney(metrics.netWorth, { maximumFractionDigits: 0 })}</div>
        <div className="text-blue-200 text-xs mt-2 font-mono">
          {formatMoney(metrics.totalAssets, { maximumFractionDigits: 0 })} (資產) - {formatMoney(metrics.totalLiabilities, { maximumFractionDigits: 0 })} (負債)
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 transition-colors">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-4">資產配置比例</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 20, right: 50, bottom: 20, left: 50 }}>
                <Pie 
                  data={chartData} 
                  innerRadius={55} 
                  outerRadius={75} 
                  paddingAngle={5} 
                  dataKey="value"
                  label={renderCustomizedLabel}
                  labelLine={{ 
                    stroke: props.isDarkMode ? '#64748b' : '#94a3b8', 
                    strokeWidth: 1.5 
                  }}
                >
                  {chartData.map((entry, index) => <Cell key={index} fill={CATEGORY_COLORS[entry.name] || '#ccc'} strokeWidth={0} />)}
                </Pie>
                <RechartsTooltip 
                  formatter={(v: any) => formatMoney(v as number, { maximumFractionDigits: 0 })} 
                  contentStyle={{ backgroundColor: props.isDarkMode ? '#111827' : '#fff', borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', color: props.isDarkMode ? '#fff' : '#000' }}
                  itemStyle={{ color: props.isDarkMode ? '#fff' : '#000' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-gray-900 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col justify-between transition-colors">
          <div>
            <div className="flex justify-between items-start mb-6">
              <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">投資曝險 & 組合 Beta</h3>
            </div>
            
            <div className="flex flex-col md:flex-row gap-6 mb-8">
              {/* 放大後的 Beta 字卡 */}
              <div className="flex-none w-full md:w-48 bg-gray-900 dark:bg-blue-600 text-white rounded-2xl p-6 shadow-xl flex flex-col items-center justify-center border-b-4 border-blue-500 dark:border-blue-400 transition-all hover:scale-105 duration-300">
                <div className="text-sm uppercase font-bold tracking-widest opacity-80 mb-2">Portfolio Beta</div>
                <div className="text-5xl font-black font-mono">{metrics.totalBeta.toFixed(2)}</div>
                <div className="text-[10px] mt-2 px-2 py-0.5 bg-white/20 rounded-full font-bold">市場敏感度</div>
              </div>

              {/* 類別權重網格 */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(Object.entries(metrics.categoryTotals) as [string, number][])
                  .filter(([name]) => name !== '其他')
                  .map(([name, val]) => (
                  <div key={name} className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col justify-center transition-all hover:shadow-md">
                    <div className="flex justify-between items-start mb-1">
                      <div className="text-sm text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wide flex items-center">
                        <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: CATEGORY_COLORS[name] }}></span>
                        {name}
                      </div>
                      <div className="text-[9px] px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-md font-bold">
                        {categoryRules[name]}
                      </div>
                    </div>
                    <div className="text-2xl font-bold dark:text-white font-mono">
                      {metrics.totalAssets > 0 ? ((val / metrics.totalAssets) * 100).toFixed(1) : '0.0'}%
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-bold">
                      {formatMoney(val, { maximumFractionDigits: 0 })} TWD
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center">
          <h3 className="font-bold text-gray-700 dark:text-gray-200">持倉明細與即時損益</h3>
          <button onClick={props.onRefresh} className="text-xs text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-md transition-colors shadow-sm flex items-center">
            <i className="fa-solid fa-rotate mr-1"></i> 即時更新
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left text-gray-500 dark:text-gray-400">
            <thead className="text-gray-700 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3">分類</th>
                <th className="px-4 py-3">標的代碼</th>
                <th className="px-4 py-3 text-right">現有股數</th>
                <th className="px-4 py-3 text-right bg-yellow-50 dark:bg-yellow-900/10">即時市價</th>
                <th className="px-4 py-3 text-right">市值(TWD)</th>
                <th className="px-4 py-3 text-right">均價(原幣)</th>
                <th className="px-4 py-3 text-right">未實現(TWD)</th>
                <th className="px-4 py-3 text-right">報酬率</th>
                <th className="px-4 py-3 text-right">資產占比</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {metrics.activeItems.map(p => (
                <tr key={p.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-4"><span className="px-2 py-0.5 rounded text-white font-bold text-[10px]" style={{ backgroundColor: CATEGORY_COLORS[p.category] }}>{p.category}</span></td>
                  <td className="px-4 py-4 font-bold text-gray-800 dark:text-gray-200">{p.symbol} <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal">{p.currency}</span></td>
                  <td className="px-4 py-4 text-right font-mono">{p.inventory.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="px-4 py-4 text-right bg-yellow-50 dark:bg-yellow-900/10 font-mono font-bold text-gray-700 dark:text-gray-300">{p.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-4 text-right font-mono font-bold text-gray-800 dark:text-gray-100">{formatMoney(p.marketValueTWD, { maximumFractionDigits: 0 })}</td>
                  <td className="px-4 py-4 text-right text-gray-400 dark:text-gray-500 font-mono">{formatMoney(p.avgCost)}</td>
                  <td className={`px-4 py-4 text-right font-bold ${getColorClass(p.unrealizedPnLTWD)}`}>{formatMoney(p.unrealizedPnLTWD, { maximumFractionDigits: 0 })}</td>
                  <td className={`px-4 py-4 text-right font-bold ${getColorClass(p.roi)}`}>{p.roi.toFixed(2)}%</td>
                  <td className="px-4 py-4 text-right font-mono text-gray-400">{metrics.totalAssets > 0 ? ((p.marketValueTWD / metrics.totalAssets) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
              ))}
              <tr className="bg-gray-100 dark:bg-gray-800 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" onClick={() => setShowSoldOut(!showSoldOut)}>
                <td colSpan={9} className="px-4 py-2 text-center text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                  <i className={`fa-solid fa-chevron-${showSoldOut ? 'up' : 'down'} mr-2`}></i>
                  已結清倉位 (點擊展開 / 收合)
                </td>
              </tr>
              {showSoldOut && portfolioItems.filter(p => p.inventory <= 0.000001).map(p => (
                <tr key={p.symbol} className="bg-gray-50 dark:bg-gray-900/50 opacity-60 italic text-gray-400">
                   <td className="px-4 py-4 text-[10px]">{p.category}</td>
                   <td className="px-4 py-4">{p.symbol}</td>
                   <td colSpan={5}></td>
                   <td className={`px-4 py-4 text-right font-bold ${getColorClass(p.realizedPnL)}`}>{formatMoney(p.realizedPnL * (props.exchangeRates[p.currency] || 1), { maximumFractionDigits: 0 })}</td>
                   <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OverviewTab;
