import React, { useState, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  Circle,
  AlertCircle,
  Check,
  X,
  Sparkles,
  CheckSquare,
  Square,
  Loader2,
  RotateCcw,
  Keyboard,
  BarChart3,
  ShieldAlert,
  ShieldCheck,
  Code2,
  Braces,
  ChevronDown,
} from 'lucide-react';
import { ResourceItem, FilterStatus, SourceFilter, SingleStringItem, PluralStringItem, ArrayStringItem } from '../types';
import { bulkTranslateItems } from '../utils/translator';
import { filterProjectItems } from '../utils/xmlExporter';
import { analyzeProjectQa } from '../utils/placeholderCheck';

interface StringListProps {
  items: ResourceItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterStatus: FilterStatus;
  onFilterChange: (status: FilterStatus) => void;
  sourceFilter?: SourceFilter;
  onSourceFilterChange?: (source: SourceFilter) => void;
  targetLang?: string;
  targetLocaleName?: string;
  appLang?: 'ar' | 'en';
  onBulkUpdateTranslations?: (updatedItems: ResourceItem[]) => void;
  onResetItemHistory?: (id: string) => void;
}

function highlightText(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed || !text) return text;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  if (parts.length <= 1) return text;

  const lowerQuery = trimmed.toLowerCase();
  return parts.map((part, idx) =>
    part.toLowerCase() === lowerQuery ? (
      <mark
        key={idx}
        className="bg-amber-200/90 dark:bg-amber-500/35 text-slate-900 dark:text-amber-100 rounded-xs px-0.5 font-semibold"
      >
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

export const StringList: React.FC<StringListProps> = ({
  items,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  filterStatus,
  onFilterChange,
  sourceFilter: controlledSourceFilter,
  onSourceFilterChange,
  targetLang = 'ar',
  targetLocaleName,
  appLang = 'ar',
  onBulkUpdateTranslations,
  onResetItemHistory,
}) => {
  const isAr = appLang === 'ar';
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isBulkTranslating, setIsBulkTranslating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);
  const [localSourceFilter, setLocalSourceFilter] = useState<SourceFilter>('all');
  const [qaFilter, setQaFilter] = useState<'all' | 'any_issue' | 'placeholder' | 'html'>('all');
  const [qaListExpanded, setQaListExpanded] = useState(false);

  const qaSummary = useMemo(() => analyzeProjectQa(items), [items]);

  const sourceFilter = controlledSourceFilter !== undefined ? controlledSourceFilter : localSourceFilter;
  const handleSetSourceFilter = (next: SourceFilter) => {
    if (onSourceFilterChange) {
      onSourceFilterChange(next);
    } else {
      setLocalSourceFilter(next);
    }
  };

  // Counts
  const counts = {
    all: items.length,
    untranslated: items.filter((i) => i.status === 'untranslated').length,
    translated: items.filter((i) => i.status === 'translated').length,
    needs_review: items.filter((i) => i.status === 'needs_review').length,
    ai: items.filter((i) => i.status !== 'untranslated' && i.translationSource === 'ai').length,
    manual: items.filter((i) => i.status !== 'untranslated' && i.translationSource !== 'ai').length,
  };
  const totalTranslatedCount = counts.ai + counts.manual;
  const aiPercent = totalTranslatedCount > 0 ? Math.round((counts.ai / totalTranslatedCount) * 100) : 0;
  const manualPercent = totalTranslatedCount > 0 ? 100 - aiPercent : 0;

  // Filter items
  const baseFilteredItems = filterProjectItems(items, filterStatus, searchQuery, sourceFilter);
  const filteredItems = baseFilteredItems.filter((item) => {
    if (qaFilter === 'all') return true;
    const itemQa = qaSummary.byItemId.get(item.id);
    if (!itemQa) return false;
    if (qaFilter === 'placeholder') return itemQa.hasPlaceholderIssue;
    if (qaFilter === 'html') return itemQa.hasHtmlIssue;
    return true;
  });

  const filteredUntranslated = filteredItems.filter((i) => i.status === 'untranslated');
  const allFilteredUntranslatedSelected =
    filteredUntranslated.length > 0 && filteredUntranslated.every((i) => checkedIds.has(i.id));

  const toggleItemChecked = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
    <div className="flex flex-col h-full bg-white dark:bg-[#131314] border-r border-slate-200/80 dark:border-slate-800/80 select-none">
      {/* Search & Filter Header */}
      <div className="p-3.5 space-y-2.5 border-b border-slate-100 dark:border-slate-800/80">
        {/* M3 Search Bar */}
        <div className="relative flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-full px-3.5 py-2 ring-1 ring-slate-200/60 dark:ring-slate-700/60 focus-within:ring-2 focus-within:ring-[#0B57D0] dark:focus-within:ring-[#A8C7FA] focus-within:bg-white dark:focus-within:bg-[#1E1F20] transition-all">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0 mr-2.5" />
          <input
            id="string-search-input"
            type="text"
            placeholder={isAr ? 'ابحث بالمفتاح أو النص...' : 'Search key or text...'}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full text-xs bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="p-0.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title={isAr ? 'مسح البحث' : 'Clear search'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* M3 Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          {(
            [
              { id: 'all', label: isAr ? 'الكل' : 'All', count: counts.all },
              { id: 'untranslated', label: isAr ? 'غير مترجم' : 'Untranslated', count: counts.untranslated },
              { id: 'translated', label: isAr ? 'مترجم' : 'Done', count: counts.translated },
              ...(counts.needs_review > 0
                ? [{ id: 'needs_review', label: isAr ? 'مراجعة' : 'Review', count: counts.needs_review }]
                : []),
            ] as const
          ).map((chip) => {
            const isSelected = filterStatus === chip.id;
            return (
              <button
                key={chip.id}
                onClick={() => onFilterChange(chip.id as FilterStatus)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition cursor-pointer m3-state-layer ${
                  isSelected
                    ? 'bg-[#D3E3FD] text-[#041E49] dark:bg-[#0842A0] dark:text-[#D3E3FD]'
                    : 'bg-transparent text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                <span>{chip.label}</span>
                <span className="text-[10px] opacity-75 tabular-nums">({chip.count})</span>
              </button>
            );
          })}
        </div>

        {/* AI vs. Manual Input Summary Section */}
        <div
          id="sidebar-translation-stats-summary"
          className="rounded-xl bg-slate-50/90 dark:bg-[#191C24] border border-slate-200/80 dark:border-slate-800/90 p-2.5 space-y-2"
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
              <BarChart3 className="w-3.5 h-3.5 text-[#1EB996] shrink-0" />
              <span>{isAr ? 'ملخص مصدر الترجمة' : 'Translation Source Summary'}</span>
            </div>
            {sourceFilter !== 'all' && (
              <button
                type="button"
                onClick={() => handleSetSourceFilter('all')}
                className="text-[10px] font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:underline cursor-pointer"
              >
                {isAr ? 'عرض الكل' : 'Show All'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {/* AI Translated Stat Pill */}
            <button
              type="button"
              onClick={() => handleSetSourceFilter(sourceFilter === 'ai' ? 'all' : 'ai')}
              title={
                isAr
                  ? 'انقر لتصفية النصوص المترجمة بالذكاء الاصطناعي'
                  : 'Click to filter strings translated by AI'
              }
              className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition cursor-pointer ${
                sourceFilter === 'ai'
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-800 dark:text-amber-200 ring-1 ring-amber-500/30'
                  : 'bg-white dark:bg-[#13161C] border-slate-200/70 dark:border-slate-800 hover:border-amber-500/40 text-slate-700 dark:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-[11px] font-medium truncate">
                  {isAr ? 'ذكاء اصطناعي' : 'AI'}
                </span>
              </div>
              <div className="flex items-baseline gap-1 shrink-0 tabular-nums">
                <span className="text-xs font-bold">{counts.ai}</span>
                <span className="text-[9px] text-slate-400">({aiPercent}%)</span>
              </div>
            </button>

            {/* Manual Input Stat Pill */}
            <button
              type="button"
              onClick={() => handleSetSourceFilter(sourceFilter === 'manual' ? 'all' : 'manual')}
              title={
                isAr
                  ? 'انقر لتصفية النصوص المترجمة يدوياً'
                  : 'Click to filter strings translated manually'
              }
              className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition cursor-pointer ${
                sourceFilter === 'manual'
                  ? 'bg-[#1EB996]/15 border-[#1EB996]/50 text-emerald-900 dark:text-emerald-200 ring-1 ring-[#1EB996]/30'
                  : 'bg-white dark:bg-[#13161C] border-slate-200/70 dark:border-slate-800 hover:border-[#1EB996]/40 text-slate-700 dark:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Keyboard className="w-3.5 h-3.5 text-[#1EB996] shrink-0" />
                <span className="text-[11px] font-medium truncate">
                  {isAr ? 'يدوي' : 'Manual'}
                </span>
              </div>
              <div className="flex items-baseline gap-1 shrink-0 tabular-nums">
                <span className="text-xs font-bold">{counts.manual}</span>
                <span className="text-[9px] text-slate-400">({manualPercent}%)</span>
              </div>
            </button>
          </div>

          {/* Visual Split Bar */}
          <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden flex">
            {counts.ai > 0 && (
              <div
                style={{ width: `${(counts.ai / Math.max(1, counts.all)) * 100}%` }}
                className="h-full bg-amber-500 transition-all duration-300"
                title={`AI: ${counts.ai}`}
              />
            )}
            {counts.manual > 0 && (
              <div
                style={{ width: `${(counts.manual / Math.max(1, counts.all)) * 100}%` }}
                className="h-full bg-[#1EB996] transition-all duration-300"
                title={`Manual: ${counts.manual}`}
              />
            )}
          </div>
        </div>

        {/* QA Checks Section (Placeholders & HTML Tags Validation) */}
        <div
          id="sidebar-qa-checks-section"
          className="rounded-xl bg-slate-50/90 dark:bg-[#191C24] border border-slate-200/80 dark:border-slate-800/90 p-2.5 space-y-2"
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
              {qaSummary.totalAffectedItemsCount > 0 ? (
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              )}
              <span>{isAr ? 'فحوصات الجودة' : 'QA Checks'}</span>
            </div>

            <div className="flex items-center gap-1.5">
              {qaFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => {
                    setQaFilter('all');
                    setQaListExpanded(false);
                  }}
                  className="text-[10px] font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:underline cursor-pointer"
                >
                  {isAr ? 'إلغاء التصفية' : 'Clear Filter'}
                </button>
              )}
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums ${
                  qaSummary.totalAffectedItemsCount > 0
                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {qaSummary.totalAffectedItemsCount > 0
                  ? isAr
                    ? `${qaSummary.totalAffectedItemsCount} تنبيه`
                    : `${qaSummary.totalAffectedItemsCount} issue${qaSummary.totalAffectedItemsCount > 1 ? 's' : ''}`
                  : isAr
                    ? 'سليم'
                    : 'All Clear'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {/* Placeholders (%s, %d) Check Card */}
            <button
              type="button"
              onClick={() => {
                if (qaFilter === 'placeholder') {
                  setQaFilter('all');
                  setQaListExpanded(false);
                } else {
                  setQaFilter('placeholder');
                  if (qaSummary.placeholderIssueItemsCount > 0) setQaListExpanded(true);
                }
              }}
              title={
                isAr
                  ? 'انقر لتصفية النصوص التي تحتوي على أخطاء في العناصر النائبة (%s, %d)'
                  : 'Click to filter strings with missing or mismatched placeholders (%s, %d)'
              }
              className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition cursor-pointer ${
                qaFilter === 'placeholder'
                  ? 'bg-rose-500/15 border-rose-500/50 text-rose-800 dark:text-rose-200 ring-1 ring-rose-500/30'
                  : 'bg-white dark:bg-[#13161C] border-slate-200/70 dark:border-slate-800 hover:border-rose-500/40 text-slate-700 dark:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Braces className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span className="text-[11px] font-medium truncate">
                  {isAr ? 'المتغيرات %s' : 'Placeholders'}
                </span>
              </div>
              <span
                className={`text-xs font-bold tabular-nums shrink-0 ${
                  qaSummary.placeholderIssueItemsCount > 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {qaSummary.placeholderIssueItemsCount}
              </span>
            </button>

            {/* HTML Tags Check Card */}
            <button
              type="button"
              onClick={() => {
                if (qaFilter === 'html') {
                  setQaFilter('all');
                  setQaListExpanded(false);
                } else {
                  setQaFilter('html');
                  if (qaSummary.htmlIssueItemsCount > 0) setQaListExpanded(true);
                }
              }}
              title={
                isAr
                  ? 'انقر لتصفية النصوص التي تحتوي على أخطاء في وسوم HTML'
                  : 'Click to filter strings with invalid or missing HTML tags'
              }
              className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition cursor-pointer ${
                qaFilter === 'html'
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-800 dark:text-amber-200 ring-1 ring-amber-500/30'
                  : 'bg-white dark:bg-[#13161C] border-slate-200/70 dark:border-slate-800 hover:border-amber-500/40 text-slate-700 dark:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Code2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-[11px] font-medium truncate">
                  {isAr ? 'وسوم HTML' : 'HTML Tags'}
                </span>
              </div>
              <span
                className={`text-xs font-bold tabular-nums shrink-0 ${
                  qaSummary.htmlIssueItemsCount > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {qaSummary.htmlIssueItemsCount}
              </span>
            </button>
          </div>

          {qaSummary.allIssues.length > 0 && (
            <div className="pt-1 border-t border-slate-200/60 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => setQaListExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 transition cursor-pointer"
              >
                <span className="truncate">
                  {isAr
                    ? `عرض تفاصيل المشاكل (${qaSummary.allIssues.length})`
                    : `View Detected Issues (${qaSummary.allIssues.length})`}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
                    qaListExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {qaListExpanded && (
                <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto pr-0.5">
                  {qaSummary.allIssues
                    .filter((iss) => {
                      if (qaFilter === 'placeholder') return iss.category === 'placeholder';
                      if (qaFilter === 'html') return iss.category === 'html';
                      return true;
                    })
                    .map((iss) => (
                      <button
                        key={iss.id}
                        type="button"
                        onClick={() => onSelect(iss.itemId)}
                        className="w-full text-left px-2 py-1.5 rounded-lg bg-white dark:bg-[#13161C] border border-rose-200/70 dark:border-rose-900/40 hover:border-rose-400 transition cursor-pointer flex flex-col gap-0.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[10px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {iss.itemName}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-semibold shrink-0 ${
                              iss.category === 'placeholder'
                                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                            }`}
                          >
                            {iss.category === 'placeholder' ? '%s/%d' : 'HTML'}
                          </span>
                        </div>
                        <span className="text-[10px] text-rose-600 dark:text-rose-400 line-clamp-1">
                          {isAr ? iss.messageAr : iss.messageEn}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bulk Selection & AI Translation Bar */}
        {onBulkUpdateTranslations && (
          <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/70 text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                id="stringlist-select-untranslated-btn"
                type="button"
                onClick={handleToggleSelectUntranslated}
                disabled={filteredUntranslated.length === 0 || isBulkTranslating}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition cursor-pointer disabled:opacity-40 disabled:pointer-events-none truncate"
                title={isAr ? 'تحديد كل النصوص غير المترجمة' : 'Select all untranslated strings in current view'}
              >
                {allFilteredUntranslatedSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span className="truncate">
                  {isAr ? `تحديد غير المترجم (${filteredUntranslated.length})` : `Select Untranslated (${filteredUntranslated.length})`}
                </span>
              </button>

              {checkedIds.size > 0 && !isBulkTranslating && (
                <button
                  type="button"
                  onClick={() => setCheckedIds(new Set())}
                  className="px-1.5 py-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer shrink-0"
                  title={isAr ? 'إلغاء التحديد' : 'Clear selection'}
                >
                  {isAr ? 'إلغاء' : 'Clear'}
                </button>
              )}
            </div>

            {checkedIds.size > 0 && (
              <button
                id="stringlist-bulk-translate-btn"
                type="button"
                onClick={handleBulkTranslate}
                disabled={isBulkTranslating}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#1EB996] hover:bg-[#19A585] text-white font-semibold shadow-2xs transition cursor-pointer disabled:opacity-60 shrink-0"
                title={isAr ? 'ترجمة النصوص المحددة دفعة واحدة' : 'Bulk translate selected strings'}
              >
                {isBulkTranslating ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>
                      {bulkProgress ? `${bulkProgress.completed}/${bulkProgress.total}` : isAr ? 'جارٍ الترجمة...' : 'Translating...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    <span>{isAr ? `ترجمة (${checkedIds.size})` : `Translate (${checkedIds.size})`}</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* String Items List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredItems.length === 0 ? (
          <div className="py-12 px-4 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
            <p className="font-medium text-slate-700 dark:text-slate-300">
              {isAr ? 'لا توجد نصوص مطابقة' : 'No strings match filter'}
            </p>
            <p className="text-[11px]">
              {isAr ? 'جرّب مسح البحث أو تغيير عوامل التصفية.' : 'Try clearing search or changing the filter chips.'}
            </p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isSelected = item.id === selectedId;
            const isChecked = checkedIds.has(item.id);

            // Preview snippets (prefer sub-item matching searchQuery for plurals/arrays)
            let sourceSnippet = '';
            let targetSnippet = '';
            const trimmedQuery = searchQuery.trim().toLowerCase();
            if (item.type === 'string') {
              sourceSnippet = item.source || '';
              targetSnippet = item.target || '';
            } else if (item.type === 'plural' || item.type === 'array') {
              const subItems = item.items || [];
              const matchedSubItem = trimmedQuery
                ? subItems.find(
                    (sub) =>
                      (sub.source || '').toLowerCase().includes(trimmedQuery) ||
                      (sub.target || '').toLowerCase().includes(trimmedQuery)
                  )
                : undefined;
              const previewItem = matchedSubItem || subItems[0];
              sourceSnippet = previewItem?.source || '';
              targetSnippet = previewItem?.target || '';
            }

            return (
              <button
                key={item.id}
                id={`string-item-${item.name}`}
                onClick={() => onSelect(item.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-2xl transition-all cursor-pointer flex flex-col gap-1 m3-state-layer ${
                  isSelected
                    ? 'bg-[#E8F0FE] dark:bg-[#1E293B] shadow-xs ring-1 ring-[#0B57D0]/30 dark:ring-[#A8C7FA]/30'
                    : isChecked
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/20 ring-1 ring-[#1EB996]/40'
                      : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                }`}
              >
                {/* Header: Checkbox, Status, Key & Type */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {onBulkUpdateTranslations && (
                      <span
                        role="checkbox"
                        aria-checked={isChecked}
                        onClick={(e) => toggleItemChecked(item.id, e)}
                        className="p-0.5 -ml-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700/70 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition shrink-0"
                        title={isAr ? 'تحديد للترجمة الجماعية' : 'Select for bulk translation'}
                      >
                        {isChecked ? (
                          <CheckSquare className="w-3.5 h-3.5 text-[#1EB996]" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </span>
                    )}
                    {item.status === 'translated' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : item.status === 'needs_review' ? (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                    )}
                    <span
                      className={`font-mono text-xs truncate ${
                        isSelected
                          ? 'font-semibold text-[#0B57D0] dark:text-[#A8C7FA]'
                          : 'font-medium text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {highlightText(item.name, searchQuery)}
                    </span>
                  </div>

                  {/* Right: QA Badge, Source Badge (AI vs Manual), Individual Reset Button & Type indicator */}
                  <div className="flex items-center gap-1 shrink-0">
                    {(() => {
                      const itemQa = qaSummary.byItemId.get(item.id);
                      if (!itemQa) return null;
                      const tooltip = itemQa.issues
                        .map((i) => (isAr ? i.messageAr : i.messageEn))
                        .join('\n');
                      return (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-300 text-[9px] font-semibold ring-1 ring-rose-500/30"
                          title={tooltip}
                        >
                          <ShieldAlert className="w-2.5 h-2.5 shrink-0" />
                          <span>
                            {itemQa.hasPlaceholderIssue && itemQa.hasHtmlIssue
                              ? isAr
                                ? 'جودة'
                                : 'QA'
                              : itemQa.hasPlaceholderIssue
                                ? '%s'
                                : 'HTML'}
                          </span>
                        </span>
                      );
                    })()}
                    {item.status !== 'untranslated' && (
                      <>
                        <span
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                            item.translationSource === 'ai'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          }`}
                          title={
                            item.translationSource === 'ai'
                              ? isAr
                                ? 'مترجم بالذكاء الاصطناعي'
                                : 'Translated with AI'
                              : isAr
                                ? 'إدخال يدوي'
                                : 'Manual input'
                          }
                        >
                          {item.translationSource === 'ai' ? (
                            <>
                              <Sparkles className="w-2.5 h-2.5" />
                              <span>{isAr ? 'ذكاء اصطناعي' : 'AI'}</span>
                            </>
                          ) : (
                            <span>{isAr ? 'يدوي' : 'Manual'}</span>
                          )}
                        </span>

                        {onResetItemHistory && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              onResetItemHistory(item.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                e.preventDefault();
                                onResetItemHistory(item.id);
                              }
                            }}
                            className="p-1 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                            title={
                              isAr
                                ? 'إعادة تعيين سجل وترجمة هذا النص'
                                : 'Reset individual translation history'
                            }
                          >
                            <RotateCcw className="w-3 h-3" />
                          </span>
                        )}
                      </>
                    )}

                    {/* Clean unboxed type indicator */}
                    {item.type !== 'string' && (
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                        {isAr ? (item.type === 'plural' ? 'جمع' : 'مصفوفة') : item.type}
                      </span>
                    )}
                  </div>
                </div>

                {/* Source English preview */}
                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1 pl-5.5">
                  {sourceSnippet ? (
                    highlightText(sourceSnippet, searchQuery)
                  ) : (
                    <span className="italic text-slate-400">{isAr ? 'نص فارغ' : 'Empty string'}</span>
                  )}
                </p>

                {/* Target translation preview */}
                <p className="text-[11px] line-clamp-1 pl-5.5">
                  {targetSnippet ? (
                    <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                      {highlightText(targetSnippet, searchQuery)}
                    </span>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500 italic">
                      {isAr ? 'غير مترجم' : 'Untranslated'}
                    </span>
                  )}
                </p>
              </button>
            );
          })
        )}
      </div>

      {/* Footer count indicator */}
      <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span className="tabular-nums">
          {isAr
            ? `عرض ${filteredItems.length} من ${items.length}`
            : `Showing ${filteredItems.length} of ${items.length}`}
        </span>
        <span className="font-mono text-[10px] text-slate-400">
          {isAr ? 'Ctrl+↵ حفظ' : 'Ctrl+↵ Save'}
        </span>
      </div>
    </div>
  );
};
