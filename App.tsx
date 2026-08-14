import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TabType,
  Transaction,
  BankAccount,
  PledgeRecord,
  SplitEvent,
  PionexAsset,
  BitfinexAsset,
  RateMode,
  ExchangeRates,
  HistoryPoint,
} from './types';
import { STORAGE_KEYS } from './constants';
import { fetchPrices, isMarketHours, PRICE_SOURCE_LABEL, PriceQuoteMeta } from './utils/marketData';
import Navbar from './components/Layout/Navbar';
import TransactionsTab from './components/Tabs/TransactionsTab';
import OverviewTab from './components/Tabs/OverviewTab';
import BankTab from './components/Tabs/BankTab';
import PledgeTab from './components/Tabs/PledgeTab';
import CryptoTab from './components/Tabs/CryptoTab';
import { AlertModal, ConfirmModal, DataSyncModal } from './components/UI/Modals';

const App: React.FC = () => {
  // Navigation
  const [activeTab, setActiveTab] = useState<TabType>('transactions');

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  // Hide amounts (privacy mode)
  const [hideAmounts, setHideAmounts] = useState<boolean>(() => {
    return localStorage.getItem('hideAmounts') === 'true';
  });

  // Apply theme to document
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('hideAmounts', String(hideAmounts));
  }, [hideAmounts]);

  // Data State
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
    return saved ? JSON.parse(saved) : [];
  });

  const [bankData, setBankData] = useState<BankAccount[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.BANK);
    return saved ? JSON.parse(saved) : [];
  });

  const [pledgeData, setPledgeData] = useState<PledgeRecord[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PLEDGE);
    return saved ? JSON.parse(saved) : [];
  });

  const [splitEvents, setSplitEvents] = useState<SplitEvent[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SPLITS);
    return saved ? JSON.parse(saved) : [];
  });

  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PRICES);
    return saved ? JSON.parse(saved) : {};
  });

  // 每檔價格的出處（富邦 / TWSE / yfinance / 快取），持倉明細用來標示來源
  const [priceMeta, setPriceMeta] = useState<Record<string, PriceQuoteMeta>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PRICE_META);
    return saved ? JSON.parse(saved) : {};
  });

  // 淨值歷史，由 pipeline 依每日收盤重算後寫入 Sheet
  const [history, setHistory] = useState<HistoryPoint[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
    return saved ? JSON.parse(saved) : [];
  });

  const [symbolBetas, setSymbolBetas] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.BETAS);
    return saved ? JSON.parse(saved) : {};
  });

  const [gasUrl, setGasUrl] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.GAS_URL) || '';
  });

  const [exchangeRates, setExchangeRates] = useState<ExchangeRates>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.RATES);
    return saved ? JSON.parse(saved) : { USD: 32.5, HKD: 4.1, JPY: 0.22, TWD: 1 };
  });

  const [pionexData, setPionexData] = useState<PionexAsset[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PIONEX);
    if (!saved) return [];
    return JSON.parse(saved).map((item: any) => ({ ...item, type: item.type || 'spot' }));
  });

  const [bitfinexData, setBitfinexData] = useState<BitfinexAsset[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.BITFINEX);
    return saved ? JSON.parse(saved) : [];
  });

  const [rateMode, setRateMode] = useState<RateMode>(() => {
    return (localStorage.getItem(STORAGE_KEYS.RATE_MODE) as RateMode) || 'auto';
  });

  // UI State
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{
    title: string;
    message: string;
    json?: any;
  } | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [toasts, setToasts] = useState<string[]>([]);

  // Persist to LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
  }, [transactions]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.BANK, JSON.stringify(bankData));
  }, [bankData]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PLEDGE, JSON.stringify(pledgeData));
  }, [pledgeData]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SPLITS, JSON.stringify(splitEvents));
  }, [splitEvents]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PRICES, JSON.stringify(currentPrices));
  }, [currentPrices]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PRICE_META, JSON.stringify(priceMeta));
  }, [priceMeta]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  }, [history]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.BETAS, JSON.stringify(symbolBetas));
  }, [symbolBetas]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.GAS_URL, gasUrl);
  }, [gasUrl]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RATES, JSON.stringify(exchangeRates));
  }, [exchangeRates]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PIONEX, JSON.stringify(pionexData));
  }, [pionexData]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.BITFINEX, JSON.stringify(bitfinexData));
  }, [bitfinexData]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RATE_MODE, rateMode);
  }, [rateMode]);

  const showToast = useCallback((msg: string) => {
    setToasts((prev) => [...prev, msg]);
    setTimeout(() => setToasts((prev) => prev.slice(1)), 3000);
  }, []);

  // 持有中的標的（台股與美股 + 質押標的），用來查即時價格
  const priceSymbols = useMemo(() => {
    const netQty: Record<string, number> = {};
    transactions.forEach((t) => {
      if (t.currency !== 'TWD' && t.currency !== 'USD') return;
      netQty[t.symbol] = (netQty[t.symbol] || 0) + (t.action === 'BUY' ? t.qty : -t.qty);
    });
    const symbols = new Set(Object.keys(netQty).filter((s) => netQty[s] > 0.000001));
    pledgeData.forEach((p) => {
      if (p.symbol) symbols.add(String(p.symbol).toUpperCase());
    });
    return Array.from(symbols);
  }, [transactions, pledgeData]);

  // 即時價格：GAS 讀本機 pipeline 寫入的「即時報價」，讀不到才退回 MIS / GOOGLEFINANCE
  const refreshPrices = useCallback(
    async (isSilent = false) => {
      if (priceSymbols.length === 0) return;
      const { prices, meta, source } = await fetchPrices(priceSymbols, gasUrl);
      if (source) {
        setCurrentPrices((prev) => ({ ...prev, ...prices }));
        setPriceMeta((prev) => ({ ...prev, ...meta }));
        if (!isSilent) showToast(`價格已更新（${PRICE_SOURCE_LABEL[source]}）`);
      } else if (!isSilent) {
        showToast('價格更新失敗：雲端沒有回應');
      }
    },
    [priceSymbols, gasUrl, showToast],
  );

  // 淨值歷史另外抓，資料量大不放進預設同步
  const fetchHistory = useCallback(async () => {
    if (!gasUrl) return;
    try {
      const res = await fetch(`${gasUrl}?type=history`);
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.history)) setHistory(json.history);
    } catch {
      // 歷史抓不到不影響主畫面，維持上次快取
    }
  }, [gasUrl]);

  const fetchDataFromGAS = useCallback(
    async (isSilent = false) => {
      if (!gasUrl) {
        if (!isSilent)
          setAlertConfig({ title: '提示', message: '請先輸入 Google Apps Script 網址' });
        return;
      }

      try {
        const response = await fetch(gasUrl);
        if (!response.ok) throw new Error(`HTTP 錯誤 (${response.status})`);
        const json = await response.json();
        if (json.error) throw new Error(json.error);

        if (json.transactions) {
          const formattedTx = json.transactions.map((row: any, index: number) => {
            // Normalize date to YYYY-MM-DD
            let dateStr = row.date;
            if (dateStr) {
              try {
                const d = new Date(dateStr);
                if (!isNaN(d.getTime())) {
                  dateStr = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
                }
              } catch (e) {
                console.warn('Date parse error', row.date);
              }
            }

            return {
              id: Date.now() + index,
              date: dateStr,
              action:
                row.action === '賣' || row.action === 'SELL' || row.action === 'S' ? 'SELL' : 'BUY',
              symbol: String(row.symbol).toUpperCase(),
              broker: row.broker,
              qty: parseFloat(row.qty),
              price: parseFloat(row.price),
              currency: row.currency || 'TWD',
            };
          });
          setTransactions(formattedTx);
        }

        if (json.marketData) {
          const newPrices: Record<string, number> = {};
          const newBetas: Record<string, number> = {};
          json.marketData.forEach((item: any) => {
            const sym = String(item.symbol).toUpperCase();
            if (item.price) newPrices[sym] = parseFloat(item.price);
            if (item.beta !== undefined && item.beta !== '') newBetas[sym] = parseFloat(item.beta);
          });
          setCurrentPrices((prev) => ({ ...prev, ...newPrices }));
          setSymbolBetas((prev) => ({ ...prev, ...newBetas }));
        }

        if (json.bankData) setBankData(json.bankData);

        if (json.dashboard?.匯率_USDTWD) {
          const rate = parseFloat(json.dashboard.匯率_USDTWD);
          if (!isNaN(rate)) setExchangeRates((prev) => ({ ...prev, USD: rate }));
        }

        if (json.pledgeData) {
          const formattedPledge = json.pledgeData.map((row: any) => ({
            ...row,
            transferDate: row.transferDate?.split('T')[0] || row.transferDate,
            loanDate: row.loanDate?.split('T')[0] || row.loanDate,
            repaymentDate: row.repaymentDate?.split('T')[0] || row.repaymentDate,
          }));
          setPledgeData(formattedPledge);
        }

        if (json.splitEvents) {
          const formattedSplits: SplitEvent[] = json.splitEvents.map((row: any, index: number) => {
            // Sheet 日期會序列化成 UTC ISO（台北午夜 = 前一天 16:00Z），需依本地時區轉回正確日期
            let dateStr = row.date;
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) dateStr = d.toLocaleDateString('en-CA');
            return {
              id: Date.now() + index,
              symbol: String(row.symbol).toUpperCase(),
              date: dateStr,
              ratio: parseFloat(row.ratio),
            };
          });
          setSplitEvents(formattedSplits.filter((s) => s.symbol && s.date && s.ratio > 0));
        }

        if (json.pionexData) {
          const formattedPionex: PionexAsset[] = json.pionexData.map((row: any) => ({
            coin: String(row.coin).toUpperCase(),
            qty: parseFloat(row.qty) || 0,
            avgCost: parseFloat(row.avgCost) || 0,
            currentPrice: parseFloat(row.currentPrice) || 0,
            account: row.account || '',
            type: row.type || 'spot',
          }));
          setPionexData(formattedPionex);
        }

        if (json.bitfinexData) {
          const formattedBitfinex: BitfinexAsset[] = json.bitfinexData.map((row: any) => ({
            walletType: row.type || row.walletType || 'exchange',
            coin: String(row.coin).toUpperCase(),
            qty: parseFloat(row.qty) || 0,
            available: parseFloat(row.available) || 0,
            currentPrice: parseFloat(row.currentPrice) || 0,
          }));
          setBitfinexData(formattedBitfinex);
        }

        if (!isSilent) {
          showToast('資料同步成功！');
          setIsDataModalOpen(false);
        }

        // Sheet 的 GOOGLEFINANCE 價格可能是舊的，同步完再抓一次即時報價覆寫
        refreshPrices(isSilent);
        fetchHistory();
      } catch (error: any) {
        if (!isSilent) setAlertConfig({ title: '同步失敗', message: error.message });
      }
    },
    [gasUrl, showToast, refreshPrices, fetchHistory],
  );

  const fetchExchangeRate = useCallback(async () => {
    if (rateMode !== 'auto') return;
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.rates?.TWD) {
        setExchangeRates((prev) => ({ ...prev, USD: parseFloat(data.rates.TWD.toFixed(2)) }));
      }
    } catch (e) {
      console.warn('Rate fetch failed', e);
    }
  }, [rateMode]);

  useEffect(() => {
    if (rateMode === 'auto') fetchExchangeRate();
    if (gasUrl && rateMode === 'auto') fetchDataFromGAS(true);
    else {
      refreshPrices(true);
      fetchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 台股或美股盤中每 60 秒自動更新價格
  useEffect(() => {
    const id = setInterval(() => {
      if (isMarketHours()) refreshPrices(true);
    }, 60000);
    return () => clearInterval(id);
  }, [refreshPrices]);

  // 手動修改 beta：更新本地狀態並回寫 Google Sheet
  const handleBetaUpdate = useCallback(
    (symbol: string, beta: number) => {
      setSymbolBetas((prev) => ({ ...prev, [symbol]: beta }));
      if (gasUrl) {
        fetch(gasUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ type: 'updateBeta', symbol, beta }),
        })
          .then(() => showToast(`${symbol} beta 已更新並回寫雲端`))
          .catch(() => showToast(`${symbol} beta 已更新（雲端回寫失敗）`));
      } else {
        showToast(`${symbol} beta 已更新`);
      }
    },
    [gasUrl, showToast],
  );

  const clearAllData = () => {
    setConfirmConfig({
      message: '警告：這將刪除所有交易紀錄與設定，且無法復原。確定嗎？',
      onConfirm: () => {
        setTransactions([]);
        setCurrentPrices({});
        setPriceMeta({});
        setHistory([]);
        setSymbolBetas({});
        setBankData([]);
        setPledgeData([]);
        setSplitEvents([]);
        setPionexData([]);
        setBitfinexData([]);
        setExchangeRates({ USD: 32.5, HKD: 4.1, JPY: 0.22, TWD: 1 });
        showToast('所有資料已清除');
      },
    });
  };

  return (
    <div className='flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-950 transition-colors duration-300'>
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        hideAmounts={hideAmounts}
        setHideAmounts={setHideAmounts}
        onSyncClick={() => setIsDataModalOpen(true)}
        onClearClick={clearAllData}
      />

      <main className='flex-1 overflow-y-auto p-4 sm:p-6'>
        <div className='max-w-7xl mx-auto space-y-6'>
          {activeTab === 'transactions' && (
            <TransactionsTab
              transactions={transactions}
              setTransactions={setTransactions}
              splitEvents={splitEvents}
              setSplitEvents={setSplitEvents}
              gasUrl={gasUrl}
              showToast={showToast}
            />
          )}
          {activeTab === 'overview' && (
            <OverviewTab
              transactions={transactions}
              currentPrices={currentPrices}
              priceMeta={priceMeta}
              history={history}
              symbolBetas={symbolBetas}
              exchangeRates={exchangeRates}
              bankData={bankData}
              pledgeData={pledgeData}
              splitEvents={splitEvents}
              rateMode={rateMode}
              setRateMode={setRateMode}
              setExchangeRates={setExchangeRates}
              onRefresh={fetchDataFromGAS}
              onBetaChange={handleBetaUpdate}
              onRefreshRate={fetchExchangeRate}
              isDarkMode={isDarkMode}
              hideAmounts={hideAmounts}
            />
          )}
          {activeTab === 'bank' && (
            <BankTab
              bankData={bankData}
              setBankData={setBankData}
              exchangeRates={exchangeRates}
              gasUrl={gasUrl}
              showToast={showToast}
              onRefresh={() => fetchDataFromGAS(false)}
              hideAmounts={hideAmounts}
            />
          )}
          {activeTab === 'pledge' && (
            <PledgeTab
              pledgeData={pledgeData}
              setPledgeData={setPledgeData}
              splitEvents={splitEvents}
              currentPrices={currentPrices}
              gasUrl={gasUrl}
              showToast={showToast}
              hideAmounts={hideAmounts}
            />
          )}
          {activeTab === 'crypto' && (
            <CryptoTab
              pionexData={pionexData}
              bitfinexData={bitfinexData}
              exchangeRates={exchangeRates}
              hideAmounts={hideAmounts}
            />
          )}
        </div>
      </main>

      <AlertModal config={alertConfig} onClose={() => setAlertConfig(null)} />
      <ConfirmModal config={confirmConfig} onClose={() => setConfirmConfig(null)} />
      <DataSyncModal
        isOpen={isDataModalOpen}
        onClose={() => setIsDataModalOpen(false)}
        gasUrl={gasUrl}
        setGasUrl={setGasUrl}
        onFetch={fetchDataFromGAS}
        showToast={showToast}
      />

      <div className='fixed bottom-5 right-5 z-50 flex flex-col gap-2'>
        {toasts.map((toast, i) => (
          <div
            key={i}
            className='bg-gray-800 dark:bg-gray-700 text-white px-4 py-2 rounded shadow-lg text-sm animate-bounce'
          >
            {toast}
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;
