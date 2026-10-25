import React, { useState, useMemo, useEffect } from 'react';
import { ResourceItem, FilterStatus, SourceFilter, SingleStringItem, PluralStringItem, ArrayStringItem } from '../types';
import { Search, CheckCircle2, Circle, AlertCircle, Edit3, Check, Sparkles, CheckSquare, Square, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, ChevronUp } from 'lucide-react';
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
  const [expandChoice, setExpandChoice] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);

  const search = controlledSearch !== undefined ? controlledSearch : localSearch;
  const setSearch = (q: string) => {
    if (onSearchChange) onSearchChange(q);
    else setLocalSearch(q);
  };

  useEffect(() => {
    setEditingId(null);
  }, [search]);

  const filter = controlledFilter !== undefined ? controlledFilter : localFilter;
  const setFilter = (st: FilterStatus) => {
    if (onFilterChange) onFilterChange(st);
    else setLocalFilter(st);
  };

  const filtered = useMemo(
    () => filterProjectItems(items, filter, search, sourceFilter as SourceFilter),
    [items, filter, search, sourceFilter]
  );

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  useEffect(() => {
    setPage(1);
  }, [search, filter, sourceFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const pagedItems = useMemo(() => {
    if (pageSize >= 10000) return filtered;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const filteredUntranslated = useMemo(() => filtered.filter((i) => i.status === 'untranslated'), [filtered]);
  const allPagedSelected = pagedItems.length > 0 && pagedItems.every((i) => checkedIds.has(i.id));
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

  const handleToggleSelectAllPaged = () => {
    if (allPagedSelected) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        pagedItems.forEach((i) => next.delete(i.id));
        return next;
      });
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        pagedItems.forEach((i) => next.add(i.id));
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

  const highlightText = (text: string, q: string): React.ReactNode => {
    if (!q) return text;
    const lower = text.toLowerCase();
    const parts: React.ReactNode[] = [];
    let i = 0;
    while (true) {
      const idx = lower.indexOf(q, i);
      if (idx === -1) break;
      if (idx > i) parts.push(text.slice(i, idx));
      parts.push(
        <mark key={idx} className="rounded px-0.5 bg-amber-300/70 dark:bg-amber-400/30 text-inherit">
          {text.slice(idx, idx + q.length)}
        </mark>
      );
      i = idx + q.length;
    }
    parts.push(text.slice(i));
    return parts;
  };

  const mobileTargetClass =
    'w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none transition';

  const QUANTITY_STYLES: Record<string, string> = {
    zero: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
    one: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    two: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    few: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    many: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    other: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  };

  // One entry per plural form / array element, so each can be shown on its own line.
  const getVariants = (item: ResourceItem) => {
    if (item.type === 'plural') {
      return (item.items || []).map((i) => ({ label: String(i.quantity), source: i.source || '', target: i.target || '' }));
    }
    if (item.type === 'array') {
      return (item.items || []).map((i) => ({ label: String(i.index), source: i.source || '', target: i.target || '' }));
    }
    return [];
  };

  const renderVariantBadge = (label: string) => (
    <span
      className={`shrink-0 inline-flex items-center justify-center min-w-[2.75rem] px-1.5 py-0.5 rounded-md font-mono text-[10px] font-semibold leading-none ${
        QUANTITY_STYLES[label] ?? 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300'
      }`}
    >
      {label}
    </span>
  );

  // Table cells: one line per variant, badge + text.
  const renderVariantLines = (item: ResourceItem, side: 'source' | 'target') => (
    <div className="space-y-1.5">
      {getVariants(item).map((v) => {
        const text = side === 'source' ? v.source : v.target;
        return (
          <div key={v.label} className="flex items-start gap-2">
            {renderVariantBadge(v.label)}
            <span
              dir="auto"
              className={
                side === 'source'
                  ? ''
                  : text
                    ? 'text-emerald-700 dark:text-emerald-300 font-medium'
                    : 'text-slate-400 italic'
              }
            >
              {text || (side === 'target' ? (isAr ? 'غير مترجم' : 'Untranslated') : '')}
            </span>
          </div>
        );
      })}
    </div>
  );

  const getSnippets = (item: ResourceItem) => {
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
    return { sourceSnippet, targetSnippet };
  };

  const renderTarget = (
    item: ResourceItem,
    targetSnippet: string,
    inputClassName: string,
    multiline = false,
    onFocus?: () => void,
    autoFocus = false
  ) => {
    if (item.type !== 'string') {
      return (
        <span
          className={
            targetSnippet ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-slate-400 italic'
          }
        >
          {targetSnippet || (isAr ? 'غير مترجم' : 'Untranslated')}
        </span>
      );
    }
    const value = (item as SingleStringItem).target;
    const commonProps = {
      dir: 'auto' as const,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const val = e.target.value;
        onUpdateTranslation({
          ...item,
          target: val,
          status: val.trim() ? 'translated' : 'untranslated',
          translationSource: val.trim() ? 'manual' : undefined,
        });
      },
      placeholder: isAr ? 'اكتب الترجمة...' : 'Type translation...',
      className: inputClassName,
    };
    // Multi-line (mobile cards): grows with the text so long translations are fully readable.
    return multiline ? (
      <textarea
        {...commonProps}
        onFocus={onFocus}
        autoFocus={autoFocus}
        rows={Math.min(8, Math.max(1, Math.ceil(value.length / 34)))}
        className={`${inputClassName} resize-none field-sizing-content leading-relaxed`}
      />
    ) : (
      <input type="text" {...commonProps} />
    );
  };

  const renderStatusIcon = (item: ResourceItem) =>
    item.status === 'translated' ? (
      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mx-auto" />
    ) : item.status === 'needs_review' ? (
      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mx-auto" />
    ) : (
      <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 mx-auto" />
    );

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
          {/* Mobile: one stacked card per string (the 6-column table is too wide for phones) */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/60">
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                {isAr ? 'لا توجد نصوص مطابقة.' : 'No strings match the filter.'}
              </div>
            ) : (
              pagedItems.map((item) => {
                const isChecked = checkedIds.has(item.id);
                const { sourceSnippet, targetSnippet } = getSnippets(item);
                const q = search.trim().toLowerCase();
                const variants = getVariants(item);
                const isLong =
                  item.type === 'string'
                    ? sourceSnippet.length > 110 || targetSnippet.length > 110
                    : variants.length > 2;
                const matchInText =
                  !!q && (sourceSnippet.toLowerCase().includes(q) || targetSnippet.toLowerCase().includes(q));
                // A search hit inside long text opens the card automatically (unless the user chose otherwise).
                const expanded = !isLong || (expandChoice[item.id] ?? matchInText);
                const setExpanded = (v: boolean) => setExpandChoice((prev) => ({ ...prev, [item.id]: v }));
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 space-y-2.5 ${isChecked ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : ''}`}
                  >
                    <div className="flex items-center gap-2.5">
                      {onBulkUpdateTranslations && (
                        <button
                          type="button"
                          onClick={() => toggleItemChecked(item.id)}
                          disabled={isBulkTranslating}
                          className="shrink-0 inline-flex items-center justify-center text-slate-400 cursor-pointer"
                          title={isAr ? 'تحديد الصف للترجمة الجماعية' : 'Select row for bulk translation'}
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-[#1EB996]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      <span className="shrink-0">{renderStatusIcon(item)}</span>
                      <span
                        dir="ltr"
                        className="flex-1 min-w-0 truncate font-mono text-xs font-medium text-slate-900 dark:text-slate-100 text-start"
                      >
                        {item.name}
                        {item.type !== 'string' && (
                          <span className="ms-1 text-[10px] text-slate-400 dark:text-slate-500 font-sans">
                            ({isAr ? (item.type === 'plural' ? 'جمع' : 'مصفوفة') : item.type})
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => onSelectString(item.id)}
                        className="shrink-0 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-[#0B57D0] dark:text-[#A8C7FA] transition cursor-pointer m3-state-layer"
                        title={isAr ? 'فتح في محرّر الترجمة' : 'Open in Translation Editor'}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </div>

                    {item.type !== 'string' ? (
                      <div className="space-y-2.5">
                        {(expanded ? variants : variants.slice(0, 2)).map((v) => (
                          <div key={v.label} className="flex items-start gap-2.5">
                            {renderVariantBadge(v.label)}
                            <div className="min-w-0 flex-1 space-y-0.5 text-xs leading-relaxed">
                              <p dir="auto" className="text-slate-600 dark:text-slate-400 break-words">
                                {highlightText(v.source, q)}
                              </p>
                              <p
                                dir="auto"
                                className={`break-words ${
                                  v.target ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-slate-400 italic'
                                }`}
                              >
                                {v.target ? highlightText(v.target, q) : isAr ? 'غير مترجم' : 'Untranslated'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                    <p
                      dir="auto"
                      className={`text-xs leading-relaxed text-slate-600 dark:text-slate-400 break-words whitespace-pre-wrap ${
                        expanded ? '' : 'line-clamp-3'
                      }`}
                    >
                      {highlightText(sourceSnippet, q)}
                    </p>

                    <div className={`text-xs ${item.type !== 'string' && !expanded ? 'line-clamp-3' : ''}`}>
                      {item.type === 'string' && q && targetSnippet.toLowerCase().includes(q) && editingId !== item.id ? (
                        // Search hit inside the translation: show it highlighted; tap to edit.
                        <div
                          dir="auto"
                          onClick={() => setEditingId(item.id)}
                          className={`${mobileTargetClass} leading-relaxed whitespace-pre-wrap break-words cursor-text ${
                            expanded ? '' : 'line-clamp-3'
                          }`}
                        >
                          {highlightText(targetSnippet, q)}
                        </div>
                      ) : (
                        renderTarget(
                          item,
                          targetSnippet,
                          mobileTargetClass + (expanded ? '' : ' max-h-[4.3rem] overflow-hidden'),
                          true,
                          () => isLong && setExpanded(true),
                          editingId === item.id
                        )
                      )}
                    </div>

                      </>
                    )}

                    {isLong && (
                      <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0B57D0] dark:text-[#A8C7FA] cursor-pointer"
                      >
                        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {expanded
                          ? isAr
                            ? 'عرض أقل'
                            : 'Show less'
                          : item.type === 'string'
                            ? isAr
                              ? 'عرض المزيد'
                              : 'Show more'
                            : isAr
                              ? `عرض ${variants.length - 2} صيغ أخرى`
                              : `Show ${variants.length - 2} more`}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <table className="hidden md:table w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-[#1A1C20] text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200/80 dark:border-slate-800/80 uppercase tracking-wider text-[11px]">
              <tr>
                {onBulkUpdateTranslations && (
                  <th className="py-3 px-3 w-10 text-center">
                    <button
                      type="button"
                      onClick={handleToggleSelectAllPaged}
                      disabled={pagedItems.length === 0 || isBulkTranslating}
                      className="inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer disabled:opacity-40"
                      title={isAr ? 'تحديد كل الصفوف المعروضة في الصفحة' : 'Select all rows on this page'}
                    >
                      {allPagedSelected ? (
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
                pagedItems.map((item) => {
                  const isChecked = checkedIds.has(item.id);
                  const { sourceSnippet, targetSnippet } = getSnippets(item);

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
                        {renderStatusIcon(item)}
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
                        {item.type === 'string' ? sourceSnippet : renderVariantLines(item, 'source')}
                      </td>
                      <td className="py-3 px-4 max-w-xs sm:max-w-md break-words">
                        {item.type !== 'string'
                          ? renderVariantLines(item, 'target')
                          : renderTarget(
                          item,
                          targetSnippet,
                          'w-full px-3 py-1.5 text-xs rounded-lg bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-800 border border-transparent focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none transition'
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

          {/* Pagination Toolbar */}
          {filtered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-[#1A1C20] border-t border-slate-200/80 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <span>
                  {isAr
                    ? `عرض ${((currentPage - 1) * pageSize) + 1}–${Math.min(currentPage * pageSize, filtered.length)} من ${filtered.length} نص`
                    : `Showing ${((currentPage - 1) * pageSize) + 1}–${Math.min(currentPage * pageSize, filtered.length)} of ${filtered.length} strings`}
                </span>
                <div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 dark:border-slate-700 pl-2">
                  <span className="text-[11px] text-slate-400">{isAr ? 'لكل صفحة:' : 'Per page:'}</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 text-xs text-slate-800 dark:text-slate-200 border-none outline-none cursor-pointer"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={currentPage === 1}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    title={isAr ? 'الصفحة الأولى' : 'First page'}
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    title={isAr ? 'الصفحة السابقة' : 'Previous page'}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <span className="px-2 font-medium tabular-nums text-slate-800 dark:text-slate-200">
                    {isAr ? `${currentPage} من ${totalPages}` : `${currentPage} of ${totalPages}`}
                  </span>

                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    title={isAr ? 'الصفحة التالية' : 'Next page'}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    title={isAr ? 'الصفحة الأخيرة' : 'Last page'}
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
