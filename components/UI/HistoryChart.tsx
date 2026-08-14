import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HistoryPoint } from '../../types';
import { formatMoney } from '../../utils/calculations';

interface HistoryChartProps {
  history: HistoryPoint[];
  isDarkMode: boolean;
  hideAmounts: boolean;
}

type ChartMode = 'asset' | 'pnl';
type RangeKey = '3M' | '6M' | '1Y' | 'ALL';

const RANGE_DAYS: Record<RangeKey, number> = { '3M': 90, '6M': 182, '1Y': 365, ALL: 0 };
const RANGES: RangeKey[] = ['3M', '6M', '1Y', 'ALL'];
const RANGE_LABEL: Record<RangeKey, string> = {
  '3M': '3 個月',
  '6M': '6 個月',
  '1Y': '1 年',
  ALL: '全部',
};

// 軸標籤用萬／億，完整數字留給 tooltip
const compact = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)} 億`;
  if (abs >= 1e4) return `${Math.round(value / 1e4)} 萬`;
  return String(Math.round(value));
};

const HistoryChart: React.FC<HistoryChartProps> = ({ history, isDarkMode, hideAmounts }) => {
  const [mode, setMode] = useState<ChartMode>('asset');
  const [range, setRange] = useState<RangeKey>('6M');

  const data = useMemo(() => {
    const cutoff = RANGE_DAYS[range] === 0 ? 0 : Date.now() - RANGE_DAYS[range] * 86400000;
    return (
      history
        .filter((p) => new Date(p.date).getTime() >= cutoff)
        // 總損益 = 未實現 + 已實現累計，在圖上額外畫一條
        .map((p) => ({ ...p, total: p.unrealized + p.realized }))
    );
  }, [history, range]);

  const latest = history[history.length - 1];
  const first = data[0];
  // 區間績效看的是「市值減成本」的變化，避免把期間內的加碼算成獲利
  const periodGain =
    latest && first ? latest.unrealized + latest.realized - (first.unrealized + first.realized) : 0;

  const axis = isDarkMode ? '#6b7280' : '#9ca3af';
  const grid = isDarkMode ? '#1f2937' : '#f3f4f6';
  const fmtValue = (v: number) =>
    hideAmounts ? '••••' : formatMoney(v, { maximumFractionDigits: 0 });
  const fmtAxis = (v: number) => (hideAmounts ? '' : compact(v));
  const fmtDate = (d: string) => d.slice(5); // MM-DD

  if (history.length === 0) {
    return (
      <div className='bg-white dark:bg-gray-900 p-10 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 text-center text-gray-400 dark:text-gray-600 text-sm transition-colors'>
        尚無歷史資料。在本機執行 <code>pipeline/build_history.py</code> 產生「淨值歷史」後再同步。
      </div>
    );
  }

  return (
    <div className='bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 transition-colors'>
      <div className='flex flex-wrap items-center justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-800'>
        <div>
          <h3 className='font-bold text-gray-700 dark:text-gray-200'>
            {mode === 'asset' ? '資產成長曲線' : '損益曲線'}
          </h3>
          <div className='text-[11px] text-gray-400 dark:text-gray-500 mt-0.5'>
            {data.length > 0 && `${data[0].date} ~ ${data[data.length - 1].date}`}
            <span className={`ml-2 ${periodGain >= 0 ? 'text-red-500' : 'text-green-500'}`}>
              區間損益 {periodGain >= 0 ? '+' : ''}
              {fmtValue(periodGain)}
            </span>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <div className='flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-700'>
            {(['asset', 'pnl'] as ChartMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs transition-colors ${
                  mode === m
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {m === 'asset' ? '資產' : '損益'}
              </button>
            ))}
          </div>
          <div className='flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-700'>
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  range === r
                    ? 'bg-gray-700 dark:bg-gray-600 text-white'
                    : 'bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className='p-4' style={{ height: 320 }}>
        <ResponsiveContainer width='100%' height='100%'>
          {mode === 'asset' ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id='mvFill' x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='0%' stopColor='#3b82f6' stopOpacity={0.35} />
                  <stop offset='100%' stopColor='#3b82f6' stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis
                dataKey='date'
                tickFormatter={fmtDate}
                tick={{ fontSize: 10, fill: axis }}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={fmtAxis}
                tick={{ fontSize: 10, fill: axis }}
                width={hideAmounts ? 8 : 56}
              />
              <Tooltip
                formatter={(v: number, name: string) => [fmtValue(v), name]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  backgroundColor: isDarkMode ? '#111827' : '#fff',
                  border: `1px solid ${grid}`,
                  color: isDarkMode ? '#e5e7eb' : '#374151',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type='monotone'
                dataKey='marketValue'
                name='總市值'
                stroke='#3b82f6'
                strokeWidth={2}
                fill='url(#mvFill)'
              />
              <Line
                type='monotone'
                dataKey='cost'
                name='總成本'
                stroke='#9ca3af'
                strokeWidth={1.5}
                dot={false}
              />
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis
                dataKey='date'
                tickFormatter={fmtDate}
                tick={{ fontSize: 10, fill: axis }}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={fmtAxis}
                tick={{ fontSize: 10, fill: axis }}
                width={hideAmounts ? 8 : 56}
              />
              <Tooltip
                formatter={(v: number, name: string) => [fmtValue(v), name]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  backgroundColor: isDarkMode ? '#111827' : '#fff',
                  border: `1px solid ${grid}`,
                  color: isDarkMode ? '#e5e7eb' : '#374151',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke={axis} strokeDasharray='3 3' />
              {/* 總損益是主角，畫粗一點；未實現與已實現退為細線 */}
              <Line
                type='monotone'
                dataKey='total'
                name='總損益'
                stroke='#f59e0b'
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type='monotone'
                dataKey='unrealized'
                name='未實現'
                stroke='#ef4444'
                strokeWidth={1.5}
                dot={false}
              />
              <Line
                type='monotone'
                dataKey='realized'
                name='已實現累計'
                stroke='#22c55e'
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default HistoryChart;
