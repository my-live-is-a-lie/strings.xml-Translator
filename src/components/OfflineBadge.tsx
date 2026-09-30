import React from 'react';

interface OfflineBadgeProps {
  appLang?: 'ar' | 'en';
}

export const OfflineBadge: React.FC<OfflineBadgeProps> = ({ appLang = 'ar' }) => {
  const isAr = appLang === 'ar';
  return (
    <div
      id="offline-ready-badge"
      className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 text-xs font-medium border border-slate-200/60 dark:border-slate-700/60"
      title={
        isAr
          ? 'يتم حفظ جميع الترجمات محلياً على جهازك مع دعم العمل بدون إنترنت بنسبة 100%.'
          : 'All translations are stored locally on your device with 100% offline capability.'
      }
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      <span className="text-[11px] font-mono">{isAr ? 'يعمل بدون إنترنت' : 'Offline Ready'}</span>
    </div>
  );
};
