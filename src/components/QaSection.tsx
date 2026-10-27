import React, { useMemo, useState } from 'react';
import { Braces, ChevronDown, Code2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { TranslationProject } from '../types';
import { analyzeProjectQa } from '../utils/placeholderCheck';

interface QaSectionProps {
  project: TranslationProject;
  isAr: boolean;
  onSelectString?: (id: string) => void;
  /** Called after a string is picked so the host drawer can close */
  onClose: () => void;
}

export const QaSection: React.FC<QaSectionProps> = ({ project, isAr, onSelectString, onClose }) => {
  const [qaDrawerExpanded, setQaDrawerExpanded] = useState(false);
  const [qaDrawerFilter, setQaDrawerFilter] = useState<'all' | 'placeholder' | 'html'>('all');

  const qaSummary = useMemo(() => analyzeProjectQa(project.items), [project.items]);
  const filteredQaIssues = useMemo(() => {
    return qaSummary.allIssues.filter((iss) => {
      if (qaDrawerFilter === 'placeholder') return iss.category === 'placeholder';
      if (qaDrawerFilter === 'html') return iss.category === 'html';
      return true;
    });
  }, [qaSummary.allIssues, qaDrawerFilter]);

  return (
    <div
      id="drawer-qa-checks-section"
      className="flex flex-col shrink-0 rounded-2xl border border-slate-200/90 dark:border-[#2F384B] bg-slate-100/80 dark:bg-[#202634] p-3.5 gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {qaSummary.totalAffectedItemsCount > 0 ? (
            <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-[#1EB996] shrink-0" />
          )}
          <span className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
            {isAr ? 'فحوصات الجودة' : 'QA Checks'}
          </span>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 tabular-nums ${
            qaSummary.totalAffectedItemsCount > 0
              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
              : 'bg-[#1EB996]/15 text-emerald-700 dark:text-[#1EB996]'
          }`}
        >
          {qaSummary.totalAffectedItemsCount > 0
            ? isAr
              ? `${qaSummary.totalAffectedItemsCount} مشاكل`
              : `${qaSummary.totalAffectedItemsCount} issue${qaSummary.totalAffectedItemsCount > 1 ? 's' : ''}`
            : isAr
              ? 'سليم 100%'
              : 'All Clear'}
        </span>
      </div>

      {/* Placeholders vs. HTML Tags Cards */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            if (qaDrawerExpanded && qaDrawerFilter === 'placeholder') {
              setQaDrawerExpanded(false);
              setQaDrawerFilter('all');
            } else {
              setQaDrawerFilter('placeholder');
              setQaDrawerExpanded(true);
            }
          }}
          className={`flex flex-col gap-1 p-2.5 rounded-xl border text-start transition cursor-pointer ${
            qaDrawerFilter === 'placeholder' && qaDrawerExpanded
              ? 'bg-rose-500/15 border-rose-500/50 ring-1 ring-rose-500/30'
              : 'bg-white dark:bg-[#171C27] border-slate-200/80 dark:border-[#2B3346] hover:border-rose-500/40'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
              <Braces className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span className="truncate">
                {isAr ? 'المتغيرات (%s, %d)' : 'Placeholders (%s)'}
              </span>
            </span>
          </div>
          <span
            className={`text-base font-bold tabular-nums ${
              qaSummary.placeholderIssueItemsCount > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {qaSummary.placeholderIssueItemsCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (qaDrawerExpanded && qaDrawerFilter === 'html') {
              setQaDrawerExpanded(false);
              setQaDrawerFilter('all');
            } else {
              setQaDrawerFilter('html');
              setQaDrawerExpanded(true);
            }
          }}
          className={`flex flex-col gap-1 p-2.5 rounded-xl border text-start transition cursor-pointer ${
            qaDrawerFilter === 'html' && qaDrawerExpanded
              ? 'bg-amber-500/15 border-amber-500/50 ring-1 ring-amber-500/30'
              : 'bg-white dark:bg-[#171C27] border-slate-200/80 dark:border-[#2B3346] hover:border-amber-500/40'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
              <Code2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="truncate">
                {isAr ? 'وسوم HTML' : 'HTML Tags'}
              </span>
            </span>
          </div>
          <span
            className={`text-base font-bold tabular-nums ${
              qaSummary.htmlIssueItemsCount > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {qaSummary.htmlIssueItemsCount}
          </span>
        </button>
      </div>

      {/* Expandable QA Issues List */}
      <div className="pt-1 border-t border-slate-200/70 dark:border-[#2B3346]">
        <button
          id="drawer-toggle-qa-list-btn"
          type="button"
          onClick={() => {
            setQaDrawerExpanded((prev) => {
              const next = !prev;
              if (!next) setQaDrawerFilter('all');
              return next;
            });
          }}
          className="w-full flex items-center justify-between gap-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-[#1EB996] dark:hover:text-[#1EB996] transition cursor-pointer"
        >
          <span className="flex items-center gap-1.5 truncate">
            <ShieldAlert className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">
              {isAr
                ? `تفاصيل فحوصات الجودة (${filteredQaIssues.length})`
                : `Detected QA Issues (${filteredQaIssues.length})`}
            </span>
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
              qaDrawerExpanded ? 'rotate-180' : ''
            }`}
          />
        </button>

        {qaDrawerExpanded && (
          <div className="mt-2 space-y-1.5 max-h-52 overflow-y-auto pe-0.5">
            {filteredQaIssues.length === 0 ? (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 text-center py-3">
                {isAr
                  ? 'لا توجد أخطاء في المتغيرات أو وسوم HTML'
                  : 'No placeholder or HTML tag issues detected'}
              </p>
            ) : (
              filteredQaIssues.map((iss) => (
                <button
                  key={iss.id}
                  type="button"
                  onClick={() => {
                    onSelectString?.(iss.itemId);
                    onClose();
                  }}
                  className="w-full flex flex-col gap-1 px-2.5 py-2 rounded-xl bg-white dark:bg-[#171C27] border border-rose-200/80 dark:border-rose-900/40 hover:border-rose-400 text-start transition cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {iss.itemName}
                    </span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold shrink-0 ${
                        iss.category === 'placeholder'
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                          : 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                      }`}
                    >
                      {iss.category === 'placeholder' ? '%s / %d' : 'HTML'}
                    </span>
                  </div>
                  <span className="text-[11px] text-rose-600 dark:text-rose-400 leading-snug">
                    {isAr ? iss.messageAr : iss.messageEn}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
