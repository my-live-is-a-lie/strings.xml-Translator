import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { getStoredItem, setStoredItem } from '../utils/storage';

/** True only in the web demo build (`npm run build:demo`), never in the Android app. */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

const DOWNLOAD_URL = 'https://github.com/my-live-is-a-lie/strings.xml-Translator/releases/latest';

interface DemoBannerProps {
  isAr: boolean;
  /** Each placement can be dismissed on its own. */
  placement: 'editor' | 'settings';
  className?: string;
}

/** Dismissible strip of the web demo that points visitors to the real (Android) app. */
export const DemoBanner: React.FC<DemoBannerProps> = ({ isAr, placement, className = '' }) => {
  const storageKey = `demo_banner_dismissed_${placement}_v1`;
  const [dismissed, setDismissed] = useState(() => getStoredItem(storageKey) === '1');
  if (!IS_DEMO || dismissed) return null;
  return (
    <div
      role="note"
      className={`flex ${placement === 'settings' ? 'flex-wrap' : ''} items-center gap-2 rounded-2xl border border-[#1EB996]/40 bg-[#1EB996]/10 px-3 py-2 text-[12px] text-slate-700 dark:text-slate-200 shrink-0 ${className}`}
    >
      <span className={`leading-snug ${placement === 'settings' ? 'basis-full' : 'flex-1 min-w-0'}`}>
        {isAr
          ? 'هذه نسخة تجريبية على الويب. التطبيق الكامل لأندرويد (APK).'
          : 'This is a web demo. The full app is for Android (APK).'}
      </span>
      <a
        href={DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`${placement === 'settings' ? 'flex-1 justify-center' : ''} inline-flex items-center gap-1.5 shrink-0 rounded-full bg-[#1EB996] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#19a384] transition`}
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        {isAr ? 'تحميل التطبيق' : 'Get the app'}
      </a>
      <button
        type="button"
        aria-label={isAr ? 'إخفاء' : 'Dismiss'}
        onClick={() => {
          setStoredItem(storageKey, '1');
          setDismissed(true);
        }}
        className="shrink-0 rounded-full p-1 text-slate-500 hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
