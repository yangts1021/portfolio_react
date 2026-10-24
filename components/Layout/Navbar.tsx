import React from 'react';
import { Book, TabType } from '../../types';

interface NavbarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
  hideAmounts: boolean;
  setHideAmounts: (val: boolean) => void;
  books: Book[];
  bookId: string | null;
  onBookChange: (id: string) => void;
  onRefreshClick: () => void;
  refreshing: boolean;
  onSignOut: () => void;
}

const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  isDarkMode,
  setIsDarkMode,
  hideAmounts,
  setHideAmounts,
  books,
  bookId,
  onBookChange,
  onRefreshClick,
  refreshing,
  onSignOut,
}) => {
  const tabs = [
    { id: 'transactions', icon: 'fa-pen-to-square', label: '交易紀錄' },
    { id: 'overview', icon: 'fa-gauge-high', label: '資產總覽' },
    { id: 'bank', icon: 'fa-building-columns', label: '銀行餘額' },
    { id: 'pledge', icon: 'fa-hand-holding-dollar', label: '股票質押' },
  ];

  return (
    <nav className='bg-white dark:bg-gray-900 shadow-sm border-b border-gray-200 dark:border-gray-800 flex-none z-10 transition-colors duration-300'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex justify-between h-16'>
          <div className='flex items-center'>
            <i className='fa-solid fa-chart-line text-blue-600 text-2xl mr-3'></i>
            <span className='font-bold text-xl tracking-tight hidden lg:block dark:text-white mr-3'>
              MyPortfolio
            </span>
            {/* 只有一本帳本時不顯示選單 */}
            {books.length > 1 && (
              <select
                value={bookId ?? ''}
                onChange={(e) => onBookChange(e.target.value)}
                title='切換帳本'
                className='bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs md:text-sm dark:text-white'
              >
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className='flex space-x-2 md:space-x-8 items-center overflow-x-auto'>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600 font-bold'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                } border-b-2 px-1 md:px-3 py-5 text-xs md:text-sm font-medium transition-colors duration-150 whitespace-nowrap flex items-center`}
              >
                <i className={`fa-solid ${tab.icon} mr-1 md:mr-2`}></i>
                {tab.label}
              </button>
            ))}
          </div>
          <div className='flex items-center space-x-1 md:space-x-4'>
            <button
              onClick={() => setHideAmounts(!hideAmounts)}
              className='p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              title={hideAmounts ? '顯示金額' : '隱藏金額'}
            >
              <i className={`fa-solid ${hideAmounts ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            </button>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className='p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              title={isDarkMode ? '切換至明亮模式' : '切換至深色模式'}
            >
              <i className={`fa-solid ${isDarkMode ? 'fa-sun' : 'fa-moon'}`}></i>
            </button>
            <button
              onClick={onRefreshClick}
              disabled={refreshing}
              className='text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs flex items-center bg-blue-50 dark:bg-blue-900/30 px-2 md:px-3 py-2 rounded-lg transition-colors disabled:opacity-50'
              title='從雲端重新載入'
            >
              <i className={`fa-solid fa-rotate ${refreshing ? 'fa-spin' : ''}`}></i>
              <span className='hidden sm:inline ml-2'>重新整理</span>
            </button>
            <button
              onClick={onSignOut}
              className='p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              title='登出'
            >
              <i className='fa-solid fa-right-from-bracket'></i>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
