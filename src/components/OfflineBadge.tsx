import React from 'react';
import { useT } from '../i18n/i18n';

interface OfflineBadgeProps {
  appLang?: 'ar' | 'en';
}

export const OfflineBadge: React.FC<OfflineBadgeProps> = ({ appLang: _appLang = 'ar' }) => {
  const { t } = useT();
  return (
    <div
      id="offline-ready-badge"
      className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 text-xs font-medium border border-slate-200/60 dark:border-slate-700/60"
      title={
        t('all_translations_are_stored_locally')
      }
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      <span data-i18n className="text-[11px] font-mono">{t('offline_ready')}</span>
    </div>
  );
};
