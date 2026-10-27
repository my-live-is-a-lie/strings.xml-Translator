import React, { useMemo, useState } from 'react';
import { BarChart3, ChevronDown, Keyboard, RotateCcw, Sparkles } from 'lucide-react';
import { TranslationProject } from '../types';

interface TranslationStatsSectionProps {
  project: TranslationProject;
  isAr: boolean;
  onSelectString?: (id: string) => void;
  onResetItemHistory?: (id: string) => void;
  /** Called after a string is picked so the host drawer can close */
  onClose: () => void;
}

export const TranslationStatsSection: React.FC<TranslationStatsSectionProps> = ({
  project,
  isAr,
  onSelectString,
  onResetItemHistory,
  onClose,
}) => {
  const [historyListExpanded, setHistoryListExpanded] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'ai' | 'manual'>('all');

  const { aiTranslatedCount, manualTranslatedCount, totalTranslatedCount, aiPercent, manualPercent, filteredHistoryItems } = useMemo(() => {
    const translated = project.items.filter((i) => i.status !== 'untranslated');
    let ai = 0;
    let manual = 0;
    for (const item of translated) {
      if (item.translationSource === 'ai') ai++;
      else manual++;
    }
    const total = translated.length;
    const aiPct = total > 0 ? Math.round((ai / total) * 100) : 0;
    const manualPct = total > 0 ? 100 - aiPct : 0;
    const history = translated.filter((item) => {
      if (historyFilter === 'ai') return item.translationSource === 'ai';
      if (historyFilter === 'manual') return item.translationSource !== 'ai';
      return true;
    });
    return {
      aiTranslatedCount: ai,
      manualTranslatedCount: manual,
      totalTranslatedCount: total,
      aiPercent: aiPct,
      manualPercent: manualPct,
      filteredHistoryItems: history,
    };
  }, [project.items, historyFilter]);

  return (
    <div
      id="drawer-translation-stats-section"
      className="flex flex-col shrink-0 rounded-2xl border border-slate-200/90 dark:border-[#2F384B] bg-slate-100/80 dark:bg-[#202634] p-3.5 gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="w-4 h-4 text-[#1EB996] shrink-0" />
          <span className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
            {isAr ? 'إحصائيات الترجمة' : 'Translation Statistics'}
          </span>
        </div>
        <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 shrink-0 tabular-nums">
          {totalTranslatedCount}/{project.items.length}
        </span>
      </div>

      {/* AI vs. Manual Cards */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            if (historyListExpanded && historyFilter === 'ai') {
              setHistoryListExpanded(false);
              setHistoryFilter('all');
            } else {
              setHistoryFilter('ai');
              setHistoryListExpanded(true);
            }
          }}
          className={`flex flex-col gap-1 p-2.5 rounded-xl border text-start transition cursor-pointer ${
            historyFilter === 'ai' && historyListExpanded
              ? 'bg-amber-500/15 border-amber-500/50 ring-1 ring-amber-500/30'
              : 'bg-white dark:bg-[#171C27] border-slate-200/80 dark:border-[#2B3346] hover:border-amber-500/40'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
              <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="truncate">{isAr ? 'ذكاء اصطناعي' : 'AI Translated'}</span>
            </span>
            <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 tabular-nums">
              {aiPercent}%
            </span>
          </div>
          <span className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
            {aiTranslatedCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (historyListExpanded && historyFilter === 'manual') {
              setHistoryListExpanded(false);
              setHistoryFilter('all');
            } else {
              setHistoryFilter('manual');
              setHistoryListExpanded(true);
            }
          }}
          className={`flex flex-col gap-1 p-2.5 rounded-xl border text-start transition cursor-pointer ${
            historyFilter === 'manual' && historyListExpanded
              ? 'bg-[#1EB996]/15 border-[#1EB996]/50 ring-1 ring-[#1EB996]/30'
              : 'bg-white dark:bg-[#171C27] border-slate-200/80 dark:border-[#2B3346] hover:border-[#1EB996]/40'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
              <Keyboard className="w-3.5 h-3.5 text-[#1EB996] shrink-0" />
              <span className="truncate">{isAr ? 'إدخال يدوي' : 'Manual Input'}</span>
            </span>
            <span className="text-[10px] font-mono text-[#1EB996] tabular-nums">
              {manualPercent}%
            </span>
          </div>
          <span className="text-base font-bold text-slate-900 dark:text-white tabular-nums">
            {manualTranslatedCount}
          </span>
        </button>
      </div>

      {/* Progress Ratio Bar */}
      <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-[#141821] overflow-hidden flex">
        {aiTranslatedCount > 0 && (
          <div
            style={{
              width: `${(aiTranslatedCount / Math.max(1, project.items.length)) * 100}%`,
            }}
            className="h-full bg-amber-500 transition-all duration-300"
          />
        )}
        {manualTranslatedCount > 0 && (
          <div
            style={{
              width: `${(manualTranslatedCount / Math.max(1, project.items.length)) * 100}%`,
            }}
            className="h-full bg-[#1EB996] transition-all duration-300"
          />
        )}
      </div>

      {/* Expandable Individual Translation History & Reset List */}
      <div className="pt-1 border-t border-slate-200/70 dark:border-[#2B3346]">
        <button
          id="drawer-toggle-history-list-btn"
          type="button"
          onClick={() => {
            setHistoryListExpanded((prev) => {
              const next = !prev;
              if (!next) setHistoryFilter('all');
              return next;
            });
          }}
          className="w-full flex items-center justify-between gap-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-[#1EB996] dark:hover:text-[#1EB996] transition cursor-pointer"
        >
          <span className="flex items-center gap-1.5 truncate">
            <RotateCcw className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">
              {isAr
                ? `سجل الترجمات وإعادة التعيين (${filteredHistoryItems.length})`
                : `Translation History & Reset (${filteredHistoryItems.length})`}
            </span>
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
              historyListExpanded ? 'rotate-180' : ''
            }`}
          />
        </button>

        {historyListExpanded && (
          <div className="mt-2 space-y-1.5 max-h-52 overflow-y-auto pe-0.5">
            {filteredHistoryItems.length === 0 ? (
              <p className="text-[11px] text-slate-600 dark:text-slate-400 text-center py-3">
                {isAr ? 'لا توجد نصوص مترجمة حالياً' : 'No translated strings yet'}
              </p>
            ) : (
              filteredHistoryItems.map((tItem) => {
                const preview =
                  tItem.type === 'string'
                    ? tItem.target
                    : tItem.items.find((sub) => sub.target.trim())?.target || '';
                const isAi = tItem.translationSource === 'ai';

                return (
                  <div
                    key={tItem.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-white dark:bg-[#171C27] border border-slate-200/70 dark:border-[#2B3346] text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectString?.(tItem.id);
                        onClose();
                      }}
                      className="flex flex-col flex-1 min-w-0 overflow-hidden text-start cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {tItem.name}
                        </span>
                        <span
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-semibold shrink-0 ${
                            isAi
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                              : 'bg-[#1EB996]/15 text-emerald-700 dark:text-[#1EB996]'
                          }`}
                        >
                          {isAi ? (isAr ? 'ذكاء اصطناعي' : 'AI') : isAr ? 'يدوي' : 'Manual'}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400 truncate w-full">
                        {preview}
                      </span>
                    </button>

                    {onResetItemHistory && (
                      <button
                        type="button"
                        onClick={() => onResetItemHistory(tItem.id)}
                        title={
                          isAr
                            ? `إعادة تعيين ترجمة "${tItem.name}"`
                            : `Reset translation history for "${tItem.name}"`
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-rose-500/15 dark:bg-[#222938] dark:hover:bg-rose-500/20 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-300 text-[10px] font-medium transition cursor-pointer shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{isAr ? 'إعادة تعيين' : 'Reset'}</span>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
