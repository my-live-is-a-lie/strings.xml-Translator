import React, { useEffect, useRef, useState } from 'react';

interface Props {
  appLang?: 'ar' | 'en';
}

/** Small status dot: tap it and it widens for a few seconds to say whether the app is online, then shrinks back. */
export const OfflineDot: React.FC<Props> = ({ appLang = 'ar' }) => {
  const isAr = appLang === 'ar';
  const [expanded, setExpanded] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const probeRef = useRef<(() => Promise<void>) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // navigator.onLine is unreliable in Android WebViews, so the state is confirmed with a real request.
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (alive) setOnline(false);
        return;
      }
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      try {
        await fetch(`https://translate.googleapis.com/generate_204?_=${Date.now()}`, {
          mode: 'no-cors',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (alive) setOnline(true);
      } catch {
        if (alive) setOnline(false);
      } finally {
        clearTimeout(t);
      }
    };
    probeRef.current = probe;
    probe();
    const id = setInterval(probe, 8000);
    window.addEventListener('online', probe);
    window.addEventListener('offline', probe);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener('online', probe);
      window.removeEventListener('offline', probe);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const toggle = () => {
    probeRef.current?.();
    if (timer.current) clearTimeout(timer.current);
    setExpanded(true);
    timer.current = setTimeout(() => setExpanded(false), 3000);
  };

  const label = online
    ? isAr ? 'متصل بالإنترنت' : 'Online'
    : isAr ? 'غير متصل بالإنترنت' : 'Offline';

  return (
    <button
      type="button"
      id="offline-dot-btn"
      onClick={toggle}
      aria-label={label}
      className="inline-flex items-center justify-center gap-2 h-9 min-w-9 px-3 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 cursor-pointer overflow-hidden transition-all duration-300"
    >
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <span
        className={`text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap overflow-hidden transition-all duration-300 ${
          expanded ? 'max-w-44 opacity-100' : 'max-w-0 opacity-0 -ms-2'
        }`}
      >
        {label}
      </span>
    </button>
  );
};
