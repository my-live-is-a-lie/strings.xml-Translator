import React, { useRef, useState, useEffect } from 'react';
import {
  Link as LinkIcon,
  Copy,
  Check,
  ChevronDown,
  Sparkles,
  Info,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eraser,
  RotateCcw,
  Sliders,
  ExternalLink,
  Layers,
  Globe,
  Trash2,
  FastForward,
  Undo2,
  Redo2
} from 'lucide-react';
import {
  ResourceItem,
  SingleStringItem,
  PluralStringItem,
  ArrayStringItem,
  TranslationStatus
} from '../types';
import { LanguageSelectorModal } from './LanguageSelectorModal';
import { getArabicLanguageName, getLanguageOption } from '../utils/languages';
import { suggestTranslation } from '../utils/translator';
import { normalizePluralsForLanguage } from '../utils/xmlParser';

const PLURAL_QUANTITY_LABELS_AR: Record<string, string> = {
  zero: 'صفر (0)',
  one: 'مفرد (1)',
  two: 'مثنى (2)',
  few: 'قلة (3–10)',
  many: 'كثرة (11–99)',
  other: 'أخرى (100+)',
};

const PLURAL_QUANTITY_LABELS_EN: Record<string, string> = {
  zero: 'Zero (0)',
  one: 'One (1)',
  two: 'Two (2)',
  few: 'Few (3–10)',
  many: 'Many (11–99)',
  other: 'Other (100+)',
};

