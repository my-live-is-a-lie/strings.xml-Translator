import React, { useState, useMemo } from 'react';
import { X, Download, Copy, Check, Sliders, Folder, Filter, ShieldAlert, ChevronDown } from 'lucide-react';
import { useDialog } from '../utils/useDialog';
import { FilterStatus, SourceFilter, TranslationProject } from '../types';
import { copyTextToClipboard } from '../utils/storage';
import { analyzeProjectQa } from '../utils/placeholderCheck';
import {
  generateAndroidXml,
  downloadXmlFile,
  ExportOptions,
  defaultExportOptions,
  filterProjectItems,
} from '../utils/xmlExporter';
import { useT } from '../i18n/i18n';

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
  const { t, tb } = useT();
  const isAr = appLang === 'ar';
  const dialogRef = useDialog(isOpen, onClose);
  const [options, setOptions] = useState<ExportOptions>(defaultExportOptions);
  const [copied, setCopied] = useState(false);
  // The placeholder/tag warning starts collapsed; its title toggles it open/closed.
  const [warningExpanded, setWarningExpanded] = useState(false);
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

  // Wrong or missing placeholders (%s, %1$d, tags) crash or garble the app at runtime, so exporting them needs a deliberate OK
  const [allowBroken, setAllowBroken] = useState(false);
  const blockingIssues = useMemo(
    () =>
      analyzeProjectQa(itemsToExport).allIssues.filter(
        (iss) => iss.severity === 'error' && (iss.category === 'placeholder' || iss.category === 'html')
      ),
    [itemsToExport]
  );
  const exportBlocked = blockingIssues.length > 0 && !allowBroken;

  // Generate XML dynamically based on options and active filter
  const generatedXml = useMemo(() => {
    return generateAndroidXml(itemsToExport, options, project);
  }, [itemsToExport, options, project]);

  if (!isOpen) return null;

  const handleDownload = () => {
    if (exportBlocked) return;
    const filename = `strings.xml`;
    downloadXmlFile(generatedXml, filename);
  };

  const handleCopy = () => {
    if (exportBlocked) return;
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
    activeFilterParts.push(t('untranslated'));
  } else if (activeFilterStatus === 'translated') {
    activeFilterParts.push(t('translated'));
  } else if (activeFilterStatus === 'needs_review') {
    activeFilterParts.push(t('needs_review'));
  }

  if (activeSourceFilter === 'ai') {
    activeFilterParts.push(t('ai_translated'));
  } else if (activeSourceFilter === 'manual') {
    activeFilterParts.push(t('manual_input'));
  }

  if (searchQuery.trim()) activeFilterParts.push(`"${searchQuery.trim()}"`);

  const activeFilterLabel =
    activeFilterParts.length > 0
      ? activeFilterParts.join(' • ')
      : t('all_strings');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
      {/* Material 3 Dialog Container */}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ExportModal-title" tabIndex={-1} className="outline-none w-full max-w-2xl bg-white dark:bg-[#1E1F20] rounded-3xl m3-elevation-3 border border-slate-200/80 dark:border-slate-800/80 overflow-hidden flex flex-col my-6 max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h2 data-i18n id="ExportModal-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('export_android_strings_xml')}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {options.onlyMatchingFilter
                  ? t('exporting_of_strings', filteredItems.length, totalCount, activeFilterLabel)
                  : t('production_ready_resource_file_of', translatedCount, totalCount)}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('close')}
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer m3-state-layer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-2 space-y-4 flex-1 overflow-y-auto">
          {/* Target Folder Placement Guide */}
          <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 text-xs text-slate-700 dark:text-slate-300">
            <Folder className="w-4 h-4 text-[#0B57D0] dark:text-[#A8C7FA] shrink-0 mt-0.5" />
            <div>
              <p data-i18n className="font-semibold text-slate-900 dark:text-slate-100">
                {t('android_studio_destination')}
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
              <span data-i18n>{t('export_options')}</span>
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.fallbackToSource}
                  onChange={(e) => setOptions({ ...options, fallbackToSource: e.target.checked })}
                  className="rounded border-slate-300 text-[#0B57D0] focus:ring-[#0B57D0] cursor-pointer"
                />
                <span data-i18n>
                  {t('fallback_to_english_for_untranslated')}
                </span>
              </label>

              <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.autoEscapeApostrophes}
                  onChange={(e) => setOptions({ ...options, autoEscapeApostrophes: e.target.checked })}
                  className="rounded border-slate-300 text-[#0B57D0] focus:ring-[#0B57D0] cursor-pointer"
                />
                <span data-i18n>
                  {t('auto_escape_apostrophes_for_aapt2')}
                </span>
              </label>

              <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={options.includeComments}
                  onChange={(e) => setOptions({ ...options, includeComments: e.target.checked })}
                  className="rounded border-slate-300 text-[#0B57D0] focus:ring-[#0B57D0] cursor-pointer"
                />
                <span data-i18n>{t('include_comments')}</span>
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
                  <span data-i18n>
                    {t('export_only_strings_matching_active')}
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
                    { id: 'all', label: t('all'), count: totalCount },
                    {
                      id: 'untranslated',
                      label: t('untranslated'),
                      count: untranslatedCount,
                    },
                    {
                      id: 'translated',
                      label: t('translated'),
                      count: translatedCount,
                    },
                    ...(reviewCount > 0
                      ? [
                          {
                            id: 'needs_review',
                            label: t('needs_review'),
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
                      <span className="tabular-nums">({chip.count})</span>
                    </button>
                  );
                })}

                {(
                  [
                    { id: 'ai', label: t('ai_translated'), count: aiCount },
                    { id: 'manual', label: t('manual_input'), count: manualCount },
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
                      <span className="tabular-nums">({srcChip.count})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Live XML Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span data-i18n className="font-semibold text-slate-700 dark:text-slate-300">
                {t('live_preview')}
              </span>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-[#0B57D0] dark:text-[#A8C7FA] hover:underline cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>
                  {copied
                    ? t('copied')
                    : t('copy_raw_xml')}
                </span>
              </button>
            </div>

            <div
              dir="ltr"
              tabIndex={0}
              role="region"
              aria-label={t('xml_preview')}
              className="max-h-60 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#111318] text-slate-100 p-4 font-mono text-[11px] leading-relaxed select-all"
            >
              <pre className="whitespace-pre">{generatedXml}</pre>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        {blockingIssues.length > 0 && (
          <div
            role="alert"
            className="mx-6 mb-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300"
          >
            <button
              type="button"
              onClick={() => setWarningExpanded((v) => !v)}
              aria-expanded={warningExpanded}
              className="w-full flex items-center justify-between gap-2 font-semibold cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span data-i18n>
                  {t('placeholder_tag_error_s_may', blockingIssues.length)}
                </span>
              </span>
              <ChevronDown
                className={`w-4 h-4 shrink-0 transition-transform ${warningExpanded ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            {warningExpanded && (
              <>
                <ul className="mt-2 space-y-0.5 ps-5 list-disc">
                  {blockingIssues.slice(0, 5).map((iss) => (
                    <li key={iss.id}>
                      <span className="font-mono">{iss.itemName}</span>: {isAr ? iss.messageAr : iss.messageEn}
                    </li>
                  ))}
                  {blockingIssues.length > 5 && (
                    <li data-i18n>{t('and_more', blockingIssues.length - 5)}</li>
                  )}
                </ul>
                <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
                  <input
                    id="export-allow-broken"
                    type="checkbox"
                    checked={allowBroken}
                    onChange={(e) => setAllowBroken(e.target.checked)}
                    className="w-4 h-4 accent-rose-600"
                  />
                  <span data-i18n>{t('i_understand_the_risk_export')}</span>
                </label>
              </>
            )}
          </div>
        )}

        <div className="p-6 pt-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
          >
            {tb('close')}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={exportBlocked}
              className="disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition cursor-pointer m3-state-layer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>
                {copied
                  ? t('copied_2')
                  : t('copy_xml')}
              </span>
            </button>
            <button
              onClick={handleDownload}
              disabled={exportBlocked}
              aria-disabled={exportBlocked}
              className="disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#A8C7FA] dark:hover:bg-[#82AAFA] text-white dark:text-[#062E6F] text-xs font-semibold shadow-xs transition cursor-pointer m3-state-layer"
            >
              <Download className="w-4 h-4" />
              <span data-i18n>{t('download_strings_xml')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
