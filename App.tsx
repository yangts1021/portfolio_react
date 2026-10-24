import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  TabType,
  Transaction,
  BankAccount,
  PledgeRecord,
  SplitEvent,
  RateMode,
  ExchangeRates,
  Book,
} from './types';
import { STORAGE_KEYS, LEGACY_STORAGE_KEYS } from './constants';
import { isMarketHours, PriceQuoteMeta } from './utils/marketData';
import { supabase } from './utils/supabase';
import * as db from './utils/db';
import Navbar from './components/Layout/Navbar';
import TransactionsTab from './components/Tabs/TransactionsTab';
import OverviewTab from './components/Tabs/OverviewTab';
import BankTab from './components/Tabs/BankTab';
import PledgeTab from './components/Tabs/PledgeTab';
import LoginScreen from './components/UI/LoginScreen';
import { AlertModal } from './components/UI/Modals';

// --------------------------------------------------------------------------- //
// localStorage cache: only for a fast first paint. Supabase is the source of truth.
// --------------------------------------------------------------------------- //

const readCache = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeCache = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the app still works from Supabase
  }
};

const bookCacheKey = (bookId: string) => `${STORAGE_KEYS.BOOK_CACHE}:${bookId}`;

const EMPTY_BOOK: db.BookData = { transactions: [], bankData: [], pledgeData: [], history: [] };

type BookState = db.BookData & { bookId: string | null };

// Financial data must not linger on the device after sign-out
const clearDataCaches = () => {
  try {
    Object.keys(localStorage)
      .filter(
        (k) =>
          k.startsWith(STORAGE_KEYS.BOOK_CACHE) ||
          [
            STORAGE_KEYS.PRICES,
            STORAGE_KEYS.PRICE_META,
            STORAGE_KEYS.BETAS,
            STORAGE_KEYS.SPLITS,
            STORAGE_KEYS.BOOK_ID,
          ].includes(k),
      )
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
};

// --------------------------------------------------------------------------- //
// Auth gate
// --------------------------------------------------------------------------- //

const App: React.FC = () => {
  // undefined = still restoring the session, null = signed out
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  // Theme lives here so the login screen follows it too
  const [isDarkMode, setIsDarkMode] = useState<boolean>(
    () => localStorage.getItem('theme') === 'dark',
  );
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    // Data from the Google Sheet era is stale and no longer used
    LEGACY_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className='h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950'>
        <i className='fa-solid fa-circle-notch fa-spin text-2xl text-blue-500'></i>
      </div>
    );
  }
  if (!session) return <LoginScreen />;

  return (
    <PortfolioApp
      isDarkMode={isDarkMode}
      setIsDarkMode={setIsDarkMode}
      onSignOut={async () => {
        clearDataCaches();
        await supabase.auth.signOut();
      }}
    />
  );
};

// --------------------------------------------------------------------------- //
// Signed-in app
// --------------------------------------------------------------------------- //

interface PortfolioAppProps {
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
  onSignOut: () => void;
}

