import React, { useState } from 'react';
import { PionexAsset, BitfinexAsset, ExchangeRates, CryptoSubTab } from '../../types';
import PionexTab from './PionexTab';
import BitfinexTab from './BitfinexTab';

interface CryptoTabProps {
  pionexData: PionexAsset[];
  bitfinexData: BitfinexAsset[];
  exchangeRates: ExchangeRates;
  hideAmounts: boolean;
}

const subTabs: { id: CryptoSubTab; label: string; icon: string }[] = [
  { id: 'pionex', label: 'Pionex', icon: 'fa-robot' },
  { id: 'bitfinex', label: 'Bitfinex', icon: 'fa-coins' },
];

const CryptoTab: React.FC<CryptoTabProps> = ({
  pionexData,
  bitfinexData,
  exchangeRates,
  hideAmounts,
}) => {
  const [sub, setSub] = useState<CryptoSubTab>('pionex');

  return (
    <div className='space-y-4'>
      <div className='flex gap-2 bg-white dark:bg-gray-900 rounded-xl shadow p-2 w-fit'>
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              sub === t.id
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <i className={`fa-solid ${t.icon} mr-2`}></i>
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'pionex' && (
        <PionexTab
          pionexData={pionexData}
          exchangeRates={exchangeRates}
          hideAmounts={hideAmounts}
        />
      )}
      {sub === 'bitfinex' && (
        <BitfinexTab
          bitfinexData={bitfinexData}
          exchangeRates={exchangeRates}
          hideAmounts={hideAmounts}
        />
      )}
    </div>
  );
};

export default CryptoTab;
