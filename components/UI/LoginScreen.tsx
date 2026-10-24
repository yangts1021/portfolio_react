import React, { useState } from 'react';
import { supabase, SUPABASE_PUBLISHABLE_KEY } from '../../utils/supabase';

// Sign-ups are disabled in Supabase; the account is created in the dashboard.
const LoginScreen: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    // On success App picks up the session through onAuthStateChange
    if (authError) {
      setError(
        authError.message === 'Invalid login credentials' ? 'Email 或密碼錯誤' : authError.message,
      );
    }
    setLoading(false);
  };

  return (
    <div className='min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-950'>
      <form
        onSubmit={handleSubmit}
        className='w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 p-8 space-y-5'
      >
        <div className='text-center'>
          <i className='fa-solid fa-chart-line text-blue-600 text-3xl mb-2'></i>
          <h1 className='text-xl font-bold dark:text-white'>MyPortfolio</h1>
        </div>

        {!SUPABASE_PUBLISHABLE_KEY && (
          <p className='text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded p-2'>
            尚未設定 Supabase publishable key（utils/supabase.ts）
          </p>
        )}

        <div>
          <label className='block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'>
            Email
          </label>
          <input
            type='email'
            autoComplete='username'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className='w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2.5 text-sm dark:text-white'
          />
        </div>
        <div>
          <label className='block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'>
            密碼
          </label>
          <input
            type='password'
            autoComplete='current-password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className='w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg p-2.5 text-sm dark:text-white'
          />
        </div>

        {error && <p className='text-xs text-red-600 dark:text-red-400'>{error}</p>}

        <button
          type='submit'
          disabled={loading}
          className='w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors'
        >
          {loading ? <i className='fa-solid fa-circle-notch fa-spin'></i> : '登入'}
        </button>
      </form>
    </div>
  );
};

export default LoginScreen;
