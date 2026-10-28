import { SourceChangeBadge } from './SourceChangeDiff';
import React from 'react';
import { AlertCircle, CheckCircle2, CheckSquare, Circle, RotateCcw, ShieldAlert, Sparkles, Square } from 'lucide-react';
import { ResourceItem } from '../types';
import { ItemQaResult } from '../utils/placeholderCheck';
import { engineLabel } from '../utils/translator';

export function highlightText(text: string, query: string): React.ReactNode {
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

interface StringListRowProps {
  item: ResourceItem;
  isSelected: boolean;
  isChecked: boolean;
  searchQuery: string;
  isAr: boolean;
  /** Shows the bulk-selection checkbox */
  selectable: boolean;
  qa?: ItemQaResult;
  onSelect: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onResetItemHistory?: (id: string) => void;
}

/**
 * One row of the string list. The whole row is selected through a stretched, real button underneath the content,
 * so the checkbox and reset controls are separate buttons instead of being nested inside another one.
 */
const StringListRowBase: React.FC<StringListRowProps> = ({
  item,
  isSelected,
  isChecked,
  searchQuery,
  isAr,
  selectable: onBulkUpdateTranslations,
  qa,
  onSelect,
  onToggleChecked,
  onResetItemHistory,
}) => {
  // Preview snippets (prefer the sub-item matching the search for plurals and arrays)
  let sourceSnippet = '';
  let targetSnippet = '';
  const trimmedQuery = searchQuery.trim().toLowerCase();
  if (item.type === 'string') {
    sourceSnippet = item.source || '';
    targetSnippet = item.target || '';
  } else {
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
    <div
      data-item-id={item.id}
      className={`relative w-full text-start px-3.5 py-2.5 rounded-2xl transition-all flex flex-col gap-1 m3-state-layer ${
        isSelected
          ? 'bg-[#E8F0FE] dark:bg-[#1E293B] shadow-xs ring-1 ring-[#0B57D0]/30 dark:ring-[#A8C7FA]/30'
          : isChecked
            ? 'bg-emerald-50/70 dark:bg-emerald-950/20 ring-1 ring-[#1EB996]/40'
            : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
      }`}
    >
      <button
        type="button"
        id={`string-item-${item.name}`}
        aria-current={isSelected ? 'true' : undefined}
        aria-label={item.name}
        onClick={() => onSelect(item.id)}
        className="absolute inset-0 rounded-2xl cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0B57D0] dark:focus-visible:outline-[#A8C7FA]"
      />
      <div className="pointer-events-none flex flex-col gap-1">
          {/* Header: Checkbox, Status, Key & Type */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {onBulkUpdateTranslations && (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isChecked}
                  aria-label={isAr ? `تحديد ${item.name} للترجمة الجماعية` : `Select ${item.name} for bulk translation`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleChecked(item.id);
                  }}
                  className="pointer-events-auto relative z-10 p-0.5 -ms-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700/70 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition shrink-0 cursor-pointer"
                  title={isAr ? 'تحديد للترجمة الجماعية' : 'Select for bulk translation'}
                >
                  {isChecked ? (
                    <CheckSquare className="w-3.5 h-3.5 text-[#1EB996]" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              {item.status === 'translated' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : item.status === 'needs_review' ? (
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
              )}
              <span
                className={`font-mono text-xs truncate ${
                  isSelected
                    ? 'font-semibold text-[#0B57D0] dark:text-[#A8C7FA]'
                    : 'font-medium text-slate-800 dark:text-slate-200'
                }`}
              >
                <bdi>{highlightText(item.name, searchQuery)}</bdi>
              </span>
              <SourceChangeBadge item={item} isAr={isAr} />
            </div>

            {/* Right: QA Badge, Source Badge (AI vs Manual), Individual Reset Button & Type indicator */}
            <div className="flex items-center gap-1 shrink-0">
              {(() => {
                const itemQa = qa;
                if (!itemQa) return null;
                const tooltip = itemQa.issues
                  .map((i) => (isAr ? i.messageAr : i.messageEn))
                  .join('\n');
                return (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[9px] font-semibold ring-1 ring-rose-500/30"
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
                        ? `${isAr ? 'مترجم بالذكاء الاصطناعي' : 'Translated with AI'}${
                            item.translationEngine ? ` (${engineLabel(item.translationEngine)})` : ''
                          }`
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
                    <button
                      type="button"
                      aria-label={isAr ? `إعادة تعيين ترجمة ${item.name}` : `Reset translation of ${item.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onResetItemHistory(item.id);
                      }}
                      className="pointer-events-auto relative z-10 p-1 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                      title={
                        isAr
                          ? 'إعادة تعيين سجل وترجمة هذا النص'
                          : 'Reset individual translation history'
                      }
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )}
                </>
              )}

              {/* Clean unboxed type indicator */}
              {item.type !== 'string' && (
                <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 shrink-0">
                  {isAr ? (item.type === 'plural' ? 'جمع' : 'مصفوفة') : item.type}
                </span>
              )}
            </div>
          </div>

          {/* Source English preview */}
          <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1 ps-5.5">
            {sourceSnippet ? (
              <bdi>{highlightText(sourceSnippet, searchQuery)}</bdi>
            ) : (
              <span className="italic text-slate-400">{isAr ? 'نص فارغ' : 'Empty string'}</span>
            )}
          </p>

          {/* Target translation preview */}
          <p className="text-[11px] line-clamp-1 ps-5.5">
            {targetSnippet ? (
              <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                <bdi>{highlightText(targetSnippet, searchQuery)}</bdi>
              </span>
            ) : (
              <span className="text-slate-600 dark:text-slate-400 italic">
                {isAr ? 'غير مترجم' : 'Untranslated'}
              </span>
            )}
          </p>
      </div>
    </div>
  );
};

export const StringListRow = React.memo(StringListRowBase);
