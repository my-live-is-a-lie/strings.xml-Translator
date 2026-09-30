import React, { useState } from 'react';
import { ResourceItem, FilterStatus, SourceFilter, SingleStringItem, PluralStringItem, ArrayStringItem } from '../types';
import { Search, CheckCircle2, Circle, AlertCircle, Edit3, Check, Sparkles, CheckSquare, Square, Loader2 } from 'lucide-react';
import { bulkTranslateItems } from '../utils/translator';
import { filterProjectItems } from '../utils/xmlExporter';

interface TableViewProps {
  items: ResourceItem[];
  onSelectString: (id: string) => void;
  onUpdateTranslation: (updated: ResourceItem) => void;
  targetLang?: string;
  targetLocaleName?: string;
  appLang?: 'ar' | 'en';
  onBulkUpdateTranslations?: (updatedItems: ResourceItem[]) => void;
  onResetItemHistory?: (id: string) => void;
  filterStatus?: FilterStatus;
  onFilterChange?: (status: FilterStatus) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  sourceFilter?: SourceFilter;
}

export const TableView: React.FC<TableViewProps> = ({
  items,
  onSelectString,
  onUpdateTranslation,
  targetLang = 'ar',
  targetLocaleName,
  appLang = 'ar',
  onBulkUpdateTranslations,
  onResetItemHistory,
  filterStatus: controlledFilter,
  onFilterChange,
  searchQuery: controlledSearch,
  onSearchChange,
  sourceFilter = 'all',
}) => {
  const isAr = appLang === 'ar';
  const [localSearch, setLocalSearch] = useState('');
  const [localFilter, setLocalFilter] = useState<FilterStatus>('all');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isBulkTranslating, setIsBulkTranslating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);

  const search = controlledSearch !== undefined ? controlledSearch : localSearch;
  const setSearch = (q: string) => {
    if (onSearchChange) onSearchChange(q);
    else setLocalSearch(q);
  };

  const filter = controlledFilter !== undefined ? controlledFilter : localFilter;
  const setFilter = (st: FilterStatus) => {
    if (onFilterChange) onFilterChange(st);
    else setLocalFilter(st);
  };

  const filtered = filterProjectItems(items, filter, search, sourceFilter);

  const filteredUntranslated = filtered.filter((i) => i.status === 'untranslated');
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => checkedIds.has(i.id));
  const allFilteredUntranslatedSelected =
    filteredUntranslated.length > 0 && filteredUntranslated.every((i) => checkedIds.has(i.id));

  const toggleItemChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((i) => next.delete(i.id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((i) => next.add(i.id));
        return next;
      });
    }
  };

  const handleToggleSelectUntranslated = () => {
    if (allFilteredUntranslatedSelected) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filteredUntranslated.forEach((i) => next.delete(i.id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        filteredUntranslated.forEach((i) => next.add(i.id));
        return next;
      });
    }
  };

  const handleBulkTranslate = async () => {
    if (checkedIds.size === 0 || isBulkTranslating || !onBulkUpdateTranslations) return;
    const selectedItems = items.filter((i) => checkedIds.has(i.id));
    if (selectedItems.length === 0) return;

    setIsBulkTranslating(true);
    setBulkProgress({ completed: 0, total: selectedItems.length });

    try {
      const translatedItems = await bulkTranslateItems(
        selectedItems,
        targetLang,
        targetLocaleName,
        (completed, total) => {
          setBulkProgress({ completed, total });
        }
      );
      onBulkUpdateTranslations(translatedItems);
      setCheckedIds(new Set());
    } finally {
      setIsBulkTranslating(false);
      setBulkProgress(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#F8F9FA] dark:bg-[#111318] overflow-hidden">
      {/* Search, Filter & Bulk Actions Header */}
      <div className="p-4 sm:p-5 border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-[#131314] flex flex-wrap items-center justify-between gap-3">
        {/* M3 Search Bar */}
        <div className="relative flex-1 min-w-[240px] max-w-md flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-full px-4 py-2 ring-1 ring-slate-200/60 dark:ring-slate-700/60 focus-within:ring-2 focus-within:ring-[#0B57D0] dark:focus-within:ring-[#A8C7FA] focus-within:bg-white dark:focus-within:bg-[#1E1F20] transition-all">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 mr-2.5 shrink-0" />
          <input
            id="table-search-input"
            type="text"
            placeholder={isAr ? 'ابحث في جميع النصوص حسب المفتاح أو المحتوى...' : 'Search all strings by key or content...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Bulk Selection & AI Translation Controls */}
          {onBulkUpdateTranslations && (
            <div className="flex items-center gap-1.5 text-xs">
              <button
                id="table-select-untranslated-btn"
                type="button"
                onClick={handleToggleSelectUntranslated}
                disabled={filteredUntranslated.length === 0 || isBulkTranslating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                title={isAr ? 'تحديد كل النصوص غير المترجمة' : 'Select all untranslated strings in current view'}
              >
                {allFilteredUntranslatedSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span>
                  {isAr
                    ? `تحديد غير المترجم (${filteredUntranslated.length})`
                    : `Select Untranslated (${filteredUntranslated.length})`}
                </span>
              </button>

              {checkedIds.size > 0 && (
                <button
                  id="table-bulk-translate-btn"
                  type="button"
                  onClick={handleBulkTranslate}
                  disabled={isBulkTranslating}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#1EB996] hover:bg-[#19A585] text-white font-semibold shadow-xs transition cursor-pointer disabled:opacity-60"
                >
                  {isBulkTranslating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>
                        {bulkProgress
                          ? isAr
                            ? `جارٍ الترجمة ${bulkProgress.completed}/${bulkProgress.total}...`
                            : `Translating ${bulkProgress.completed}/${bulkProgress.total}...`
                          : isAr
                            ? 'جارٍ الترجمة...'
                            : 'Translating...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {isAr ? `ترجمة جماعية (${checkedIds.size})` : `Bulk Translate (${checkedIds.size})`}
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* M3 Filter Chips */}
          <div className="flex items-center gap-1.5 text-xs overflow-x-auto no-scrollbar">
            {(
              [
                { id: 'all', label: isAr ? 'الكل' : 'All' },
                { id: 'untranslated', label: isAr ? 'غير مترجم' : 'Untranslated' },
                { id: 'translated', label: isAr ? 'مترجم' : 'Done' },
                { id: 'needs_review', label: isAr ? 'مراجعة' : 'Review' },
              ] as const
            ).map((st) => {
              const isSelected = filter === st.id;
              return (
                <button
                  key={st.id}
                  onClick={() => setFilter(st.id)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium capitalize transition cursor-pointer m3-state-layer ${
                    isSelected
                      ? 'bg-[#D3E3FD] text-[#041E49] dark:bg-[#0842A0] dark:text-[#D3E3FD]'
                      : 'bg-transparent text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                  <span>{st.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="bg-white dark:bg-[#1E1F20] rounded-2xl border border-slate-200/80 dark:border-slate-800/80 m3-elevation-1 overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-[#1A1C20] text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200/80 dark:border-slate-800/80 uppercase tracking-wider text-[11px]">
              <tr>
                {onBulkUpdateTranslations && (
                  <th className="py-3 px-3 w-10 text-center">
                    <button
                      type="button"
                      onClick={handleToggleSelectAllFiltered}
                      disabled={filtered.length === 0 || isBulkTranslating}
                      className="inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer disabled:opacity-40"
                      title={isAr ? 'تحديد كل الصفوف المعروضة' : 'Select all visible rows'}
                    >
                      {allFilteredSelected ? (
                        <CheckSquare className="w-4 h-4 text-[#1EB996]" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                )}
                <th className="py-3 px-3 w-12 text-center">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="py-3 px-4 w-52">{isAr ? 'المفتاح' : 'Key Name'}</th>
                <th className="py-3 px-4">{isAr ? 'النص الإنجليزي' : 'English Source'}</th>
                <th className="py-3 px-4">{isAr ? 'الترجمة' : 'Target Translation'}</th>
                <th className="py-3 px-3 w-16 text-center">{isAr ? 'فتح' : 'Open'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={onBulkUpdateTranslations ? 6 : 5} className="py-16 text-center text-slate-400 text-xs">
                    {isAr ? 'لا توجد نصوص مطابقة.' : 'No strings match the filter.'}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const isChecked = checkedIds.has(item.id);
                  let sourceSnippet = '';
                  let targetSnippet = '';
                  if (item.type === 'string') {
                    sourceSnippet = item.source || '';
                    targetSnippet = item.target || '';
                  } else if (item.type === 'plural') {
                    sourceSnippet = (item.items || []).map((i) => `[${i.quantity}] ${i.source || ''}`).join('; ');
                    targetSnippet = (item.items || []).map((i) => `[${i.quantity}] ${i.target || '—'}`).join('; ');
                  } else if (item.type === 'array') {
                    sourceSnippet = (item.items || []).map((i) => `[${i.index}] ${i.source || ''}`).join('; ');
                    targetSnippet = (item.items || []).map((i) => `[${i.index}] ${i.target || '—'}`).join('; ');
                  }

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors group ${
                        isChecked
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      {onBulkUpdateTranslations && (
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleItemChecked(item.id)}
                            disabled={isBulkTranslating}
                            className="inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                            title={isAr ? 'تحديد الصف للترجمة الجماعية' : 'Select row for bulk translation'}
                          >
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-[#1EB996]" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                      )}
                      <td className="py-3 px-3 text-center">
                        {item.status === 'translated' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mx-auto" />
                        ) : item.status === 'needs_review' ? (
                          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mx-auto" />
                        ) : (
                          <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 mx-auto" />
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate max-w-[200px]">{item.name}</span>
                          {item.type !== 'string' && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-sans">
                              ({isAr ? (item.type === 'plural' ? 'جمع' : 'مصفوفة') : item.type})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300 max-w-xs sm:max-w-md break-words">
                        {sourceSnippet}
                      </td>
                      <td className="py-3 px-4 max-w-xs sm:max-w-md break-words">
                        {item.type === 'string' ? (
                          <input
                            type="text"
                            value={(item as SingleStringItem).target}
                            onChange={(e) => {
                              const val = e.target.value;
                              onUpdateTranslation({
                                ...item,
                                target: val,
                                status: val.trim() ? 'translated' : 'untranslated',
                                translationSource: val.trim() ? 'manual' : undefined,
                              });
                            }}
                            placeholder={isAr ? 'اكتب الترجمة...' : 'Type translation...'}
                            className="w-full px-3 py-1.5 text-xs rounded-lg bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 border border-transparent focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none transition"
                          />
                        ) : (
                          <span
                            className={
                              targetSnippet
                                ? 'text-emerald-700 dark:text-emerald-300 font-medium'
                                : 'text-slate-400 italic'
                            }
                          >
                            {targetSnippet || (isAr ? 'غير مترجم' : 'Untranslated')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => onSelectString(item.id)}
                          className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-[#0B57D0] dark:text-[#A8C7FA] transition cursor-pointer m3-state-layer"
                          title={isAr ? 'فتح في محرّر الترجمة' : 'Open in Translation Editor'}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
