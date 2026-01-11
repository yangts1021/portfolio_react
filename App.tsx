import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TabType, Transaction, BankAccount, PledgeRecord, RateMode, ExchangeRates } from './types';
import { STORAGE_KEYS } from './constants';
import Navbar from './components/Layout/Navbar';
import TransactionsTab from './components/Tabs/TransactionsTab';
import OverviewTab from './components/Tabs/OverviewTab';
import BankTab from './components/Tabs/BankTab';
import PledgeTab from './components/Tabs/PledgeTab';
import { AlertModal, ConfirmModal, DataSyncModal } from './components/UI/Modals';

const App: React.FC = () => {
  // Navigation
  const [activeTab, setActiveTab] = useState<TabType>('transactions');

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
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

  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PRICES);
    return saved ? JSON.parse(saved) : {};
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
    localStorage.setItem(STORAGE_KEYS.PRICES, JSON.stringify(currentPrices));
  }, [currentPrices]);
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
    localStorage.setItem(STORAGE_KEYS.RATE_MODE, rateMode);
  }, [rateMode]);

  const showToast = useCallback((msg: string) => {
    setToasts((prev) => [...prev, msg]);
    setTimeout(() => setToasts((prev) => prev.slice(1)), 3000);
  }, []);

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
          const formattedTx = json.transactions.map((row: any, index: number) => ({
            id: Date.now() + index,
            date: row.date?.split('T')[0] || row.date,
            action:
              row.action === '賣' || row.action === 'SELL' || row.action === 'S' ? 'SELL' : 'BUY',
            symbol: String(row.symbol).toUpperCase(),
            broker: row.broker,
            qty: parseFloat(row.qty),
            price: parseFloat(row.price),
            currency: row.currency || 'TWD',
          }));
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

        if (!isSilent) {
          showToast('資料同步成功！');
          setIsDataModalOpen(false);
        }
      } catch (error: any) {
        if (!isSilent) setAlertConfig({ title: '同步失敗', message: error.message });
      }
    },
    [gasUrl, showToast],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearAllData = () => {
    setConfirmConfig({
      message: '警告：這將刪除所有交易紀錄與設定，且無法復原。確定嗎？',
      onConfirm: () => {
        setTransactions([]);
        setCurrentPrices({});
        setSymbolBetas({});
        setBankData([]);
        setPledgeData([]);
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
        onSyncClick={() => setIsDataModalOpen(true)}
        onClearClick={clearAllData}
      />

      <main className='flex-1 overflow-y-auto p-4 sm:p-6'>
        <div className='max-w-7xl mx-auto space-y-6'>
          {activeTab === 'transactions' && (
            <TransactionsTab
              transactions={transactions}
              setTransactions={setTransactions}
              gasUrl={gasUrl}
              showToast={showToast}
            />
          )}
          {activeTab === 'overview' && (
            <OverviewTab
              transactions={transactions}
              currentPrices={currentPrices}
              symbolBetas={symbolBetas}
              exchangeRates={exchangeRates}
              bankData={bankData}
              pledgeData={pledgeData}
              rateMode={rateMode}
              setRateMode={setRateMode}
              setExchangeRates={setExchangeRates}
              onRefresh={fetchDataFromGAS}
              onRefreshRate={fetchExchangeRate}
              isDarkMode={isDarkMode}
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
            />
          )}
          {activeTab === 'pledge' && (
            <PledgeTab
              pledgeData={pledgeData}
              setPledgeData={setPledgeData}
              currentPrices={currentPrices}
              gasUrl={gasUrl}
              showToast={showToast}
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
