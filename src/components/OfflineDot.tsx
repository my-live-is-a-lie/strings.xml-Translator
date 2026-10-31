import React, { useEffect, useRef, useState } from 'react';

interface Props {
  appLang?: 'ar' | 'en';
}

/** Small status dot: tap it and it widens for a few seconds to say whether the app is online, then shrinks back. */
export const OfflineDot: React.FC<Props> = ({ appLang = 'ar' }) => {
  const isAr = appLang === 'ar';
  const [expanded, setExpanded] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const toggle = () => {
    if (timer.current) clearTimeout(timer.current);
    setExpanded(true);
    timer.current = setTimeout(() => setExpanded(false), 3000);
  };

  const label = online
    ? isAr ? 'متصل بالإنترنت' : 'Online'
    : isAr ? 'بدون إنترنت' : 'Offline';

  return (
    <button
      type="button"
      id="offline-dot-btn"
      onClick={toggle}
      aria-label={label}
      className="inline-flex items-center justify-center gap-2 h-9 min-w-9 px-3 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 cursor-pointer overflow-hidden transition-all duration-300"
    >
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      <span
        className={`text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap overflow-hidden transition-all duration-300 ${
          expanded ? 'max-w-40 opacity-100' : 'max-w-0 opacity-0 -ms-2'
        }`}
      >
        {label}
      </span>
    </button>
  );
};
