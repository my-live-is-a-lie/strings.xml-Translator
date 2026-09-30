import React, { useState, useMemo } from 'react';
import { X, Download, Copy, Check, Sliders, Folder, Filter } from 'lucide-react';
import { FilterStatus, SourceFilter, TranslationProject } from '../types';
import { copyTextToClipboard } from '../utils/storage';
import {
  generateAndroidXml,
  downloadXmlFile,
  ExportOptions,
  defaultExportOptions,
  filterProjectItems,
} from '../utils/xmlExporter';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: TranslationProject;
  filterStatus?: FilterStatus;
  onFilterChange?: (status: FilterStatus) => void;
  sourceFilter?: SourceFilter;
  onSourceFilterChange?: (source: SourceFilter) => void;
  searchQuery?: string;
  appLang?: 'ar' | 'en';
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  project,
  filterStatus: externalFilterStatus = 'all',
  onFilterChange,
  sourceFilter: externalSourceFilter = 'all',
  onSourceFilterChange,
  searchQuery = '',
  appLang = 'ar',
}) => {
  const isAr = appLang === 'ar';
  const [options, setOptions] = useState<ExportOptions>(defaultExportOptions);
  const [copied, setCopied] = useState(false);
  const [localFilterStatus, setLocalFilterStatus] = useState<FilterStatus>('all');
  const [localSourceFilter, setLocalSourceFilter] = useState<SourceFilter>('all');

  const activeFilterStatus = onFilterChange ? externalFilterStatus : localFilterStatus;
  const activeSourceFilter = onSourceFilterChange ? externalSourceFilter : localSourceFilter;

  const setFilterStatus = (status: FilterStatus) => {
    if (onFilterChange) onFilterChange(status);
    else setLocalFilterStatus(status);
  };

  const setSourceFilter = (source: SourceFilter) => {
    if (onSourceFilterChange) onSourceFilterChange(source);
    else setLocalSourceFilter(source);
  };

  // Compute strings matching the current active filter
  const filteredItems = useMemo(() => {
    return filterProjectItems(
      project.items,
      activeFilterStatus,
      searchQuery,
      activeSourceFilter
    );
  }, [project.items, activeFilterStatus, searchQuery, activeSourceFilter]);

  const itemsToExport = options.onlyMatchingFilter ? filteredItems : project.items;

  // Generate XML dynamically based on options and active filter
  const generatedXml = useMemo(() => {
    return generateAndroidXml(itemsToExport, options, project);
  }, [itemsToExport, options, project]);

  if (!isOpen) return null;

  const handleDownload = () => {
    const filename = `strings.xml`;
    downloadXmlFile(generatedXml, filename);
  };

  const handleCopy = () => {
    void copyTextToClipboard(generatedXml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Counts for filter pills and summary
  const totalCount = project.items.length;
  const translatedCount = project.items.filter((i) => i.status === 'translated').length;
  const untranslatedCount = project.items.filter((i) => i.status === 'untranslated').length;
  const reviewCount = project.items.filter((i) => i.status === 'needs_review').length;
  const aiCount = project.items.filter(
    (i) => i.status !== 'untranslated' && i.translationSource === 'ai'
  ).length;
  const manualCount = project.items.filter(
    (i) => i.status !== 'untranslated' && i.translationSource !== 'ai'
  ).length;

  // Describe active filter for badge
  const activeFilterParts: string[] = [];
  if (activeFilterStatus === 'untranslated') {
    activeFilterParts.push(isAr ? 'غير مترجم' : 'Untranslated');
  } else if (activeFilterStatus === 'translated') {
    activeFilterParts.push(isAr ? 'مترجم' : 'Translated');
  } else if (activeFilterStatus === 'needs_review') {
    activeFilterParts.push(isAr ? 'يحتاج مراجعة' : 'Needs Review');
  }

  if (activeSourceFilter === 'ai') {
    activeFilterParts.push(isAr ? 'ذكاء اصطناعي' : 'AI Translated');
  } else if (activeSourceFilter === 'manual') {
    activeFilterParts.push(isAr ? 'إدخال يدوي' : 'Manual Input');
  }

  if (searchQuery.trim()) activeFilterParts.push(`"${searchQuery.trim()}"`);

  const activeFilterLabel =
    activeFilterParts.length > 0
      ? activeFilterParts.join(' • ')
      : isAr
        ? 'جميع النصوص'
        : 'All strings';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      {/* Material 3 Dialog Container */}
      <div className="w-full max-w-2xl bg-white dark:bg-[#1E1F20] rounded-3xl m3-elevation-3 border border-slate-200/80 dark:border-slate-800/80 overflow-hidden flex flex-col my-6 max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 dark:text-emerald-300">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {isAr ? 'تصدير ملف strings.xml لأندرويد' : 'Export Android strings.xml'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {options.onlyMatchingFilter
                  ? isAr
                    ? `تصدير ${filteredItems.length} من أصل ${totalCount} نص (${activeFilterLabel})`
                    : `Exporting ${filteredItems.length} of ${totalCount} strings (${activeFilterLabel})`
                  : isAr
                    ? `ملف موارد جاهز للإنتاج (${translatedCount} من ${totalCount} مترجم)`
                    : `Production-ready resource file (${translatedCount} of ${totalCount} translated)`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer m3-state-layer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-2 space-y-4 flex-1 overflow-y-auto">
          {/* Target Folder Placement Guide */}
          <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 text-xs text-slate-700 dark:text-slate-300">
            <Folder className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                {isAr ? 'مسار المجلد في أندرويد ستوديو:' : 'Android Studio Destination:'}
              </p>
              <code
                dir="ltr"
                className="font-mono text-[11px] bg-white dark:bg-slate-900 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 mt-1 inline-block text-[#0B57D0] dark:text-[#A8C7FA]"
              >
                app/src/main/res/values-{project.targetLang}/strings.xml
              </code>
            </div>
          </div>

          {/* Export Settings */}
          <div className="bg-slate-50/60 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200/70 dark:border-slate-800/80 space-y-3">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-slate-500" />
              <span>{isAr ? 'خيارات التصدير' : 'Export Options'}</span>
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.fallbackToSource}
                  onChange={(e) => setOptions({ ...options, fallbackToSource: e.target.checked })}
                  className="rounded border-slate-300 text-[#0B57D0] focus:ring-[#0B57D0] cursor-pointer"
                />
                <span>
                  {isAr
                    ? 'استخدام النص الإنجليزي للنصوص غير المترجمة'
                    : 'Fallback to English for untranslated'}
                </span>
              </label>

              <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.autoEscapeApostrophes}
                  onChange={(e) => setOptions({ ...options, autoEscapeApostrophes: e.target.checked })}
                  className="rounded border-slate-300 text-[#0B57D0] focus:ring-[#0B57D0] cursor-pointer"
                />
                <span>
                  {isAr
                    ? "تهريب الفواصل العلوية تلقائياً (\\')"
                    : "Auto-escape apostrophes (\\') for AAPT2"}
                </span>
              </label>

              <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includeComments}
                  onChange={(e) => setOptions({ ...options, includeComments: e.target.checked })}
                  className="rounded border-slate-300 text-[#0B57D0] focus:ring-[#0B57D0] cursor-pointer"
                />
                <span>{isAr ? 'تضمين التعليقات' : 'Include comments'}</span>
              </label>
            </div>

            {/* Active Filter Export Option */}
            <div className="pt-2.5 border-t border-slate-200/70 dark:border-slate-700/70 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
                  <input
                    id="export-only-matching-filter-checkbox"
                    type="checkbox"
                    checked={Boolean(options.onlyMatchingFilter)}
                    onChange={(e) =>
                      setOptions({ ...options, onlyMatchingFilter: e.target.checked })
                    }
                    className="rounded border-slate-300 text-[#0B57D0] focus:ring-[#0B57D0] cursor-pointer"
                  />
                  <span>
                    {isAr
                      ? 'تصدير النصوص المطابقة للتصفية النشطة فقط'
                      : 'Export only strings matching active filter'}
                  </span>
                </label>

                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#D3E3FD]/80 text-[#041E49] dark:bg-[#0842A0]/70 dark:text-[#D3E3FD] tabular-nums">
                  <Filter className="w-3 h-3" />
                  <span>
                    {activeFilterLabel}: {filteredItems.length}/{totalCount}
                  </span>
                </span>
              </div>

              {/* Quick Filter Selector Pills synced with Active Filter */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {(
                  [
                    { id: 'all', label: isAr ? 'الكل' : 'All', count: totalCount },
                    {
                      id: 'untranslated',
                      label: isAr ? 'غير مترجم' : 'Untranslated',
                      count: untranslatedCount,
                    },
                    {
                      id: 'translated',
                      label: isAr ? 'مترجم' : 'Translated',
                      count: translatedCount,
                    },
                    ...(reviewCount > 0
                      ? [
                          {
                            id: 'needs_review',
                            label: isAr ? 'يحتاج مراجعة' : 'Needs Review',
                            count: reviewCount,
                          },
                        ]
                      : []),
                  ] as const
                ).map((chip) => {
                  const isSelected =
                    activeFilterStatus === chip.id && activeSourceFilter === 'all';
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => {
                        setFilterStatus(chip.id as FilterStatus);
                        setSourceFilter('all');
                        setOptions((prev) => ({
                          ...prev,
                          onlyMatchingFilter: chip.id !== 'all' ? true : prev.onlyMatchingFilter,
                        }));
                      }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#0B57D0] text-white dark:bg-[#A8C7FA] dark:text-[#062E6F]'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{chip.label}</span>
                      <span className="opacity-75 tabular-nums">({chip.count})</span>
                    </button>
                  );
                })}

                {(
                  [
                    { id: 'ai', label: isAr ? 'ذكاء اصطناعي' : 'AI Translated', count: aiCount },
                    { id: 'manual', label: isAr ? 'إدخال يدوي' : 'Manual Input', count: manualCount },
                  ] as const
                ).map((srcChip) => {
                  const isSelected = activeSourceFilter === srcChip.id;
                  return (
                    <button
                      key={srcChip.id}
                      type="button"
                      onClick={() => {
                        const nextSource = activeSourceFilter === srcChip.id ? 'all' : srcChip.id;
                        setSourceFilter(nextSource);
                        if (nextSource !== 'all') {
                          setFilterStatus('all');
                          setOptions((prev) => ({ ...prev, onlyMatchingFilter: true }));
                        }
                      }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#1EB996] text-white'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{srcChip.label}</span>
                      <span className="opacity-75 tabular-nums">({srcChip.count})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Live XML Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {isAr ? 'معاينة مباشرة لملف XML' : 'Live Preview'}
              </span>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-[#0B57D0] dark:text-[#A8C7FA] hover:underline cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>
                  {copied
                    ? isAr
                      ? 'تم النسخ!'
                      : 'Copied!'
                    : isAr
                      ? 'نسخ كود XML الخام'
                      : 'Copy raw XML'}
                </span>
              </button>
            </div>

            <div
              dir="ltr"
              className="max-h-60 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#111318] text-slate-100 p-4 font-mono text-[11px] leading-relaxed select-all"
            >
              <pre className="whitespace-pre">{generatedXml}</pre>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 pt-4 flex items-center justify-between">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition cursor-pointer m3-state-layer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>
              {copied
                ? isAr
                  ? 'تم النسخ'
                  : 'Copied'
                : isAr
                  ? 'نسخ XML'
                  : 'Copy XML'}
            </span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
            >
              {isAr ? 'إغلاق' : 'Close'}
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#A8C7FA] dark:hover:bg-[#82AAFA] text-white dark:text-[#062E6F] text-xs font-semibold shadow-xs transition cursor-pointer m3-state-layer"
            >
              <Download className="w-4 h-4" />
              <span>{isAr ? 'تنزيل strings.xml' : 'Download strings.xml'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
