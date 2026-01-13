import React from 'react';

interface AlertModalProps {
  config: { title: string; message: string; json?: unknown } | null;
  onClose: () => void;
}

export const AlertModal: React.FC<AlertModalProps> = ({ config, onClose }) => {
  if (!config) return null;
  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center p-4'>
      <div className='absolute inset-0 bg-black/50 backdrop-blur-sm' onClick={onClose}></div>
      <div className='relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 animate-fade-in border border-gray-100 dark:border-gray-800 transition-colors'>
        <div className='text-center'>
          <i className='fa-solid fa-circle-exclamation text-4xl text-amber-500 mb-4'></i>
          <h3 className='text-lg font-bold text-gray-800 dark:text-white mb-2'>{config.title}</h3>
          <p className='text-sm text-gray-600 dark:text-gray-400 mb-6 text-left whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-100 dark:border-gray-700'>
            {config.message}
          </p>
          <button
            onClick={onClose}
            className='w-full bg-gray-800 dark:bg-blue-600 text-white font-medium rounded-lg py-2.5 hover:bg-gray-900 dark:hover:bg-blue-700 transition-colors'
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};

interface ConfirmModalProps {
  config: { message: string; onConfirm: () => void } | null;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ config, onClose }) => {
  if (!config) return null;
  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center p-4'>
      <div className='absolute inset-0 bg-black/50 backdrop-blur-sm' onClick={onClose}></div>
      <div className='relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 animate-fade-in border border-gray-100 dark:border-gray-800 transition-colors'>
        <div className='text-center'>
          <i className='fa-solid fa-circle-question text-4xl text-blue-500 mb-4'></i>
          <h3 className='text-lg font-bold text-gray-800 dark:text-white mb-2'>確認操作</h3>
          <p className='text-sm text-gray-600 dark:text-gray-400 mb-6'>{config.message}</p>
          <div className='flex gap-3'>
            <button
              onClick={onClose}
              className='flex-1 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-300 rounded-lg py-2.5 hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors'
            >
              取消
            </button>
            <button
              onClick={() => {
                config.onConfirm();
                onClose();
              }}
              className='flex-1 bg-blue-600 text-white rounded-lg py-2.5 hover:bg-blue-700 transition-colors'
            >
              確定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DataSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  gasUrl: string;
  setGasUrl: (url: string) => void;
  onFetch: (isSilent: boolean) => Promise<void>;
  showToast: (msg: string) => void;
}

export const DataSyncModal: React.FC<DataSyncModalProps> = ({
  isOpen,
  onClose,
  gasUrl,
  setGasUrl,
  onFetch,
  showToast,
}) => {
  const [loading, setLoading] = React.useState(false);
  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
      <div className='absolute inset-0 bg-black/50 backdrop-blur-sm' onClick={onClose}></div>
      <div className='relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden animate-fade-in border border-gray-100 dark:border-gray-800 transition-colors'>
        <div className='px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50'>
          <h3 className='font-bold text-gray-800 dark:text-white'>連結 Google Sheet 資料庫</h3>
          <button onClick={onClose} className='text-gray-400 hover:text-gray-600 transition-colors'>
            <i className='fa-solid fa-xmark text-xl'></i>
          </button>
        </div>
        <div className='p-6 space-y-6'>
          <div className='space-y-3'>
            <h4 className='text-sm font-bold text-gray-700 dark:text-gray-300 border-l-4 border-green-500 pl-2'>
              Google Apps Script 網址
            </h4>
            <p className='text-xs text-gray-500 dark:text-gray-400 leading-relaxed'>
              請貼上已部署的 Google Apps Script
              網頁應用程式網址，用於讀取交易、價格、銀行餘額及質押紀錄。
            </p>
            <input
              type='url'
              value={gasUrl}
              onChange={(e) => setGasUrl(e.target.value)}
              placeholder='https://script.google.com/macros/s/.../exec'
              className='w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs rounded-lg p-2.5 outline-none focus:ring-1 focus:ring-green-500 dark:text-white'
            />
            <div className='flex gap-2 pt-2'>
              <button
                onClick={() => {
                  localStorage.setItem('my_gas_url', gasUrl);
                  showToast('已儲存設定');
                }}
                className='flex-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg py-2 text-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
              >
                儲存
              </button>
              <button
                onClick={async () => {
                  setLoading(true);
                  await onFetch(false);
                  setLoading(false);
                }}
                className='flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors'
                disabled={loading}
              >
                {loading ? <i className='fa-solid fa-circle-notch fa-spin'></i> : '立即同步'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
