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