interface TranslationEditorProps {
  item: ResourceItem;
  currentIndex: number;
  totalCount: number;
  targetLang?: string;
  targetLocaleName?: string;
  appLang?: 'ar' | 'en';
  onUpdateTranslation: (updatedItem: ResourceItem, options?: { undoDeletesText?: boolean }) => void;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
  onNavigateNextUntranslated: () => void;
  onLanguageChange?: (locale: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  undoCount?: number;
  redoCount?: number;
  autoTranslate?: boolean;
  onResetItemHistory?: (id: string) => void;
}

export const TranslationEditor: React.FC<TranslationEditorProps> = ({
  item,
  currentIndex,
  totalCount,
  targetLang = 'ar',
  targetLocaleName = 'العربية',
  appLang = 'ar',
  onUpdateTranslation,
  onNavigatePrevious,
  onNavigateNext,
  onNavigateNextUntranslated,
  onLanguageChange,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  undoCount = 0,
  redoCount = 0,
  autoTranslate = false,
  onResetItemHistory,
}) => {
  const isAr = appLang === 'ar';
  const pluralLabels = isAr ? PLURAL_QUANTITY_LABELS_AR : PLURAL_QUANTITY_LABELS_EN;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pluralTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const arrayTextareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});

  // Track last active input box & cursor (line indicator) position so tapping a syntax token inserts right at the caret
  const lastCursorRef = useRef<{
    fieldType: 'string' | 'plural' | 'array';
    quantity?: string;
    index?: number;
    start: number;
    end: number;
  } | null>(null);

  // Target Language selector modal state
  const [showLangModal, setShowLangModal] = useState(false);

  // Text Direction State (default to RTL for Arabic, Urdu, Hebrew, Persian)
  const isTargetRtl = ['ar', 'fa', 'ur', 'he'].includes(targetLang.toLowerCase());
  const [direction, setDirection] = useState<'ltr' | 'rtl'>(isTargetRtl ? 'rtl' : 'ltr');

  // UI feedback states
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSource, setCopiedSource] = useState(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);

  // Suggestion loading state
  const [isSuggesting, setIsSuggesting] = useState(false);

  // Reset direction when target language changes
  useEffect(() => {
    setDirection(isTargetRtl ? 'rtl' : 'ltr');
  }, [isTargetRtl, targetLang]);

  // Reset tools menu state and cursor ref when item changes
  useEffect(() => {
    setShowToolsMenu(false);
    lastCursorRef.current = null;
  }, [item.id]);

  // Extract source text
  const getSourceText = (): string => {
    if (item.type === 'string') return item.source;
    if (item.type === 'plural') return item.items[0]?.source || '';
    if (item.type === 'array') return item.items[0]?.source || '';
    return '';
  };

  // Extract current target text
  const getTargetText = (): string => {
    if (item.type === 'string') return item.target;
    if (item.type === 'plural') return item.items[0]?.target || '';
    if (item.type === 'array') return item.items[0]?.target || '';
    return '';
  };

  const sourceText = getSourceText();
  const currentTargetText = getTargetText();

  // Auto-adjust textarea height to match exact size of typed text
  const adjustTextareaHeight = (targetEl?: HTMLTextAreaElement | null) => {
    const el = targetEl || textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Include border-box offset so content never clips
    const borderOffset = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + borderOffset}px`;
  };

  useEffect(() => {
    adjustTextareaHeight();
    const handleResize = () => adjustTextareaHeight();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [item.id, currentTargetText, item.type, direction]);

  // Handle single string text change
  const handleSingleTextChange = (val: string) => {
    if (item.type !== 'string') return;
    const isNowEmpty = !val.trim();
    const updated: SingleStringItem = {
      ...item,
      target: val,
      status: isNowEmpty ? 'untranslated' : item.status === 'untranslated' ? 'translated' : item.status,
      translationSource: isNowEmpty ? undefined : 'manual',
    };
    onUpdateTranslation(updated);
  };

  // Ensure plural items always include all CLDR quantities for targetLang (e.g. zero, one, two, few, many, other for Arabic)
  const normalizedPluralItems =
    item.type === 'plural'
      ? (normalizePluralsForLanguage([item], targetLang)[0] as PluralStringItem).items
      : [];

  // Plural change
  const handlePluralQuantityChange = (quantity: string, val: string) => {
    if (item.type !== 'plural') return;
    const baseItems = normalizedPluralItems;
    const newItems = baseItems.map((pi) => (pi.quantity === quantity ? { ...pi, target: val } : pi));
    const anyFilled = newItems.some((pi) => pi.target.trim().length > 0);
    const updated: PluralStringItem = {
      ...item,
      items: newItems,
      status: anyFilled ? (item.status === 'untranslated' ? 'translated' : item.status) : 'untranslated',
      translationSource: anyFilled ? 'manual' : undefined,
    };
    onUpdateTranslation(updated);
  };

  // Array item change
  const handleArrayItemChange = (index: number, val: string) => {
    if (item.type !== 'array') return;
    const newItems = item.items.map((ai) => (ai.index === index ? { ...ai, target: val } : ai));
    const anyFilled = newItems.some((ai) => ai.target.trim().length > 0);
    const updated: ArrayStringItem = {
      ...item,
      items: newItems,
      status: anyFilled ? (item.status === 'untranslated' ? 'translated' : item.status) : 'untranslated',
      translationSource: anyFilled ? 'manual' : undefined,
    };
    onUpdateTranslation(updated);
  };

  // Clone source directly to target (Weblate clone action)
  const handleCloneSourceToTarget = () => {
    if (item.type === 'string') {
      const updated: SingleStringItem = {
        ...item,
        target: item.source,
        status: item.source ? 'translated' : item.status,
        translationSource: item.source ? 'manual' : undefined,
      };
      onUpdateTranslation(updated);
    } else if (item.type === 'plural') {
      const updated: PluralStringItem = {
        ...item,
        items: item.items.map((pi) => ({ ...pi, target: pi.source })),
        status: 'translated',
        translationSource: 'manual',
      };
      onUpdateTranslation(updated);
    } else if (item.type === 'array') {
      const updated: ArrayStringItem = {
        ...item,
        items: item.items.map((ai) => ({ ...ai, target: ai.source })),
        status: 'translated',
        translationSource: 'manual',
      };
      onUpdateTranslation(updated);
    }
  };

  // Record cursor (line indicator) position whenever user interacts with a textarea
  const recordCursorPosition = (
    el: HTMLTextAreaElement | null,
    fieldType: 'string' | 'plural' | 'array',
    extra?: { quantity?: string; index?: number }
  ) => {
    if (!el) return;
    lastCursorRef.current = {
      fieldType,
      quantity: extra?.quantity,
      index: extra?.index,
      start: typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length,
      end: typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length,
    };
  };

  // Insert character, symbol, or Android syntax token at cursor (line indicator) position in the active textarea
  const insertAtCursor = (
    charToInsert: string,
    targetField?: { fieldType: 'plural'; quantity: string } | { fieldType: 'array'; index: number }
  ) => {
    if (item.type === 'string') {
      const el = textareaRef.current;
      const text = item.target;
      const isFocused = el && document.activeElement === el;
      const saved =
        lastCursorRef.current?.fieldType === 'string' ? lastCursorRef.current : null;

      const start = isFocused
        ? el.selectionStart
        : saved
          ? Math.min(saved.start, text.length)
          : text.length;
      const end = isFocused
        ? el.selectionEnd
        : saved
          ? Math.min(saved.end, text.length)
          : text.length;

      let newText = '';
      let newCursor = start + charToInsert.length;

      if (charToInsert === '( - )') {
        if (start !== end) {
          const selected = text.substring(start, end);
          newText = text.substring(0, start) + `(${selected})` + text.substring(end);
          newCursor = start + selected.length + 2;
        } else {
          newText = text.substring(0, start) + '( - )' + text.substring(end);
          newCursor = start + 5;
        }
      } else {
        newText = text.substring(0, start) + charToInsert + text.substring(end);
      }

      lastCursorRef.current = {
        fieldType: 'string',
        start: newCursor,
        end: newCursor,
      };

      handleSingleTextChange(newText);
      setTimeout(() => {
        if (el) {
          adjustTextareaHeight(el);
          el.focus();
          el.setSelectionRange(newCursor, newCursor);
        }
      }, 0);
      return;
    }

    if (item.type === 'plural') {
      const saved =
        lastCursorRef.current?.fieldType === 'plural' ? lastCursorRef.current : null;
      const targetQty =
        (targetField?.fieldType === 'plural' ? targetField.quantity : undefined) ||
        saved?.quantity ||
        normalizedPluralItems[0]?.quantity;
      if (!targetQty) return;

      const pluralEntry = normalizedPluralItems.find((pi) => pi.quantity === targetQty);
      if (!pluralEntry) return;

      const el = pluralTextareaRefs.current[targetQty];
      const text = pluralEntry.target;
      const isFocused = el && document.activeElement === el;
      const useSaved = saved && saved.quantity === targetQty;

      const start = isFocused
        ? el.selectionStart
        : useSaved
          ? Math.min(saved.start, text.length)
          : text.length;
      const end = isFocused
        ? el.selectionEnd
        : useSaved
          ? Math.min(saved.end, text.length)
          : text.length;

      const newText = text.substring(0, start) + charToInsert + text.substring(end);
      const newCursor = start + charToInsert.length;

      lastCursorRef.current = {
        fieldType: 'plural',
        quantity: targetQty,
        start: newCursor,
        end: newCursor,
      };

      handlePluralQuantityChange(targetQty, newText);
      setTimeout(() => {
        if (el) {
          adjustTextareaHeight(el);
          el.focus();
          el.setSelectionRange(newCursor, newCursor);
        }
      }, 0);
      return;
    }

    if (item.type === 'array') {
      const saved =
        lastCursorRef.current?.fieldType === 'array' ? lastCursorRef.current : null;
      const targetIdx =
        (targetField?.fieldType === 'array' ? targetField.index : undefined) ??
        saved?.index ??
        item.items[0]?.index ??
        0;

      const arrayEntry = item.items.find((ai) => ai.index === targetIdx);
      if (!arrayEntry) return;

      const el = arrayTextareaRefs.current[targetIdx];
      const text = arrayEntry.target;
      const isFocused = el && document.activeElement === el;
      const useSaved = saved && saved.index === targetIdx;

      const start = isFocused
        ? el.selectionStart
        : useSaved
          ? Math.min(saved.start, text.length)
          : text.length;
      const end = isFocused
        ? el.selectionEnd
        : useSaved
          ? Math.min(saved.end, text.length)
          : text.length;

      const newText = text.substring(0, start) + charToInsert + text.substring(end);
      const newCursor = start + charToInsert.length;

      lastCursorRef.current = {
        fieldType: 'array',
        index: targetIdx,
        start: newCursor,
        end: newCursor,
      };

      handleArrayItemChange(targetIdx, newText);
      setTimeout(() => {
        if (el) {
          adjustTextareaHeight(el);
          el.focus();
          el.setSelectionRange(newCursor, newCursor);
        }
      }, 0);
    }
  };

  // Render source text with Weblate-style shaded & dotted-border Android syntax tokens (%1$d, %s, etc.)
  const renderSourceWithSyntaxHighlights = (
    text: string,
    targetField?: { fieldType: 'plural'; quantity: string } | { fieldType: 'array'; index: number }
  ) => {
    if (!text) {
      return <span className="italic text-slate-500">Empty string</span>;
    }

    const tokenRegex = /(%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]|\\\\[nt]|\\[nt]|\{[a-zA-Z0-9_-]+\}|<\/?[a-zA-Z][^>]*>)/gi;
    const parts = text.split(tokenRegex);

    return parts.map((part, idx) => {
      if (!part) return null;
      if (tokenRegex.test(part)) {
        tokenRegex.lastIndex = 0;
        return (
          <span
            key={idx}
            role="button"
            tabIndex={0}
            dir="ltr"
            title="انقر لإدراج هذا الرمز في موضع المؤشر / Tap to insert at cursor"
            onMouseDown={(e) => {
              // Prevent blurring the active textarea so the line indicator stays in place
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              insertAtCursor(part, targetField);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                insertAtCursor(part, targetField);
              }
            }}
            className="inline-block font-sans px-[1px] py-0.5 bg-[#2B2E35] hover:bg-[#363B46] active:bg-[#404654] rounded-[2px] text-slate-100 cursor-pointer select-none transition-colors leading-tight"
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  // Copy link / XML key
  const handleCopyLink = () => {
    const xmlSnippet = `<string name="${item.name}">${currentTargetText || sourceText}</string>`;
    navigator.clipboard.writeText(xmlSnippet);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Copy English source
  const handleCopySource = () => {
    navigator.clipboard.writeText(sourceText);
    setCopiedSource(true);
    setTimeout(() => setCopiedSource(false), 2000);
  };

  // Toggle "Needs editing / Needs review" (تحتاج إلى تعديل)
  const handleToggleNeedsReview = () => {
    const newStatus: TranslationStatus = item.status === 'needs_review' ? 'translated' : 'needs_review';
    onUpdateTranslation({
      ...item,
      status: newStatus,
    });
  };

  // Save without continuing (حفظ بدون متابعة)
  const handleSaveWithoutContinuing = () => {
    if (item.type === 'string' && item.target.trim() && item.status === 'untranslated') {
      onUpdateTranslation({
        ...item,
        status: 'translated',
      });
    }
    setShowSavedFeedback(true);
    setTimeout(() => setShowSavedFeedback(false), 2000);
  };

  // Save and continue (حفظ ومتابعة)
  const handleSaveAndContinue = () => {
    if (item.type === 'string' && item.target.trim() && item.status === 'untranslated') {
      onUpdateTranslation({
        ...item,
        status: 'translated',
      });
    }
    onNavigateNext();
  };

  // Suggest translation (اقترح) — immediately fills the input box and allows Undo button to delete suggested text
  const handleSuggest = async () => {
    setIsSuggesting(true);

    try {
      if (item.type === 'string') {
        const res = await suggestTranslation(item.source, targetLang, targetLocaleName);
        if (res && res.text) {
          const isNowEmpty = !res.text.trim();
          const updated: SingleStringItem = {
            ...item,
            target: res.text,
            status: isNowEmpty ? 'untranslated' : 'translated',
            translationSource: isNowEmpty ? undefined : 'ai',
          };
          onUpdateTranslation(updated, { undoDeletesText: true });
        }
      } else if (item.type === 'plural') {
        const updated = await Promise.all(
          normalizedPluralItems.map(async (pi) => {
            const res = await suggestTranslation(pi.source, targetLang, targetLocaleName, pi.quantity);
            return {
              ...pi,
              target: res?.text || pi.target,
            };
          })
        );
        onUpdateTranslation(
          {
            ...item,
            items: updated,
            status: 'translated',
            translationSource: 'ai',
          },
          { undoDeletesText: true }
        );
      } else if (item.type === 'array') {
        const updated = await Promise.all(
          item.items.map(async (ai) => {
            const res = await suggestTranslation(ai.source, targetLang, targetLocaleName);
            return {
              ...ai,
              target: res?.text || ai.target,
            };
          })
        );
        onUpdateTranslation(
          {
            ...item,
            items: updated,
            status: 'translated',
            translationSource: 'ai',
          },
          { undoDeletesText: true }
        );
      }
    } catch (err) {
      console.error('Translation error:', err);
    } finally {
      setIsSuggesting(false);
    }
  };

  // Auto-translate untranslated strings automatically when Auto Translate toggle is active
  const autoTranslatedItemKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoTranslate) {
      autoTranslatedItemKeyRef.current = null;
      return;
    }

    if (item.status !== 'untranslated' || item.translatable === false) {
      return;
    }

    const itemKey = `${targetLang}:${item.id}`;
    if (autoTranslatedItemKeyRef.current === itemKey) {
      return;
    }

    let cancelled = false;
    let completed = false;
    autoTranslatedItemKeyRef.current = itemKey;

    const runAutoTranslate = async () => {
      setIsSuggesting(true);
      try {
        if (item.type === 'string') {
          const res = await suggestTranslation(item.source, targetLang, targetLocaleName);
          if (cancelled) return;
          if (res && res.text && res.text.trim()) {
            const updated: SingleStringItem = {
              ...item,
              target: res.text,
              status: 'translated',
              translationSource: 'ai',
            };
            completed = true;
            onUpdateTranslation(updated, { undoDeletesText: true });
          }
        } else if (item.type === 'plural') {
          const updated = await Promise.all(
            normalizedPluralItems.map(async (pi) => {
              const res = await suggestTranslation(
                pi.source,
                targetLang,
                targetLocaleName,
                pi.quantity
              );
              return {
                ...pi,
                target: res?.text || pi.target,
              };
            })
          );
          if (cancelled) return;
          if (updated.some((pi) => pi.target.trim().length > 0)) {
            completed = true;
            onUpdateTranslation(
              {
                ...item,
                items: updated,
                status: 'translated',
                translationSource: 'ai',
              },
              { undoDeletesText: true }
            );
          }
        } else if (item.type === 'array') {
          const updated = await Promise.all(
            item.items.map(async (ai) => {
              const res = await suggestTranslation(ai.source, targetLang, targetLocaleName);
              return {
                ...ai,
                target: res?.text || ai.target,
              };
            })
          );
          if (cancelled) return;
          if (updated.some((ai) => ai.target.trim().length > 0)) {
            completed = true;
            onUpdateTranslation(
              {
                ...item,
                items: updated,
                status: 'translated',
                translationSource: 'ai',
              },
              { undoDeletesText: true }
            );
          }
        }
      } catch (err) {
        console.error('Auto-translation error:', err);
      } finally {
        if (!cancelled) {
          setIsSuggesting(false);
        }
      }
    };

    runAutoTranslate();

    return () => {
      cancelled = true;
      if (!completed && autoTranslatedItemKeyRef.current === itemKey) {
        autoTranslatedItemKeyRef.current = null;
      }
    };
  }, [autoTranslate, item.id, item.status, targetLang, targetLocaleName, normalizedPluralItems, onUpdateTranslation]);

  // Tools Actions
  const handleClearText = () => {
    if (item.type === 'string') {
      handleSingleTextChange('');
    } else if (item.type === 'plural') {
      onUpdateTranslation({
        ...item,
        items: normalizedPluralItems.map((pi) => ({ ...pi, target: '' })),
        status: 'untranslated',
        translationSource: undefined,
      });
    } else if (item.type === 'array') {
      onUpdateTranslation({
        ...item,
        items: item.items.map((ai) => ({ ...ai, target: '' })),
        status: 'untranslated',
        translationSource: undefined,
      });
    }
    setShowToolsMenu(false);
  };

  const handleWrapCData = () => {
    if (item.type === 'string') {
      handleSingleTextChange(`<![CDATA[${item.target || item.source}]]>`);
    }
    setShowToolsMenu(false);
  };

  // Max recommended character threshold
  const maxThreshold = 100;

  return (
    <div className="flex flex-col h-full bg-[#0E1015] text-slate-100 overflow-y-auto p-2 sm:p-3">
      <div className="max-w-2xl w-full mx-auto flex flex-col gap-2">
        {/* Weblate / M3 Main Card Frame */}
        <div className="bg-[#151922] rounded-2xl border border-[#232936] shadow-lg overflow-hidden">
          <div className="p-3 sm:p-3.5 space-y-2.5">
            {/* Top row: Key name + "مفاتيح" on Left, "الإنجليزية" on Right */}
            <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-xs sm:text-sm font-semibold text-slate-100 truncate select-all">
                  {item.name}
                </span>
                <span className="text-slate-400 text-[11px] sm:text-xs font-medium">
                  {isAr ? 'مفاتيح' : 'Keys'}
                </span>
              </div>

              <span className="text-slate-300 text-xs sm:text-sm font-medium shrink-0">
                {isAr ? 'الإنجليزية' : 'English'}
              </span>
            </div>

            {/* Source Display Box with Clone & Copy Icons */}
            <div className="flex items-center gap-1">
              {/* Clone icon button (Weblate clone to target — matches screenshot) */}
              <button
                id="weblate-clone-to-target-btn"
                onClick={handleCloneSourceToTarget}
                className="pl-1.5 pr-1 py-1 rounded-md text-slate-300 hover:text-white hover:bg-[#1C2330] transition cursor-pointer shrink-0"
                title={isAr ? 'نسخ المصدر إلى حقل الترجمة' : 'Clone source to translation'}
              >
                {/* Exact Weblate clone-to-translation icon: back sheet + right arrow into front sheet */}
                <svg
                  className="w-4 h-4"
                  viewBox="3 2 19 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {/* Front target sheet (with opening on left for arrow) */}
                  <path d="M10 11V8.5A1.5 1.5 0 0 1 11.5 7h7A1.5 1.5 0 0 1 20 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 10 18.5V17" />
                  {/* Back source sheet top & left turning into right arrow */}
                  <path d="M15 4H6.5A1.5 1.5 0 0 0 5 5.5v7A1.5 1.5 0 0 0 6.5 14H15" />
                  {/* Arrowhead pointing right inside front sheet */}
                  <path d="m12.5 11.5 2.5 2.5-2.5 2.5" />
                </svg>
              </button>

              {/* Source content container */}
              <div className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-[#141822] border border-[#283140] flex items-center justify-between gap-2.5">
                {/* Left: Copy button */}
                <button
                  id="copy-source-text-btn"
                  onClick={handleCopySource}
                  className="p-1 rounded-md text-slate-300 hover:text-white hover:bg-[#202736] transition cursor-pointer shrink-0"
                  title={isAr ? 'نسخ النص الإنجليزي' : 'Copy English source text'}
                >
                  {copiedSource ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>

                {/* English source text with interactive Android syntax highlights */}
                <span className="flex-1 text-xs sm:text-sm font-normal text-slate-100 select-text break-words leading-relaxed">
                  {renderSourceWithSyntaxHighlights(sourceText)}
                </span>
              </div>
            </div>

            {/* Target Language Name on Right + Translation Source & Reset on Left */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {item.status !== 'untranslated' && (
                  <>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                        item.translationSource === 'ai'
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/25'
                          : 'bg-[#1EB996]/10 text-[#1EB996] border-[#1EB996]/25'
                      }`}
                    >
                      {item.translationSource === 'ai' ? (
                        <>
                          <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                          <span>{isAr ? 'مترجم بالذكاء الاصطناعي' : 'AI Translated'}</span>
                        </>
                      ) : (
                        <span>{isAr ? 'إدخال يدوي' : 'Manual Input'}</span>
                      )}
                    </span>
                    {onResetItemHistory && (
                      <button
                        type="button"
                        onClick={() => onResetItemHistory(item.id)}
                        title={
                          isAr
                            ? 'إعادة تعيين سجل وترجمة هذا النص'
                            : 'Reset translation & history for this string'
                        }
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#1C2330] hover:bg-rose-950/50 text-slate-300 hover:text-rose-300 border border-[#2B3545] hover:border-rose-800/60 transition cursor-pointer"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>{isAr ? 'إعادة تعيين' : 'Reset'}</span>
                      </button>
                    )}
                  </>
                )}
              </div>

              <span className="text-slate-300 text-xs sm:text-sm font-medium shrink-0">
                {isAr
                  ? getArabicLanguageName(targetLang, targetLocaleName)
                  : getLanguageOption(targetLang).name || targetLocaleName}
              </span>
            </div>

            {/* Two Connected Typographic / Formatting Toolbars */}
            <div className="space-y-1 select-none">
              {/* Toolbar Row 1: Punctuation & Typography */}
              <div className="flex items-center bg-[#171D27] border border-[#283242] rounded-lg overflow-x-auto divide-x divide-[#283242] rtl:divide-x-reverse no-scrollbar">
                {[
                  { label: '-', value: '-', title: 'Hyphen (-)' },
                  { label: '_', value: '_', title: 'Underscore (_)' },
                  { label: '( - )', value: '( - )', title: 'Parentheses ( - )' },
                  { label: "'", value: "'", title: "Single quote (')" },
                  { label: '‘', value: '‘', title: 'Arabic quote / comma (‘)' },
                  { label: '"', value: '"', title: 'Double quote (")' },
                  { label: '“', value: '“', title: 'Curly quote (“)' },
                  { label: '...', value: '…', title: 'Horizontal Ellipsis (…)' },
                  { label: 'NBS', value: '\u00A0', title: 'Non-Breaking Space (U+00A0)' },
                  { label: '↵', value: '\\n', title: 'Newline (\\n)' },
                  { label: '⇄', value: '\\t', title: 'Tabulation (\\t)' },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertAtCursor(btn.value)}
                    title={btn.title}
                    className="flex-1 min-w-[30px] sm:min-w-[38px] h-7 sm:h-7.5 flex items-center justify-center text-xs font-mono font-medium text-slate-300 hover:text-white hover:bg-[#232C3A] active:bg-[#2C3748] transition cursor-pointer"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>

              {/* Toolbar Row 2: BiDi Unicode Directional Controls */}
              <div className="flex items-center bg-[#171D27] border border-[#283242] rounded-lg overflow-x-auto divide-x divide-[#283242] rtl:divide-x-reverse no-scrollbar">
                {[
                  { label: 'PDF', value: '\u202C', title: 'Pop Directional Formatting (U+202C)' },
                  { label: 'RLE', value: '\u202B', title: 'Right-to-Left Embedding (U+202B)' },
                  { label: 'LRE', value: '\u202A', title: 'Left-to-Right Embedding (U+202A)' },
                  { label: 'RLM', value: '\u200F', title: 'Right-to-Left Mark (U+200F)' },
                  { label: 'LRM', value: '\u200E', title: 'Left-to-Right Mark (U+200E)' },
                  { label: 'ZWJ', value: '\u200D', title: 'Zero-Width Joiner (U+200D)' },
                  { label: 'ZWNJ', value: '\u200C', title: 'Zero-Width Non-Joiner (U+200C)' },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertAtCursor(btn.value)}
                    title={btn.title}
                    className="flex-1 min-w-[40px] sm:min-w-[48px] h-7 sm:h-7.5 flex items-center justify-center text-[10px] sm:text-[11px] font-mono font-semibold text-slate-300 hover:text-white hover:bg-[#232C3A] active:bg-[#2C3748] transition cursor-pointer tracking-wider"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Translation Textarea (Single String) */}
            {item.type === 'string' && (
              <div className="relative">
                <textarea
                  id="weblate-translation-input"
                  ref={textareaRef}
                  dir={direction}
                  value={item.target}
                  onFocus={(e) => recordCursorPosition(e.currentTarget, 'string')}
                  onClick={(e) => recordCursorPosition(e.currentTarget, 'string')}
                  onKeyUp={(e) => recordCursorPosition(e.currentTarget, 'string')}
                  onSelect={(e) => recordCursorPosition(e.currentTarget, 'string')}
                  onChange={(e) => {
                    recordCursorPosition(e.currentTarget, 'string');
                    adjustTextareaHeight(e.currentTarget);
                    handleSingleTextChange(e.target.value);
                  }}
                  placeholder={isAr ? 'اكتب الترجمة هنا...' : 'Type translation here...'}
                  rows={1}
                  className="w-full px-3.5 pt-2 pb-3.5 sm:pt-2.5 sm:pb-4 rounded-xl bg-[#0E121A] border-2 border-[#16695E] focus:border-[#1EB996] focus:ring-2 focus:ring-[#1EB996]/20 text-slate-100 placeholder-slate-500 text-xs sm:text-sm leading-relaxed focus:outline-none transition-colors resize-none overflow-hidden block"
                />
              </div>
            )}

            {/* Plural Support (if plural string) */}
            {item.type === 'plural' && (
              <div className="space-y-2">
                {normalizedPluralItems.map((pi) => (
                  <div key={pi.quantity} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-[#1EB996] uppercase px-1.5 py-0.5 rounded bg-[#1EB996]/10 border border-[#1EB996]/30">
                          {pi.quantity}
                        </span>
                        {pluralLabels[pi.quantity] && (
                          <span className="text-[11px] text-slate-300 font-medium">
                            {pluralLabels[pi.quantity]}
                          </span>
                        )}
                      </div>
                      <span className="text-slate-300 text-[11px] truncate max-w-xs">
                        {renderSourceWithSyntaxHighlights(pi.source, {
                          fieldType: 'plural',
                          quantity: pi.quantity,
                        })}
                      </span>
                    </div>
                    <textarea
                      rows={1}
                      dir={direction}
                      value={pi.target}
                      ref={(el) => {
                        pluralTextareaRefs.current[pi.quantity] = el;
                        if (el) {
                          el.style.height = 'auto';
                          const borderOffset = el.offsetHeight - el.clientHeight;
                          el.style.height = `${el.scrollHeight + borderOffset}px`;
                        }
                      }}
                      onFocus={(e) =>
                        recordCursorPosition(e.currentTarget, 'plural', { quantity: pi.quantity })
                      }
                      onClick={(e) =>
                        recordCursorPosition(e.currentTarget, 'plural', { quantity: pi.quantity })
                      }
                      onKeyUp={(e) =>
                        recordCursorPosition(e.currentTarget, 'plural', { quantity: pi.quantity })
                      }
                      onSelect={(e) =>
                        recordCursorPosition(e.currentTarget, 'plural', { quantity: pi.quantity })
                      }
                      onChange={(e) => {
                        recordCursorPosition(e.currentTarget, 'plural', { quantity: pi.quantity });
                        adjustTextareaHeight(e.currentTarget);
                        handlePluralQuantityChange(pi.quantity, e.target.value);
                      }}
                      placeholder={
                        isAr
                          ? `ترجمة صيغة ${pi.quantity} (${pluralLabels[pi.quantity] || pi.quantity})...`
                          : `Translate ${pi.quantity} form (${pluralLabels[pi.quantity] || pi.quantity})...`
                      }
                      className="w-full px-3.5 pt-1.5 pb-3 text-xs sm:text-sm leading-relaxed rounded-lg bg-[#0E121A] border border-[#283242] focus:border-[#1EB996] text-slate-100 focus:outline-none transition resize-none overflow-hidden block"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Array Support (if array string) */}
            {item.type === 'array' && (
              <div className="space-y-2">
                {item.items.map((ai) => (
                  <div key={ai.index} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-[#1EB996]">
                        {isAr ? `العنصر [${ai.index}]` : `Item [${ai.index}]`}
                      </span>
                      <span className="text-slate-300 text-[11px] truncate max-w-xs">
                        {renderSourceWithSyntaxHighlights(ai.source, {
                          fieldType: 'array',
                          index: ai.index,
                        })}
                      </span>
                    </div>
                    <textarea
                      rows={1}
                      dir={direction}
                      value={ai.target}
                      ref={(el) => {
                        arrayTextareaRefs.current[ai.index] = el;
                        if (el) {
                          el.style.height = 'auto';
                          const borderOffset = el.offsetHeight - el.clientHeight;
                          el.style.height = `${el.scrollHeight + borderOffset}px`;
                        }
                      }}
                      onFocus={(e) =>
                        recordCursorPosition(e.currentTarget, 'array', { index: ai.index })
                      }
                      onClick={(e) =>
                        recordCursorPosition(e.currentTarget, 'array', { index: ai.index })
                      }
                      onKeyUp={(e) =>
                        recordCursorPosition(e.currentTarget, 'array', { index: ai.index })
                      }
                      onSelect={(e) =>
                        recordCursorPosition(e.currentTarget, 'array', { index: ai.index })
                      }
                      onChange={(e) => {
                        recordCursorPosition(e.currentTarget, 'array', { index: ai.index });
                        adjustTextareaHeight(e.currentTarget);
                        handleArrayItemChange(ai.index, e.target.value);
                      }}
                      placeholder={
                        isAr ? `ترجمة العنصر ${ai.index}...` : `Translate item ${ai.index}...`
                      }
                      className="w-full px-3.5 pt-1.5 pb-3 text-xs sm:text-sm leading-relaxed rounded-lg bg-[#0E121A] border border-[#283242] focus:border-[#1EB996] text-slate-100 focus:outline-none transition resize-none overflow-hidden block"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Below-Textarea Status Bar */}
            <div className="flex items-center justify-between gap-2 pt-0.5 text-xs flex-wrap">
              {/* Left: LTR / RTL Pill Switcher & Character Counter */}
              <div className="flex items-center gap-1.5">
                <div className="flex items-center bg-[#171D27] border border-[#2B3544] rounded-lg p-0.5 select-none">
                  {/* LTR Button */}
                  <button
                    type="button"
                    onClick={() => setDirection('ltr')}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition ${
                      direction === 'ltr'
                        ? 'bg-[#1C2534] text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>LTR</span>
                    <span
                      className={`w-3 h-3 rounded-full border flex items-center justify-center ${
                        direction === 'ltr'
                          ? 'border-[#1EB996] bg-[#1EB996]/20'
                          : 'border-slate-500'
                      }`}
                    >
                      {direction === 'ltr' && <span className="w-1 h-1 rounded-full bg-[#1EB996]" />}
                    </span>
                  </button>

                  {/* RTL Button */}
                  <button
                    type="button"
                    onClick={() => setDirection('rtl')}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition ${
                      direction === 'rtl'
                        ? 'bg-[#1C2534] text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>RTL</span>
                    <span
                      className={`w-3 h-3 rounded-full border flex items-center justify-center ${
                        direction === 'rtl'
                          ? 'border-[#1EB996] bg-[#1EB996]/20'
                          : 'border-slate-500'
                      }`}
                    >
                      {direction === 'rtl' && <span className="w-1 h-1 rounded-full bg-[#1EB996]" />}
                    </span>
                  </button>
                </div>

                {/* Character Counter: e.g. "8 · 8/100" */}
                <div className="px-2 py-0.5 rounded-lg bg-[#171D27] border border-[#2B3544] font-mono text-[11px] text-slate-300 tabular-nums">
                  <span>{sourceText.length}</span>
                  <span className="mx-1 text-slate-500">·</span>
                  <span>
                    {currentTargetText.length}/{maxThreshold}
                  </span>
                </div>
              </div>

              {/* Far Right: Bigger Undo / Redo Buttons */}
              {onUndo && onRedo && (
                <div className="inline-flex items-center bg-[#171D27] border border-[#2B3544] rounded-xl p-1 select-none gap-0.5 ml-auto">
                  <button
                    id="editor-undo-btn"
                    type="button"
                    onClick={onUndo}
                    disabled={!canUndo}
                    className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-200 hover:text-white hover:bg-[#202A3A] disabled:opacity-35 disabled:pointer-events-none transition cursor-pointer"
                    title={
                      isAr
                        ? `تراجع عن التعديل (Ctrl+Z)${undoCount > 0 ? ` — ${undoCount}` : ''}`
                        : `Undo edit (Ctrl+Z)${undoCount > 0 ? ` — ${undoCount}` : ''}`
                    }
                    aria-label="Undo"
                  >
                    <Undo2 className="w-4 h-4 text-[#1EB996]" />
                  </button>
                  <div className="w-px h-4 bg-[#2B3544]" />
                  <button
                    id="editor-redo-btn"
                    type="button"
                    onClick={onRedo}
                    disabled={!canRedo}
                    className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-200 hover:text-white hover:bg-[#202A3A] disabled:opacity-35 disabled:pointer-events-none transition cursor-pointer"
                    title={
                      isAr
                        ? `إعادة التعديل (Ctrl+Y)${redoCount > 0 ? ` — ${redoCount}` : ''}`
                        : `Redo edit (Ctrl+Y)${redoCount > 0 ? ` — ${redoCount}` : ''}`
                    }
                    aria-label="Redo"
                  >
                    <Redo2 className="w-4 h-4 text-[#1EB996]" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons Section */}
          <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-[#131720] border-t border-[#232936] space-y-2">
            {/* Row 1: Quick delete & Skip button on left, "حفظ ومتابعة" on right */}
            <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
              {/* Left: Quick Delete Icon Button on far left + Skip Button */}
              <div className="flex items-center gap-1.5 min-w-0">
                {/* Quick Delete / Clear Icon Button */}
                <button
                  id="weblate-quick-delete-btn"
                  type="button"
                  onClick={handleClearText}
                  title={isAr ? 'مسح حقل الترجمة' : 'Clear translation field'}
                  className="w-9.5 sm:w-10 h-9.5 sm:h-10 rounded-full bg-[#1C2330] hover:bg-rose-950/40 active:bg-rose-900/60 border border-[#2B3545] hover:border-rose-800/60 text-slate-300 hover:text-rose-400 flex items-center justify-center shrink-0 transition cursor-pointer shadow-xs group"
                >
                  <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>

                {/* Skip Button (in place of Tools button, without icon) */}
                <button
                  id="weblate-skip-btn"
                  type="button"
                  onClick={onNavigateNext}
                  title={isAr ? 'تخطّي إلى السلسلة التالية' : 'Skip to next string'}
                  className="flex-1 min-w-0 h-9.5 sm:h-10 rounded-full bg-[#185F54] hover:bg-[#1C6F63] active:bg-[#144F46] text-white font-medium text-xs sm:text-sm flex items-center justify-center transition cursor-pointer shadow-xs"
                >
                  <span>{isAr ? 'تخطّي' : 'Skip'}</span>
                </button>
              </div>

              {/* Right: "حفظ ومتابعة" (Primary Bright Teal Pill) */}
              <button
                id="weblate-save-continue-btn"
                type="button"
                onClick={handleSaveAndContinue}
                className="w-full h-9.5 sm:h-10 rounded-full bg-[#1EB996] hover:bg-[#19A585] active:bg-[#158C71] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
              >
                <span>{isAr ? 'حفظ ومتابعة' : 'Save & Continue'}</span>
              </button>
            </div>

            {/* Row 2: Language Globe button + "اقترح" on left, "حفظ بدون متابعة" on right */}
            <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
              {/* Left: Language Change Globe Icon Button on far left + "اقترح" (Suggest Button) */}
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  id="editor-switch-lang-btn"
                  type="button"
                  onClick={() => setShowLangModal(true)}
                  title={
                    isAr
                      ? `تغيير لغة الترجمة المستهدفة (${getArabicLanguageName(targetLang, targetLocaleName)} / values-${targetLang})`
                      : `Switch target language (${getLanguageOption(targetLang).name} / values-${targetLang})`
                  }
                  className="w-9.5 sm:w-10 h-9.5 sm:h-10 rounded-full bg-[#1C2330] hover:bg-[#252E3E] active:bg-[#2C374A] border border-[#2B3545] hover:border-[#1EB996]/60 text-[#1EB996] flex items-center justify-center shrink-0 transition cursor-pointer shadow-xs group"
                >
                  <Globe className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                </button>

                <button
                  id="weblate-suggest-btn"
                  type="button"
                  onClick={handleSuggest}
                  disabled={isSuggesting}
                  className="flex-1 min-w-0 h-9.5 sm:h-10 rounded-full bg-[#262E3B] hover:bg-[#323D4E] active:bg-[#1E2530] text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    {isSuggesting
                      ? isAr
                        ? 'جارٍ الاقتراح...'
                        : 'Suggesting...'
                      : isAr
                        ? 'اقترح'
                        : 'Suggest'}
                  </span>
                </button>
              </div>

              {/* Right: "حفظ بدون متابعة" (Darker Teal Pill) */}
              <button
                id="weblate-save-stay-btn"
                type="button"
                onClick={handleSaveWithoutContinuing}
                className="w-full h-9.5 sm:h-10 rounded-full bg-[#185F54] hover:bg-[#1C6F63] active:bg-[#144F46] text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer relative"
              >
                {showSavedFeedback ? (
                  <span className="flex items-center gap-1.5 text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isAr ? 'تم الحفظ!' : 'Saved!'}</span>
                  </span>
                ) : (
                  <span>{isAr ? 'حفظ بدون متابعة' : 'Save & Stay'}</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Global Navigation Footer helper for Desktop & Quick Prev/Next */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 px-2 py-0.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onNavigatePrevious}
              disabled={currentIndex === 0}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-slate-700 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            >
              <ChevronRight className="w-3 h-3" />
              <span>{isAr ? 'السابق' : 'Previous'}</span>
            </button>
            <button
              onClick={onNavigateNext}
              disabled={currentIndex === totalCount - 1}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-slate-700 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            >
              <span>{isAr ? 'التالي' : 'Next'}</span>
              <ChevronLeft className="w-3 h-3" />
            </button>
          </div>

          <div className="font-mono text-slate-400 tabular-nums">
            {currentIndex + 1} / {totalCount}
          </div>

          <button
            onClick={onNavigateNextUntranslated}
            className="text-[#1EB996] hover:underline cursor-pointer"
          >
            {isAr ? 'التالي غير المترجم' : 'Next Untranslated'}
          </button>
        </div>
      </div>

      {/* Target Language Selection Dialog */}
      <LanguageSelectorModal
        isOpen={showLangModal}
        onClose={() => setShowLangModal(false)}
        currentLang={targetLang}
        onSelectLanguage={(selected) => {
          onLanguageChange?.(selected.code);
        }}
      />
    </div>
  );
};
