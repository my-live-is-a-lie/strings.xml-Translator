import React, { useMemo } from 'react';
import { ListFilter } from 'lucide-react';
import { ResourceItem } from '../types';
import {
  QUICK_FILTER_IDS,
  quickFilterCounts,
  QuickFilterId,
  toggleQuickFilter,
  toggleQuickFilterBar,
  useQuickFilters,
} from '../utils/quickFilters';

const LABELS: Record<QuickFilterId, { ar: string; en: string }> = {
  new: { ar: 'جديد', en: 'New' },
  untranslated: { ar: 'غير مترجم', en: 'Untranslated' },
  translated: { ar: 'مترجم', en: 'Translated' },
  ai: { ar: 'ذكاء اصطناعي', en: 'AI' },
  manual: { ar: 'يدوي', en: 'Manual' },
};

interface Props {
  appLang: 'ar' | 'en';
  className?: string;
}

interface BarProps extends Props {
  /** All strings of the open file: filters with nothing to show are dimmed and can't be switched on. */
  items: ResourceItem[];
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
export const QuickFilterBar: React.FC<BarProps> = ({ appLang, items, className = '' }) => {
  const { active, open } = useQuickFilters();
  const counts = useMemo(() => quickFilterCounts(items), [items]);
  const isAr = appLang === 'ar';
  if (!open) return null;
  return (
    <div
      data-quick-filters-bar
      role="group"
      aria-label={isAr ? 'فلاتر النصوص' : 'String filters'}
      className={`flex items-center gap-1.5 flex-wrap ${className}`}
    >
      {QUICK_FILTER_IDS.filter((id) => id !== 'new' || counts.new > 0 || active.includes('new')).map((id) => {
        const on = active.includes(id);
        const unavailable = counts[id] === 0 && !on; // an active filter can always be switched off
        return (
          <button
            key={id}
            type="button"
            data-filter={id}
            aria-pressed={on}
            disabled={unavailable}
            title={unavailable ? (isAr ? 'لا توجد نصوص لهذا الفلتر' : 'No strings for this filter') : undefined}
            onClick={() => toggleQuickFilter(id, items)}
            className={`px-3 py-1 rounded-full border text-xs font-medium transition ${
              unavailable ? 'opacity-40 cursor-not-allowed ' : 'cursor-pointer '
            }${
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
