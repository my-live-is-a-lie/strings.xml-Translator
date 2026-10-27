import React from 'react';
import { ListFilter } from 'lucide-react';
import {
  QUICK_FILTER_IDS,
  QuickFilterId,
  toggleQuickFilter,
  toggleQuickFilterBar,
  useQuickFilters,
} from '../utils/quickFilters';

const LABELS: Record<QuickFilterId, { ar: string; en: string }> = {
  untranslated: { ar: 'غير مترجم', en: 'Untranslated' },
  translated: { ar: 'مترجم', en: 'Translated' },
  ai: { ar: 'ذكاء اصطناعي', en: 'AI' },
  manual: { ar: 'يدوي', en: 'Manual' },
};

interface Props {
  appLang: 'ar' | 'en';
  className?: string;
}

/** Toggle button; shows how many filters are active. */
export const QuickFilterButton: React.FC<Props> = ({ appLang, className = '' }) => {
  const { active, open } = useQuickFilters();
  const isAr = appLang === 'ar';
  return (
    <button
      type="button"
      data-quick-filters-btn
      aria-expanded={open}
      onClick={toggleQuickFilterBar}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border font-medium cursor-pointer m3-state-layer shadow-sm ${
        active.length > 0
          ? 'bg-[#0B57D0]/10 dark:bg-slate-800 border-[#0B57D0]/40 dark:border-[#A8C7FA]/40 text-slate-900 dark:text-slate-100'
          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-transparent text-slate-800 dark:text-slate-200'
      } ${className}`}
    >
      <ListFilter className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA]" />
      <span>{isAr ? 'الفلاتر' : 'Filters'}</span>
      {active.length > 0 && (
        <span
          className="min-w-4 h-4 px-1 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] text-white dark:text-slate-900 text-[10px] leading-4 text-center tabular-nums"
          aria-label={isAr ? `${active.length} فلاتر مفعلة` : `${active.length} active filters`}
        >
          {active.length}
        </span>
      )}
    </button>
  );
};

/** The row of toggle chips; only rendered while the bar is open. */
export const QuickFilterBar: React.FC<Props> = ({ appLang, className = '' }) => {
  const { active, open } = useQuickFilters();
  const isAr = appLang === 'ar';
  if (!open) return null;
  return (
    <div
      data-quick-filters-bar
      role="group"
      aria-label={isAr ? 'فلاتر النصوص' : 'String filters'}
      className={`flex items-center gap-1.5 flex-wrap ${className}`}
    >
      {QUICK_FILTER_IDS.map((id) => {
        const on = active.includes(id);
        return (
          <button
            key={id}
            type="button"
            data-filter={id}
            aria-pressed={on}
            onClick={() => toggleQuickFilter(id)}
            className={`px-3 py-1 rounded-full border text-xs font-medium cursor-pointer transition ${
              on
                ? 'bg-[#0B57D0] dark:bg-[#A8C7FA] border-transparent text-white dark:text-slate-900'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            {isAr ? LABELS[id].ar : LABELS[id].en}
          </button>
        );
      })}
    </div>
  );
};