const PortfolioApp: React.FC<PortfolioAppProps> = ({ isDarkMode, setIsDarkMode, onSignOut }) => {
  const [activeTab, setActiveTab] = useState<TabType>('transactions');

  const [hideAmounts, setHideAmounts] = useState<boolean>(
    () => localStorage.getItem('hideAmounts') === 'true',
  );
  useEffect(() => {
    localStorage.setItem('hideAmounts', String(hideAmounts));
  }, [hideAmounts]);

  // Books
  const [books, setBooks] = useState<Book[]>([]);
  const [bookId, setBookId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEYS.BOOK_ID),
  );
  // Lets async loads drop results that arrive after the user switched books
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;

  // Book-scoped data is kept in one object tagged with its book, so the cache write
  // below can never store one book's rows under another book's key.
  const [bookState, setBookState] = useState<BookState>(() =>
    bookId
      ? { bookId, ...readCache(bookCacheKey(bookId), EMPTY_BOOK) }
      : { bookId: null, ...EMPTY_BOOK },
  );
  const { transactions, bankData, pledgeData, history } = bookState;

  const updateBook = useCallback((forBook: string, patch: (d: BookState) => Partial<BookState>) => {
    setBookState((d) => (d.bookId === forBook ? { ...d, ...patch(d) } : d));
  }, []);

  // Shared across books
  const [splitEvents, setSplitEvents] = useState<SplitEvent[]>(() =>
    readCache(STORAGE_KEYS.SPLITS, []),
  );
  const [symbolBetas, setSymbolBetas] = useState<Record<string, number>>(() =>
    readCache(STORAGE_KEYS.BETAS, {}),
  );
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(() =>
    readCache(STORAGE_KEYS.PRICES, {}),
  );
  const [priceMeta, setPriceMeta] = useState<Record<string, PriceQuoteMeta>>(() =>
    readCache(STORAGE_KEYS.PRICE_META, {}),
  );

  const [exchangeRates, setExchangeRates] = useState<ExchangeRates>(() =>
    readCache(STORAGE_KEYS.RATES, { USD: 32.5, HKD: 4.1, JPY: 0.22, TWD: 1 }),
  );
  const [rateMode, setRateMode] = useState<RateMode>(
    () => (localStorage.getItem(STORAGE_KEYS.RATE_MODE) as RateMode) || 'auto',
  );

  // UI State
  const [refreshing, setRefreshing] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{ title: string; message: string } | null>(null);
  const [toasts, setToasts] = useState<string[]>([]);

  useEffect(() => {
    if (bookState.bookId) writeCache(bookCacheKey(bookState.bookId), bookState);
  }, [bookState]);
  useEffect(() => writeCache(STORAGE_KEYS.SPLITS, splitEvents), [splitEvents]);
  useEffect(() => writeCache(STORAGE_KEYS.BETAS, symbolBetas), [symbolBetas]);
  useEffect(() => writeCache(STORAGE_KEYS.PRICES, currentPrices), [currentPrices]);
  useEffect(() => writeCache(STORAGE_KEYS.PRICE_META, priceMeta), [priceMeta]);
  useEffect(() => writeCache(STORAGE_KEYS.RATES, exchangeRates), [exchangeRates]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.RATE_MODE, rateMode), [rateMode]);

  const showToast = useCallback((msg: string) => {
    setToasts((prev) => [...prev, msg]);
    setTimeout(() => setToasts((prev) => prev.slice(1)), 3000);
  }, []);

  const showError = useCallback((title: string, err: unknown) => {
    setAlertConfig({ title, message: err instanceof Error ? err.message : String(err) });
  }, []);

  // ------------------------------------------------------------------------- //
  // Loading
  // ------------------------------------------------------------------------- //

  // Pick a book once the list arrives: keep the remembered one if it still exists
  useEffect(() => {
    db.listBooks()
      .then((list) => {
        setBooks(list);
        const saved = localStorage.getItem(STORAGE_KEYS.BOOK_ID);
        const chosen = list.find((b) => b.id === saved)?.id ?? list[0]?.id ?? null;
        setBookId(chosen);
        if (!chosen) showError('沒有帳本', '這個帳號在 Supabase 還沒有任何帳本');
      })
      .catch((e) => showError('讀取帳本失敗', e));
  }, [showError]);

  const switchBook = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEYS.BOOK_ID, id);
    setBookId(id);
    setBookState({ bookId: id, ...readCache(bookCacheKey(id), EMPTY_BOOK) });
  }, []);

  const loadAll = useCallback(
    async (isSilent = false) => {
      const forBook = bookIdRef.current;
      if (!forBook) return;
      setRefreshing(true);
      try {
        const [book, shared] = await Promise.all([db.loadBook(forBook), db.loadShared()]);
        if (bookIdRef.current !== forBook) return;
        setBookState({ bookId: forBook, ...book });
        setSplitEvents(shared.splitEvents);
        setSymbolBetas(shared.betas);
        if (!isSilent) showToast('已從雲端重新載入');
      } catch (e) {
        if (!isSilent) showError('載入失敗', e);
        else showToast('雲端載入失敗，顯示上次的資料');
      } finally {
        setRefreshing(false);
      }
    },
    [showToast, showError],
  );

  useEffect(() => {
    if (!bookId) return;
    localStorage.setItem(STORAGE_KEYS.BOOK_ID, bookId);
    setBookState((d) =>
      d.bookId === bookId ? d : { bookId, ...readCache(bookCacheKey(bookId), EMPTY_BOOK) },
    );
    loadAll(true);
  }, [bookId, loadAll]);

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
    return Array.from(symbols).sort();
  }, [transactions, pledgeData]);
  const priceSymbolsKey = priceSymbols.join(',');

  // 即時價格：pipeline 每 3 分鐘寫進 Supabase quotes，這裡直接讀
  const refreshPrices = useCallback(
    async (isSilent = false) => {
      const symbols = priceSymbolsKey ? priceSymbolsKey.split(',') : [];
      if (symbols.length === 0) return;
      try {
        const { prices, meta } = await db.loadQuotes(symbols);
        setCurrentPrices((prev) => ({ ...prev, ...prices }));
        setPriceMeta((prev) => ({ ...prev, ...meta }));
        if (!isSilent) showToast('價格已更新');
      } catch (e) {
        if (!isSilent) showToast('價格更新失敗');
      }
    },
    [priceSymbolsKey, showToast],
  );

  // 持倉清單變動（含首次載入）就抓一次報價
  useEffect(() => {
    refreshPrices(true);
  }, [refreshPrices]);

  // 台股或美股盤中每 60 秒自動更新價格
  useEffect(() => {
    const id = setInterval(() => {
      if (isMarketHours()) refreshPrices(true);
    }, 60000);
    return () => clearInterval(id);
  }, [refreshPrices]);

  const refreshEverything = useCallback(async () => {
    await loadAll(false);
    await refreshPrices(true);
  }, [loadAll, refreshPrices]);

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
    fetchExchangeRate();
  }, [fetchExchangeRate]);

  // ------------------------------------------------------------------------- //
  // Mutations: write to Supabase first, update local state only on success
  // ------------------------------------------------------------------------- //

  const handleAddTransaction = useCallback(
    async (tx: Omit<Transaction, 'id'>): Promise<boolean> => {
      const forBook = bookIdRef.current;
      if (!forBook) return false;
      try {
        const saved = await db.addTransaction(forBook, tx);
        updateBook(forBook, (d) => ({ transactions: [saved, ...d.transactions] }));
        showToast('交易已新增');
        return true;
      } catch (e) {
        showError('新增交易失敗', e);
        return false;
      }
    },
    [updateBook, showToast, showError],
  );

  const handleDeleteTransaction = useCallback(
    async (id: number) => {
      const forBook = bookIdRef.current;
      if (!forBook) return;
      try {
        await db.deleteTransaction(id);
        updateBook(forBook, (d) => ({ transactions: d.transactions.filter((t) => t.id !== id) }));
        showToast('交易已刪除');
      } catch (e) {
        showError('刪除交易失敗', e);
      }
    },
    [updateBook, showToast, showError],
  );

  const handleAddSplit = useCallback(
    async (split: Omit<SplitEvent, 'id'>): Promise<boolean> => {
      try {
        const saved = await db.addSplit(split);
        setSplitEvents((prev) => [...prev, saved]);
        showToast(`${saved.symbol} 分割事件已新增`);
        return true;
      } catch (e) {
        showError('新增分割事件失敗', e);
        return false;
      }
    },
    [showToast, showError],
  );

  const handleDeleteSplit = useCallback(
    async (id: number) => {
      try {
        await db.deleteSplit(id);
        setSplitEvents((prev) => prev.filter((s) => s.id !== id));
        showToast('分割事件已刪除');
      } catch (e) {
        showError('刪除分割事件失敗', e);
      }
    },
    [showToast, showError],
  );

  const handleAddPledge = useCallback(
    async (p: Omit<PledgeRecord, 'id'>): Promise<boolean> => {
      const forBook = bookIdRef.current;
      if (!forBook) return false;
      try {
        const saved = await db.addPledge(forBook, p);
        updateBook(forBook, (d) => ({ pledgeData: [...d.pledgeData, saved] }));
        showToast('質押紀錄已新增');
        return true;
      } catch (e) {
        showError('新增質押失敗', e);
        return false;
      }
    },
    [updateBook, showToast, showError],
  );

  const handleSaveBank = useCallback(
    async (account: BankAccount) => {
      const forBook = bookIdRef.current;
      if (!forBook) return;
      const previous = bankData;
      updateBook(forBook, (d) => ({
        bankData: d.bankData.map((b) => (b.bank === account.bank ? account : b)),
      }));
      try {
        await db.saveBank(forBook, account);
        showToast(`已儲存 ${account.bank} 的資料`);
      } catch (e) {
        updateBook(forBook, () => ({ bankData: previous }));
        showError('儲存銀行餘額失敗', e);
      }
    },
    [bankData, updateBook, showToast, showError],
  );

  const handleBetaUpdate = useCallback(
    async (symbol: string, beta: number) => {
      const previous = symbolBetas[symbol];
      setSymbolBetas((prev) => ({ ...prev, [symbol]: beta }));
      try {
        await db.saveBeta(symbol, beta);
        showToast(`${symbol} beta 已更新`);
      } catch (e) {
        setSymbolBetas((prev) => {
          const next = { ...prev };
          if (previous === undefined) delete next[symbol];
          else next[symbol] = previous;
          return next;
        });
        showError('儲存 beta 失敗', e);
      }
    },
    [symbolBetas, showToast, showError],
  );

  return (
    <div className='flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-950 transition-colors duration-300'>
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        hideAmounts={hideAmounts}
        setHideAmounts={setHideAmounts}
        books={books}
        bookId={bookId}
        onBookChange={switchBook}
        onRefreshClick={refreshEverything}
        refreshing={refreshing}
        onSignOut={onSignOut}
      />

      <main className='flex-1 overflow-y-auto p-4 sm:p-6'>
        <div className='max-w-7xl mx-auto space-y-6'>
          {activeTab === 'transactions' && (
            <TransactionsTab
              transactions={transactions}
              splitEvents={splitEvents}
              onAddTransaction={handleAddTransaction}
              onDeleteTransaction={handleDeleteTransaction}
              onAddSplit={handleAddSplit}
              onDeleteSplit={handleDeleteSplit}
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
              onRefresh={refreshEverything}
              onBetaChange={handleBetaUpdate}
              onRefreshRate={fetchExchangeRate}
              isDarkMode={isDarkMode}
              hideAmounts={hideAmounts}
            />
          )}
          {activeTab === 'bank' && (
            <BankTab
              bankData={bankData}
              exchangeRates={exchangeRates}
              onSave={handleSaveBank}
              onRefresh={refreshEverything}
              hideAmounts={hideAmounts}
            />
          )}
          {activeTab === 'pledge' && (
            <PledgeTab
              pledgeData={pledgeData}
              splitEvents={splitEvents}
              currentPrices={currentPrices}
              onAddPledge={handleAddPledge}
              hideAmounts={hideAmounts}
            />
          )}
        </div>
      </main>

      <AlertModal config={alertConfig} onClose={() => setAlertConfig(null)} />

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
