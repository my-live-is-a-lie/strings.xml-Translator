import { SourceChangeBadge, SourceChangeDiff } from './SourceChangeDiff';
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, Sparkles, RotateCcw, Undo2, Redo2, ClipboardPaste, AlertCircle } from 'lucide-react';
import { ResourceItem, SingleStringItem, PluralStringItem, ArrayStringItem } from '../types';
import { EditorActionButtons } from './EditorActionButtons';
import { EditorNavFooter } from './EditorNavFooter';
import { LanguageSelectorModal } from './LanguageSelectorModal';
import { HighlightedTextarea } from './HighlightedTextarea';
import { getArabicLanguageName, getLanguageOption } from '../utils/languages';
import { suggestTranslation } from '../utils/translator';
import { normalizePluralsForLanguage } from '../utils/xmlParser';
import { fixItemEndings } from '../utils/endPunctuation';
import { fixItemSyntax, FixNote } from '../utils/syntaxFix';
import { debugIgnored } from '../utils/debug';
import { autoCloseOnDoubleSpace } from '../utils/autoCloseBracket';
import { usePredictiveWords, PredictField } from '../hooks/usePredictiveWords';
import { getItemQaIssues, QaIssue } from '../utils/placeholderCheck';
import { copyTextToClipboard, readTextFromClipboard } from '../utils/storage';

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
  predictiveWords?: boolean;
  autoCorrect?: boolean;
  /** Landscape split mode: the writing half (textarea, buttons) is rendered into this element. */
  bottomPortal?: HTMLElement | null;
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
  predictiveWords = false,
  autoCorrect = true,
  bottomPortal = null,
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

  // Track whether an input box currently has an active type line marker (blinking caret) inside it
  const activeLineMarkerRef = useRef<{
    fieldType: 'string' | 'plural' | 'array';
    quantity?: string;
    index?: number;
    position: number;
  } | null>(null);
  const isInteractingWithToolbarOrPasteRef = useRef(false);

  // Target Language selector modal state
  const [showLangModal, setShowLangModal] = useState(false);

  // Text Direction State (default to RTL for Arabic, Urdu, Hebrew, Persian)
  const isTargetRtl = ['ar', 'fa', 'ur', 'he'].includes(targetLang.toLowerCase());
  const [direction, setDirection] = useState<'ltr' | 'rtl'>(isTargetRtl ? 'rtl' : 'ltr');
  const [lastTargetLang, setLastTargetLang] = useState(targetLang);

  // UI feedback states
  const [copiedSource, setCopiedSource] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [saveGuard, setSaveGuard] = useState<{ notes: FixNote[]; remaining: QaIssue[]; empty?: boolean } | null>(null);
  const ackedIssuesRef = useRef('');

  // Suggestion loading state
  const [isSuggesting, setIsSuggesting] = useState(false);

  // Local draft state so typing/pasting/suggesting in the input box is only saved when clicking Save & Continue or Save & Stay
  const [draftState, setDraftState] = useState<{
    baseItem: ResourceItem;
    draftItem: ResourceItem;
    past: ResourceItem[];
    future: ResourceItem[];
  }>(() => ({
    baseItem: item,
    draftItem: item,
    past: [],
    future: [],
  }));
  const lastDraftEditRef = useRef<{ timestamp: number }>({ timestamp: 0 });

  let currentDraftState = draftState;
  if (draftState.baseItem !== item) {
    currentDraftState = {
      baseItem: item,
      draftItem: item,
      past: [],
      future: [],
    };
    setDraftState(currentDraftState);
  }

  const draftItem = currentDraftState.draftItem;
  const draftPast = currentDraftState.past;
  const draftFuture = currentDraftState.future;

  const updateDraftItem = React.useCallback(
    (updatedItem: ResourceItem, options?: { undoDeletesText?: boolean }) => {
      const now = Date.now();
      setDraftState((curr) => {
        const oldItem = curr.draftItem;
        if (!options?.undoDeletesText && JSON.stringify(oldItem) === JSON.stringify(updatedItem)) {
          return curr;
        }

        let isRapidSingleCharEdit = false;
        if (
          !options?.undoDeletesText &&
          oldItem.type === 'string' &&
          updatedItem.type === 'string' &&
          curr.past.length > 0 &&
          now - lastDraftEditRef.current.timestamp < 700
        ) {
          const lenDiff = Math.abs(oldItem.target.length - updatedItem.target.length);
          const notCleared = updatedItem.target.length > 0;
          if (lenDiff <= 1 && notCleared) {
            isRapidSingleCharEdit = true;
          }
        }

        let nextPast = curr.past;
        if (!isRapidSingleCharEdit) {
          const snapshotItem: ResourceItem = options?.undoDeletesText
            ? oldItem.type === 'string'
              ? { ...oldItem, target: '', status: 'untranslated', translationSource: undefined }
              : oldItem.type === 'plural'
                ? {
                    ...oldItem,
                    items: oldItem.items.map((pi) => ({ ...pi, target: '' })),
                    status: 'untranslated',
                    translationSource: undefined,
                  }
                : {
                    ...oldItem,
                    items: oldItem.items.map((ai) => ({ ...ai, target: '' })),
                    status: 'untranslated',
                    translationSource: undefined,
                  }
            : oldItem;
          nextPast = [...curr.past.slice(-99), snapshotItem];
        }

        if (
          !options?.undoDeletesText &&
          oldItem.type === 'string' &&
          updatedItem.type === 'string' &&
          Math.abs(oldItem.target.length - updatedItem.target.length) <= 1 &&
          updatedItem.target.length > 0
        ) {
          lastDraftEditRef.current = { timestamp: now };
        } else {
          lastDraftEditRef.current = { timestamp: 0 };
        }

        return {
          ...curr,
          draftItem: updatedItem,
          past: nextPast,
          future: [],
        };
      });
    },
    []
  );

  const handleEditorUndo = React.useCallback(() => {
    lastDraftEditRef.current = { timestamp: 0 };
    if (draftPast.length > 0) {
      setDraftState((curr) => {
        if (curr.past.length === 0) return curr;
        const previous = curr.past[curr.past.length - 1];
        return {
          ...curr,
          draftItem: previous,
          past: curr.past.slice(0, -1),
          future: [...curr.future, curr.draftItem],
        };
      });
    } else if (canUndo && onUndo) {
      onUndo();
    }
  }, [draftPast.length, canUndo, onUndo]);

  const handleEditorRedo = React.useCallback(() => {
    lastDraftEditRef.current = { timestamp: 0 };
    if (draftFuture.length > 0) {
      setDraftState((curr) => {
        if (curr.future.length === 0) return curr;
        const next = curr.future[curr.future.length - 1];
        return {
          ...curr,
          draftItem: next,
          past: [...curr.past, curr.draftItem],
          future: curr.future.slice(0, -1),
        };
      });
    } else if (canRedo && onRedo) {
      onRedo();
    }
  }, [draftFuture.length, canRedo, onRedo]);

  const discardDraftAndNavigate = React.useCallback(
    (navigateFn: () => void) => {
      lastDraftEditRef.current = { timestamp: 0 };
      setDraftState({
        baseItem: item,
        draftItem: item,
        past: [],
        future: [],
      });
      navigateFn();
    },
    [item]
  );

  // Reset direction when target language changes
  const expectedDirection: 'ltr' | 'rtl' = isTargetRtl ? 'rtl' : 'ltr';
  const [lastExpectedDirection, setLastExpectedDirection] = useState(expectedDirection);
  if (lastExpectedDirection !== expectedDirection || lastTargetLang !== targetLang) {
    setLastExpectedDirection(expectedDirection);
    setLastTargetLang(targetLang);
    setDirection(expectedDirection);
  }

  // Reset tools menu state and cursor ref when item changes
  useEffect(() => {
    lastCursorRef.current = null;
    activeLineMarkerRef.current = null;
    lastDraftEditRef.current = { timestamp: 0 };
  }, [item.id]);

  // Extract source text
  const getSourceText = (): string => {
    if (draftItem.type === 'string') return draftItem.source;
    if (draftItem.type === 'plural') return draftItem.items[0]?.source || '';
    if (draftItem.type === 'array') return draftItem.items[0]?.source || '';
    return '';
  };

  // Extract current target text (from local editor draft)
  const getTargetText = (): string => {
    if (draftItem.type === 'string') return draftItem.target;
    if (draftItem.type === 'plural') return draftItem.items[0]?.target || '';
    if (draftItem.type === 'array') return draftItem.items[0]?.target || '';
    return '';
  };

  const sourceText = getSourceText();
  const currentTargetText = getTargetText();

  // Auto-adjust textarea height to match exact size of typed text
  const adjustTextareaHeight = (targetEl?: HTMLTextAreaElement | null) => {
    const el = targetEl || textareaRef.current;
    if (!el) return;
    const currentMin = parseFloat(el.style.minHeight) || 0;
    el.style.height = 'auto';
    // Include border-box offset so content never clips
    const borderOffset = el.offsetHeight - el.clientHeight;
    const naturalHeight = el.scrollHeight + borderOffset;
    el.style.height = `${Math.max(naturalHeight, currentMin)}px`;
  };

  useEffect(() => {
    adjustTextareaHeight();
    const handleResize = () => adjustTextareaHeight();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [item.id, currentTargetText, draftItem.type, direction]);

  // Typing a second space after an unclosed bracket closes the bracket (keeps the caret after it)
  const applyAutoClose = (el: HTMLTextAreaElement, prev: string, key: string, apply: (val: string) => void) => {
    const next = el.value;
    // Space accepts a word completion, Backspace rejects it
    const predicted = predict.handleChange(key, prev, next);
    if (predicted !== null) {
      el.value = predicted;
      apply(predicted);
      requestAnimationFrame(() => {
        try {
          el.setSelectionRange(predicted.length, predicted.length);
        } catch (err) {
          debugIgnored('TranslationEditor.predict', err);
        }
      });
      return;
    }
    const fixed = autoCorrect ? autoCloseOnDoubleSpace(prev, next, el.selectionStart ?? next.length) : null;
    if (!fixed) {
      apply(next);
      return;
    }
    apply(fixed.text);
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(fixed.caret, fixed.caret);
      } catch (err) {
        debugIgnored('TranslationEditor.autoClose', err);
      }
    });
  };

  // Handle single string text change (updates local draft only; saved on Save & Continue / Save & Stay)
  const handleSingleTextChange = (val: string) => {
    if (draftItem.type !== 'string') return;
    const isNowEmpty = !val.trim();
    const updated: SingleStringItem = {
      ...draftItem,
      target: val,
      status: isNowEmpty ? 'untranslated' : draftItem.status === 'untranslated' ? 'translated' : draftItem.status,
      translationSource: isNowEmpty ? undefined : 'manual',
    };
    updateDraftItem(updated);
  };

  // Ensure plural items always include all CLDR quantities for targetLang (e.g. zero, one, two, few, many, other for Arabic)
  const normalizedPluralItems = useMemo(
    () =>
      draftItem.type === 'plural'
        ? (normalizePluralsForLanguage([draftItem], targetLang)[0] as PluralStringItem).items
        : [],
    [draftItem, targetLang]
  );

  // Word prediction: the machine translation of each source text feeds grey completions while typing
  const predictFields = useMemo<PredictField[]>(() => {
    if (draftItem.type === 'string') return [{ key: 'string', source: draftItem.source }];
    if (draftItem.type === 'plural') {
      const fallback = draftItem.items.find((pi) => pi.quantity === 'other')?.source || draftItem.items[0]?.source || '';
      return normalizedPluralItems.map((pi) => ({
        key: `plural:${pi.quantity}`,
        source: pi.source || fallback,
        quantity: pi.quantity,
      }));
    }
    return draftItem.items.map((ai) => ({ key: `array:${ai.index}`, source: ai.source }));
  }, [draftItem, normalizedPluralItems]);
  const predict = usePredictiveWords({
    enabled: predictiveWords && item.translatable !== false,
    resetKey: item.id,
    fields: predictFields,
    targetLang,
    targetLocaleName,
  });

  // Plural change (updates local draft only)
  const handlePluralQuantityChange = (quantity: string, val: string) => {
    if (draftItem.type !== 'plural') return;
    const baseItems = normalizedPluralItems;
    const newItems = baseItems.map((pi) => (pi.quantity === quantity ? { ...pi, target: val } : pi));
    const anyFilled = newItems.some((pi) => pi.target.trim().length > 0);
    const updated: PluralStringItem = {
      ...draftItem,
      items: newItems,
      status: anyFilled ? (draftItem.status === 'untranslated' ? 'translated' : draftItem.status) : 'untranslated',
      translationSource: anyFilled ? 'manual' : undefined,
    };
    updateDraftItem(updated);
  };

  // Array item change (updates local draft only)
  const handleArrayItemChange = (index: number, val: string) => {
    if (draftItem.type !== 'array') return;
    const newItems = draftItem.items.map((ai) => (ai.index === index ? { ...ai, target: val } : ai));
    const anyFilled = newItems.some((ai) => ai.target.trim().length > 0);
    const updated: ArrayStringItem = {
      ...draftItem,
      items: newItems,
      status: anyFilled ? (draftItem.status === 'untranslated' ? 'translated' : draftItem.status) : 'untranslated',
      translationSource: anyFilled ? 'manual' : undefined,
    };
    updateDraftItem(updated);
  };

  // Clone source directly to target (Weblate clone action - updates local draft only)
  const handleCloneSourceToTarget = () => {
    if (draftItem.type === 'string') {
      const updated: SingleStringItem = {
        ...draftItem,
        target: draftItem.source,
        status: draftItem.source ? 'translated' : draftItem.status,
        translationSource: draftItem.source ? 'manual' : undefined,
      };
      updateDraftItem(updated);
    } else if (draftItem.type === 'plural') {
      const updated: PluralStringItem = {
        ...draftItem,
        items: normalizedPluralItems.map((pi) => ({ ...pi, target: pi.source })),
        status: 'translated',
        translationSource: 'manual',
      };
      updateDraftItem(updated);
    } else if (draftItem.type === 'array') {
      const updated: ArrayStringItem = {
        ...draftItem,
        items: draftItem.items.map((ai) => ({ ...ai, target: ai.source })),
        status: 'translated',
        translationSource: 'manual',
      };
      updateDraftItem(updated);
    }
  };

  // Record cursor (line indicator) position whenever user interacts with a textarea
  const recordCursorPosition = (
    el: HTMLTextAreaElement | null,
    fieldType: 'string' | 'plural' | 'array',
    extra?: { quantity?: string; index?: number }
  ) => {
    if (!el) return;
    predict.noteCursor(
      fieldType === 'string' ? 'string' : fieldType === 'plural' ? `plural:${extra?.quantity}` : `array:${extra?.index}`,
      el
    );
    const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
    lastCursorRef.current = {
      fieldType,
      quantity: extra?.quantity,
      index: extra?.index,
      start,
      end,
    };
    activeLineMarkerRef.current = {
      fieldType,
      quantity: extra?.quantity,
      index: extra?.index,
      position: start,
    };
  };

  const handleTextareaBlur = (
    el: HTMLTextAreaElement | null,
    fieldType: 'string' | 'plural' | 'array',
    extra?: { quantity?: string; index?: number }
  ) => {
    predict.clearCursor();
    setTimeout(() => {
      if (isInteractingWithToolbarOrPasteRef.current) return;
      if (el && document.activeElement === el) return;
      if (
        activeLineMarkerRef.current &&
        activeLineMarkerRef.current.fieldType === fieldType &&
        activeLineMarkerRef.current.quantity === extra?.quantity &&
        activeLineMarkerRef.current.index === extra?.index
      ) {
        activeLineMarkerRef.current = null;
      }
    }, 0);
  };

  // Insert character, symbol, or Android syntax token at cursor (line indicator) position in the active textarea
  const insertAtCursor = (
    charToInsert: string,
    targetField?: { fieldType: 'plural'; quantity: string } | { fieldType: 'array'; index: number }
  ) => {
    if (draftItem.type === 'string') {
      const el = textareaRef.current;
      const text = draftItem.target;
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

    if (draftItem.type === 'plural') {
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

    if (draftItem.type === 'array') {
      const saved =
        lastCursorRef.current?.fieldType === 'array' ? lastCursorRef.current : null;
      const targetIdx =
        (targetField?.fieldType === 'array' ? targetField.index : undefined) ??
        saved?.index ??
        draftItem.items[0]?.index ??
        0;

      const arrayEntry = draftItem.items.find((ai) => ai.index === targetIdx);
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
      return <span className="italic text-slate-500">{isAr ? 'نص فارغ' : 'Empty string'}</span>;
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
            title={isAr ? 'انقر لإدراج هذا الرمز في موضع المؤشر' : 'Tap to insert at cursor'}
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
            className="inline-block font-sans px-[1px] py-0.5 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 dark:bg-[#2B2E35] dark:hover:bg-[#363B46] dark:active:bg-[#404654] rounded-[2px] text-slate-800 dark:text-slate-100 cursor-pointer select-none transition-colors leading-tight"
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  // Copy link / XML key
  // Copy English source
  const handleCopySource = () => {
    void copyTextToClipboard(sourceText);
    setCopiedSource(true);
    setTimeout(() => setCopiedSource(false), 2000);
  };

  // Copy input box text (target translation)
  const handleCopyTarget = () => {
    let textToCopy = currentTargetText;
    if (draftItem.type === 'string') {
      textToCopy = draftItem.target;
    } else if (draftItem.type === 'plural') {
      const targetQty =
        activeLineMarkerRef.current?.quantity ||
        lastCursorRef.current?.quantity ||
        normalizedPluralItems[0]?.quantity;
      const found = normalizedPluralItems.find((pi) => pi.quantity === targetQty);
      textToCopy = found ? found.target : currentTargetText;
    } else if (draftItem.type === 'array') {
      const targetIdx =
        activeLineMarkerRef.current?.index ??
        lastCursorRef.current?.index ??
        draftItem.items[0]?.index ??
        0;
      const found = draftItem.items.find((ai) => ai.index === targetIdx);
      textToCopy = found ? found.target : currentTargetText;
    }

    void copyTextToClipboard(textToCopy);
    setCopiedTarget(true);
    setTimeout(() => setCopiedTarget(false), 2000);
  };

  // Paste into input box:
  // - If the input box does NOT have a type line marker active in it: replace any existing text with clipboard text.
  // - If there IS a type line marker active in the text box: paste from that line marker without removing existing text.
  const handlePasteTarget = async () => {
    // Snapshot active line marker state right when Paste is triggered
    const activeMarker = activeLineMarkerRef.current;
    const activeElement = typeof document !== 'undefined' ? document.activeElement : null;

    const pastedText = await readTextFromClipboard();
    isInteractingWithToolbarOrPasteRef.current = false;

    if (pastedText === null || pastedText === undefined) return;

    if (draftItem.type === 'string') {
      const el = textareaRef.current;
      const isFocusedNow = Boolean(el && activeElement === el);
      const hasActiveLineMarker = isFocusedNow || activeMarker?.fieldType === 'string';

      if (hasActiveLineMarker) {
        const text = draftItem.target || '';
        const rawPos = isFocusedNow && el
          ? el.selectionStart
          : activeMarker?.position ?? text.length;
        const pos = Math.max(0, Math.min(rawPos, text.length));
        const newText = text.substring(0, pos) + pastedText + text.substring(pos);
        const newCursor = pos + pastedText.length;

        lastCursorRef.current = {
          fieldType: 'string',
          start: newCursor,
          end: newCursor,
        };
        activeLineMarkerRef.current = {
          fieldType: 'string',
          position: newCursor,
        };

        handleSingleTextChange(newText);
        setTimeout(() => {
          if (el) {
            adjustTextareaHeight(el);
            el.focus();
            el.setSelectionRange(newCursor, newCursor);
          }
        }, 0);
      } else {
        // No active type line marker in the input box: remove any text in the input box and replace with clipboard text
        activeLineMarkerRef.current = null;
        lastCursorRef.current = null;
        handleSingleTextChange(pastedText);
        setTimeout(() => {
          if (el) {
            adjustTextareaHeight(el);
          }
        }, 0);
      }
      return;
    }

    if (draftItem.type === 'plural') {
      const focusedQty = Object.keys(pluralTextareaRefs.current).find(
        (q) => pluralTextareaRefs.current[q] && activeElement === pluralTextareaRefs.current[q]
      );
      const hasActiveLineMarker = Boolean(
        focusedQty || (activeMarker?.fieldType === 'plural' && activeMarker.quantity)
      );
      const targetQty =
        focusedQty ||
        activeMarker?.quantity ||
        lastCursorRef.current?.quantity ||
        normalizedPluralItems[0]?.quantity;
      if (!targetQty) return;

      const pluralEntry = normalizedPluralItems.find((pi) => pi.quantity === targetQty);
      if (!pluralEntry) return;
      const el = pluralTextareaRefs.current[targetQty];

      if (hasActiveLineMarker) {
        const text = pluralEntry.target || '';
        const rawPos =
          focusedQty && el ? el.selectionStart : activeMarker?.position ?? text.length;
        const pos = Math.max(0, Math.min(rawPos, text.length));
        const newText = text.substring(0, pos) + pastedText + text.substring(pos);
        const newCursor = pos + pastedText.length;

        lastCursorRef.current = {
          fieldType: 'plural',
          quantity: targetQty,
          start: newCursor,
          end: newCursor,
        };
        activeLineMarkerRef.current = {
          fieldType: 'plural',
          quantity: targetQty,
          position: newCursor,
        };

        handlePluralQuantityChange(targetQty, newText);
        setTimeout(() => {
          if (el) {
            adjustTextareaHeight(el);
            el.focus();
            el.setSelectionRange(newCursor, newCursor);
          }
        }, 0);
      } else {
        activeLineMarkerRef.current = null;
        handlePluralQuantityChange(targetQty, pastedText);
        setTimeout(() => {
          if (el) {
            adjustTextareaHeight(el);
          }
        }, 0);
      }
      return;
    }

    if (draftItem.type === 'array') {
      const focusedIdxKey = Object.keys(arrayTextareaRefs.current).find(
        (idxKey) =>
          arrayTextareaRefs.current[Number(idxKey)] &&
          activeElement === arrayTextareaRefs.current[Number(idxKey)]
      );
      const focusedIdx = focusedIdxKey !== undefined ? Number(focusedIdxKey) : undefined;
      const hasActiveLineMarker = Boolean(
        focusedIdx !== undefined ||
          (activeMarker?.fieldType === 'array' && activeMarker.index !== undefined)
      );
      const targetIdx =
        focusedIdx ??
        activeMarker?.index ??
        lastCursorRef.current?.index ??
        draftItem.items[0]?.index ??
        0;

      const arrayEntry = draftItem.items.find((ai) => ai.index === targetIdx);
      if (!arrayEntry) return;
      const el = arrayTextareaRefs.current[targetIdx];

      if (hasActiveLineMarker) {
        const text = arrayEntry.target || '';
        const rawPos =
          focusedIdx !== undefined && el
            ? el.selectionStart
            : activeMarker?.position ?? text.length;
        const pos = Math.max(0, Math.min(rawPos, text.length));
        const newText = text.substring(0, pos) + pastedText + text.substring(pos);
        const newCursor = pos + pastedText.length;

        lastCursorRef.current = {
          fieldType: 'array',
          index: targetIdx,
          start: newCursor,
          end: newCursor,
        };
        activeLineMarkerRef.current = {
          fieldType: 'array',
          index: targetIdx,
          position: newCursor,
        };

        handleArrayItemChange(targetIdx, newText);
        setTimeout(() => {
          if (el) {
            adjustTextareaHeight(el);
            el.focus();
            el.setSelectionRange(newCursor, newCursor);
          }
        }, 0);
      } else {
        activeLineMarkerRef.current = null;
        handleArrayItemChange(targetIdx, pastedText);
        setTimeout(() => {
          if (el) {
            adjustTextareaHeight(el);
          }
        }, 0);
      }
    }
  };

  // Toggle "Needs editing / Needs review" (تحتاج إلى تعديل)
  // Build final ResourceItem to save when user clicks Save & Continue or Save & Stay
  const buildSavedItemFromDraft = React.useCallback(
    (currentDraft: ResourceItem): ResourceItem => {
      if (currentDraft.type === 'string') {
        const isNowEmpty = !currentDraft.target.trim();
        return {
          ...currentDraft,
          status: isNowEmpty
            ? 'untranslated'
            : currentDraft.status === 'untranslated'
              ? 'translated'
              : currentDraft.status,
          translationSource: isNowEmpty ? undefined : currentDraft.translationSource || 'manual',
        };
      }
      if (currentDraft.type === 'plural') {
        const baseItems = (
          normalizePluralsForLanguage([currentDraft], targetLang)[0] as PluralStringItem
        ).items;
        const anyFilled = baseItems.some((pi) => pi.target.trim().length > 0);
        return {
          ...currentDraft,
          items: baseItems,
          status: anyFilled
            ? currentDraft.status === 'untranslated'
              ? 'translated'
              : currentDraft.status
            : 'untranslated',
          translationSource: anyFilled ? currentDraft.translationSource || 'manual' : undefined,
        };
      }
      if (currentDraft.type === 'array') {
        const anyFilled = currentDraft.items.some((ai) => ai.target.trim().length > 0);
        return {
          ...currentDraft,
          status: anyFilled
            ? currentDraft.status === 'untranslated'
              ? 'translated'
              : currentDraft.status
            : 'untranslated',
          translationSource: anyFilled ? currentDraft.translationSource || 'manual' : undefined,
        };
      }
      return currentDraft;
    },
    [targetLang]
  );

  // Nothing typed: saving an untouched empty translation does nothing (no status change, no navigation)
  const isNothingTyped = React.useCallback((): boolean => {
    const hasText = (it: ResourceItem) =>
      it.type === 'string' ? !!it.target.trim() : it.items.some((x) => !!x.target.trim());
    return !hasText(draftItem) && !hasText(item);
  }, [draftItem, item]);

  const blockIfNothingTyped = React.useCallback((): boolean => {
    if (!isNothingTyped()) return false;
    setSaveGuard({ notes: [], remaining: [], empty: true });
    return true;
  }, [isNothingTyped]);

  // Before saving: repairs placeholders, HTML tags and final punctuation from the source's context.
  // When anything was changed (or unfixable errors remain) the save is blocked once with a message; saving again confirms.
  const blockIfNeedsFix = React.useCallback((): boolean => {
    if (!autoCorrect) return false; // the user turned auto-correction off: save exactly what was typed
    const base =
      draftItem.type === 'plural'
        ? ({ ...draftItem, items: (normalizePluralsForLanguage([draftItem], targetLang)[0] as PluralStringItem).items } as ResourceItem)
        : draftItem;
    const syn = fixItemSyntax(base);
    const pun = fixItemEndings(syn.item);
    const notes: FixNote[] = [...syn.notes];
    if (pun.changed) {
      notes.push({
        en: 'Ending (punctuation / trailing spaces) corrected to match the source',
        ar: 'صُحّحت نهاية النص (علامة الترقيم أو المسافات الزائدة) لتطابق النص الأصلي',
      });
    }
    const remaining = getItemQaIssues(pun.item).filter((i) => i.severity === 'error');
    const remKey = `${pun.item.id}|${remaining.map((i) => i.id + i.tokens.join(',')).join(';')}`;
    if (notes.length > 0) {
      updateDraftItem(pun.item);
      ackedIssuesRef.current = remKey;
      setSaveGuard({ notes, remaining });
      return true;
    }
    if (remaining.length > 0 && ackedIssuesRef.current !== remKey) {
      ackedIssuesRef.current = remKey;
      setSaveGuard({ notes, remaining });
      return true;
    }
    return false;
  }, [autoCorrect, draftItem, targetLang, updateDraftItem]);

  useEffect(() => {
    if (!saveGuard) return;
    const t = setTimeout(() => setSaveGuard(null), 12000);
    return () => clearTimeout(t);
  }, [saveGuard]);

  // Save without continuing (حفظ بدون متابعة / Save & Stay)
  const handleSaveWithoutContinuing = React.useCallback(() => {
    if (blockIfNothingTyped() || blockIfNeedsFix()) return;
    // Saving settles the string: the old source text (diff) is no longer shown
    const savedItem = { ...buildSavedItemFromDraft(draftItem), previousSources: undefined };
    const undoDeletesText = savedItem.translationSource === 'ai' && item.status === 'untranslated';
    lastDraftEditRef.current = { timestamp: 0 };
    setDraftState({
      baseItem: savedItem,
      draftItem: savedItem,
      past: [],
      future: [],
    });
    onUpdateTranslation(savedItem, undoDeletesText ? { undoDeletesText: true } : undefined);
    setShowSavedFeedback(true);
    setTimeout(() => setShowSavedFeedback(false), 2000);
  }, [blockIfNothingTyped, blockIfNeedsFix, buildSavedItemFromDraft, draftItem, item.status, onUpdateTranslation]);

  // Save and continue (حفظ ومتابعة / Save & Continue)
  const handleSaveAndContinue = React.useCallback(() => {
    if (isNothingTyped()) {
      onNavigateNext(); // nothing typed: nothing is saved, just continue
      return;
    }
    if (blockIfNeedsFix()) return;
    // Saving settles the string: the old source text (diff) is no longer shown
    const savedItem = { ...buildSavedItemFromDraft(draftItem), previousSources: undefined };
    const undoDeletesText = savedItem.translationSource === 'ai' && item.status === 'untranslated';
    lastDraftEditRef.current = { timestamp: 0 };
    setDraftState({
      baseItem: savedItem,
      draftItem: savedItem,
      past: [],
      future: [],
    });
    onUpdateTranslation(savedItem, undoDeletesText ? { undoDeletesText: true } : undefined);
    onNavigateNext();
  }, [isNothingTyped, blockIfNeedsFix, buildSavedItemFromDraft, draftItem, item.status, onUpdateTranslation, onNavigateNext]);

  // Editor keyboard shortcuts for Undo/Redo and Ctrl+Enter (Save & Continue)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleEditorUndo();
        return;
      }
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleEditorRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleSaveAndContinue();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleEditorUndo, handleEditorRedo, handleSaveAndContinue]);

  // Suggest translation (اقترح) — immediately fills the input box (draft) and allows Undo button to delete suggested text
  const handleSuggest = async () => {
    setIsSuggesting(true);

    try {
      if (draftItem.type === 'string') {
        const res = await suggestTranslation(draftItem.source, targetLang, targetLocaleName);
        if (res && res.text) {
          const isNowEmpty = !res.text.trim();
          const updated: SingleStringItem = {
            ...draftItem,
            target: res.text,
            status: isNowEmpty ? 'untranslated' : 'translated',
            translationSource: isNowEmpty ? undefined : 'ai',
            translationEngine: isNowEmpty ? undefined : res.source,
          };
          updateDraftItem(updated, { undoDeletesText: true });
        }
      } else if (draftItem.type === 'plural') {
        const updated = await Promise.all(
          normalizedPluralItems.map(async (pi) => {
            const res = await suggestTranslation(pi.source, targetLang, targetLocaleName, pi.quantity);
            return {
              ...pi,
              target: res?.text || pi.target,
            };
          })
        );
        updateDraftItem(
          {
            ...draftItem,
            items: updated,
            status: 'translated',
            translationSource: 'ai',
          },
          { undoDeletesText: true }
        );
      } else if (draftItem.type === 'array') {
        const updated = await Promise.all(
          draftItem.items.map(async (ai) => {
            const res = await suggestTranslation(ai.source, targetLang, targetLocaleName);
            return {
              ...ai,
              target: res?.text || ai.target,
            };
          })
        );
        updateDraftItem(
          {
            ...draftItem,
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

  // Auto-translate untranslated strings into the editor input box when Auto Translate toggle is active
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
              translationEngine: res.source,
            };
            completed = true;
            updateDraftItem(updated, { undoDeletesText: true });
          }
        } else if (item.type === 'plural') {
          const basePlurals = (
            normalizePluralsForLanguage([item], targetLang)[0] as PluralStringItem
          ).items;
          const updated = await Promise.all(
            basePlurals.map(async (pi) => {
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
            updateDraftItem(
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
            updateDraftItem(
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
  }, [autoTranslate, item, targetLang, targetLocaleName, updateDraftItem]);

  // Tools Actions
  const handleClearText = () => {
    if (draftItem.type === 'string') {
      handleSingleTextChange('');
    } else if (draftItem.type === 'plural') {
      updateDraftItem({
        ...draftItem,
        items: normalizedPluralItems.map((pi) => ({ ...pi, target: '' })),
        status: 'untranslated',
        translationSource: undefined,
      });
    } else if (draftItem.type === 'array') {
      updateDraftItem({
        ...draftItem,
        items: draftItem.items.map((ai) => ({ ...ai, target: '' })),
        status: 'untranslated',
        translationSource: undefined,
      });
    }
  };

  // Check if target text currently contains multiple consecutive spaces (typing mistake)
  const hasMultipleSpaces = React.useMemo(() => {
    if (draftItem.type === 'string') {
      return / {2,}/.test(draftItem.target || '');
    }
    if (draftItem.type === 'plural') {
      return normalizedPluralItems.some((pi) => / {2,}/.test(pi.target || ''));
    }
    if (draftItem.type === 'array') {
      return draftItem.items.some((ai) => / {2,}/.test(ai.target || ''));
    }
    return false;
  }, [draftItem, normalizedPluralItems]);

  // Fix typing mistake: replace multiple consecutive spaces with a single space
  const handleFixMultipleSpaces = () => {
    if (draftItem.type === 'string') {
      const fixed = (draftItem.target || '').replace(/ {2,}/g, ' ');
      handleSingleTextChange(fixed);
    } else if (draftItem.type === 'plural') {
      const fixedPlurals = normalizedPluralItems.map((pi) => ({
        ...pi,
        target: (pi.target || '').replace(/ {2,}/g, ' '),
      }));
      updateDraftItem({
        ...draftItem,
        items: fixedPlurals,
      });
    } else if (draftItem.type === 'array') {
      const fixedItems = draftItem.items.map((ai) => ({
        ...ai,
        target: (ai.target || '').replace(/ {2,}/g, ' '),
      }));
      updateDraftItem({
        ...draftItem,
        items: fixedItems,
      });
    }
  };

  const effectiveCanUndo = draftPast.length > 0 || canUndo;
  const effectiveCanRedo = draftFuture.length > 0 || canRedo;
  const effectiveUndoCount = draftPast.length + undoCount;
  const effectiveRedoCount = draftFuture.length + redoCount;

  // Max recommended character threshold

  // In landscape split mode the writing area goes into the other half of the screen
  const slot = (key: string, className: string, children: React.ReactNode, plainClass?: string) =>
    bottomPortal ? (
      createPortal(<div className={className}>{children}</div>, bottomPortal, key)
    ) : plainClass ? (
      <div className={plainClass}>{children}</div>
    ) : (
      <>{children}</>
    );

  return (
    <div className="flex flex-col h-full bg-[#F8F9FA] dark:bg-[#0E1015] text-slate-800 dark:text-slate-100 overflow-y-auto p-2 sm:p-3">
      <div className="max-w-2xl w-full mx-auto flex flex-col gap-2">
        {/* Weblate / M3 Main Card Frame */}
        <div className="bg-white dark:bg-[#151922] rounded-2xl border border-slate-200/80 dark:border-transparent shadow-sm dark:shadow-lg overflow-hidden">
          <div className="p-3 sm:p-3.5 space-y-2.5">
            {/* Top row: Key name + "مفاتيح" on Left, "الإنجليزية" on Right */}
            <div className="kb-hide flex items-center justify-between gap-2 text-xs sm:text-sm">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate select-all">
                  {item.name}
                </span>
                <span className="text-slate-600 dark:text-slate-400 text-[11px] sm:text-xs font-medium">
                  {isAr ? 'مفاتيح' : 'Keys'}
                </span>
                <SourceChangeBadge item={item} isAr={isAr} />
              </div>

              <span className="text-slate-600 dark:text-slate-300 text-xs sm:text-sm font-medium shrink-0">
                {isAr ? 'الإنجليزية' : 'English'}
              </span>
            </div>

            {/* Source Display Box with Clone & Copy Icons */}
            <div className="flex items-center gap-1">
              {/* Clone icon button (Weblate clone to target — matches screenshot) */}
              <button
                id="weblate-clone-to-target-btn"
                onClick={handleCloneSourceToTarget}
                className="ps-1.5 pe-1 py-1 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-slate-200/80 dark:hover:bg-[#1C2330] transition cursor-pointer shrink-0"
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
              <div className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-100/90 dark:bg-[#141822] border border-slate-200/90 dark:border-[#283140] flex items-center justify-between gap-2.5">
                {/* Left: Copy button */}
                <button
                  id="copy-source-text-btn"
                  onClick={handleCopySource}
                  className="p-1 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-slate-200/80 dark:hover:bg-[#202736] transition cursor-pointer shrink-0"
                  title={isAr ? 'نسخ النص الإنجليزي' : 'Copy English source text'}
                >
                  {copiedSource ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>

                {/* English source text with interactive Android syntax highlights */}
                <span dir="auto" className="flex-1 text-xs sm:text-sm font-normal text-slate-800 dark:text-slate-100 select-text break-words leading-relaxed">
                  {renderSourceWithSyntaxHighlights(sourceText)}
                </span>
              </div>
            </div>

            <SourceChangeDiff item={item} isAr={isAr} />

            {/* Target Language Name on Right + Translation Source, Alert & Reset on Left */}
            {slot('r0', 'kb-hide flex items-center justify-between gap-2 px-1', <>
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
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
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-[#1C2330] hover:bg-rose-100 dark:hover:bg-rose-950/50 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-300 border border-slate-200/90 dark:border-[#2B3545] hover:border-rose-400 dark:hover:border-rose-800/60 transition cursor-pointer"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>{isAr ? 'إعادة تعيين' : 'Reset'}</span>
                      </button>
                    )}
                  </>
                )}
              </div>

              <span className="text-slate-600 dark:text-slate-300 text-xs sm:text-sm font-medium shrink-0">
                {isAr
                  ? getArabicLanguageName(targetLang, targetLocaleName)
                  : getLanguageOption(targetLang).name || targetLocaleName}
              </span>
            </>, 'flex items-center justify-between gap-2')}

            {/* Two Connected Typographic / Formatting Toolbars */}
            <div className="space-y-1 select-none">
              {/* Toolbar Row 1: Punctuation & Typography */}
              <div dir="ltr" className="flex items-center bg-slate-100 dark:bg-[#171D27] border border-slate-200/90 dark:border-[#283242] rounded-lg overflow-x-auto divide-x divide-slate-200 dark:divide-[#283242] rtl:divide-x-reverse no-scrollbar">
                {[
                  { label: '-', value: '-', title: isAr ? 'شرطة (-)' : 'Hyphen (-)' },
                  { label: '_', value: '_', title: isAr ? 'شرطة سفلية (_)' : 'Underscore (_)' },
                  { label: '( - )', value: '( - )', title: isAr ? 'أقواس ( - )' : 'Parentheses ( - )' },
                  { label: "'", value: "'", title: isAr ? "فاصلة علوية مفردة (')" : "Single quote (')" },
                  { label: '‘', value: '‘', title: isAr ? 'علامة تنصيص مفردة (‘)' : 'Arabic quote / comma (‘)' },
                  { label: '"', value: '"', title: isAr ? 'علامة تنصيص مزدوجة (")' : 'Double quote (")' },
                  { label: '“', value: '“', title: isAr ? 'علامة تنصيص منحنية (“)' : 'Curly quote (“)' },
                  { label: '...', value: '…', title: isAr ? 'نقاط حذف أفقية (…)' : 'Horizontal Ellipsis (…)' },
                  { label: 'NBS', value: '\u00A0', title: isAr ? 'مسافة غير فاصلة (NBS)' : 'Non-Breaking Space (U+00A0)' },
                  { label: '↵', value: '\\n', title: isAr ? 'سطر جديد (\\n)' : 'Newline (\\n)' },
                  { label: '⇄', value: '\\t', title: isAr ? 'مسافة جدولة (\\t)' : 'Tabulation (\\t)' },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertAtCursor(btn.value)}
                    title={btn.title}
                    className="flex-1 min-w-[30px] sm:min-w-[38px] h-7 sm:h-7.5 whitespace-nowrap px-1 flex items-center justify-center text-xs font-mono font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#232C3A] active:bg-slate-300 dark:active:bg-[#2C3748] transition cursor-pointer"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>

              {/* Toolbar Row 2: BiDi Unicode Directional Controls */}
              <div dir="ltr" className="flex items-center bg-slate-100 dark:bg-[#171D27] border border-slate-200/90 dark:border-[#283242] rounded-lg overflow-x-auto divide-x divide-slate-200 dark:divide-[#283242] rtl:divide-x-reverse no-scrollbar">
                {[
                  { label: 'PDF', value: '\u202C', title: isAr ? 'إنهاء تنسيق الاتجاه (PDF)' : 'Pop Directional Formatting (U+202C)' },
                  { label: 'RLE', value: '\u202B', title: isAr ? 'تضمين من اليمين إلى اليسار (RLE)' : 'Right-to-Left Embedding (U+202B)' },
                  { label: 'LRE', value: '\u202A', title: isAr ? 'تضمين من اليسار إلى اليمين (LRE)' : 'Left-to-Right Embedding (U+202A)' },
                  { label: 'RLM', value: '\u200F', title: isAr ? 'علامة من اليمين إلى اليسار (RLM)' : 'Right-to-Left Mark (U+200F)' },
                  { label: 'LRM', value: '\u200E', title: isAr ? 'علامة من اليسار إلى اليمين (LRM)' : 'Left-to-Right Mark (U+200E)' },
                  { label: 'ZWJ', value: '\u200D', title: isAr ? 'رابط بعرض صفري (ZWJ)' : 'Zero-Width Joiner (U+200D)' },
                  { label: 'ZWNJ', value: '\u200C', title: isAr ? 'فاصل بعرض صفري (ZWNJ)' : 'Zero-Width Non-Joiner (U+200C)' },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertAtCursor(btn.value)}
                    title={btn.title}
                    className="flex-1 min-w-[40px] sm:min-w-[48px] h-7 sm:h-7.5 flex items-center justify-center text-[10px] sm:text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#232C3A] active:bg-slate-300 dark:active:bg-[#2C3748] transition cursor-pointer tracking-wider"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {slot('r1', 'space-y-2.5 rounded-2xl bg-white dark:bg-[#151922] border border-slate-200/80 dark:border-transparent p-3', <>
            {/* Single Multiple Consecutive Spaces Typing Mistake Warning Banner */}
            {hasMultipleSpaces && (
              <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-medium animate-in fade-in duration-150 gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="truncate">
                    {isAr
                      ? 'مسافات متتالية زائدة بين الكلمات'
                      : 'Multiple spaces detected between words'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleFixMultipleSpaces}
                  className="px-2.5 py-0.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] shadow-xs transition cursor-pointer shrink-0"
                >
                  {isAr ? 'إصلاح المسافات' : 'Fix spaces'}
                </button>
              </div>
            )}

            {/* Translation Textarea (Single String) with Visual Typing Mistake Indicator */}
            {draftItem.type === 'string' && (
              <HighlightedTextarea
                id="weblate-translation-input"
                ref={textareaRef}
                dir={direction}
                value={draftItem.target}
                ghostText={predict.ghostFor('string', draftItem.target)}
                resetKey={draftItem.id}
                onValueChange={(val) => {
                  handleSingleTextChange(val);
                }}
                onFocus={(e) => recordCursorPosition(e.currentTarget, 'string')}
                onBlur={(e) => handleTextareaBlur(e.currentTarget, 'string')}
                onClick={(e) => recordCursorPosition(e.currentTarget, 'string')}
                onKeyUp={(e) => recordCursorPosition(e.currentTarget, 'string')}
                onSelect={(e) => recordCursorPosition(e.currentTarget, 'string')}
                onChange={(e) => {
                  recordCursorPosition(e.currentTarget, 'string');
                  adjustTextareaHeight(e.currentTarget);
                  applyAutoClose(e.currentTarget, draftItem.target, 'string', handleSingleTextChange);
                }}
                placeholder={isAr ? 'اكتب الترجمة هنا...' : 'Type translation here...'}
                rows={1}
                containerClassName="rounded-xl bg-slate-100/90 dark:bg-[#0E121A] border border-slate-200/90 dark:border-transparent"
                backdropClassName="border-0 border-b-2 border-transparent px-3.5 pt-2 pb-3.5 sm:pt-2.5 sm:pb-4 text-xs sm:text-sm leading-relaxed"
                className="px-3.5 pt-2 pb-3.5 sm:pt-2.5 sm:pb-4 rounded-xl border-0 border-b-2 border-[#16695E] focus:border-[#1EB996] text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-xs sm:text-sm leading-relaxed focus:outline-none transition-colors resize-none overflow-hidden block"
              />
            )}

            {/* Plural Support (if plural string) with Visual Typing Mistake Indicator */}
            {draftItem.type === 'plural' && (
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
                    <HighlightedTextarea
                      rows={1}
                      dir={direction}
                      value={pi.target}
                      ghostText={predict.ghostFor(`plural:${pi.quantity}`, pi.target)}
                      resetKey={`${draftItem.id}-${pi.quantity}`}
                      onValueChange={(val) => {
                        handlePluralQuantityChange(pi.quantity, val);
                      }}
                      ref={(el) => {
                        pluralTextareaRefs.current[pi.quantity] = el;
                        if (el) {
                          const currentMin = parseFloat(el.style.minHeight) || 0;
                          el.style.height = 'auto';
                          const borderOffset = el.offsetHeight - el.clientHeight;
                          el.style.height = `${Math.max(el.scrollHeight + borderOffset, currentMin)}px`;
                        }
                      }}
                      onFocus={(e) =>
                        recordCursorPosition(e.currentTarget, 'plural', { quantity: pi.quantity })
                      }
                      onBlur={(e) =>
                        handleTextareaBlur(e.currentTarget, 'plural', { quantity: pi.quantity })
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
                        applyAutoClose(e.currentTarget, pi.target, `plural:${pi.quantity}`, (v) => handlePluralQuantityChange(pi.quantity, v));
                      }}
                      placeholder={
                        isAr
                          ? `ترجمة صيغة ${pi.quantity} (${pluralLabels[pi.quantity] || pi.quantity})...`
                          : `Translate ${pi.quantity} form (${pluralLabels[pi.quantity] || pi.quantity})...`
                      }
                      containerClassName="rounded-lg bg-slate-100/90 dark:bg-[#0E121A] border border-slate-200/90 dark:border-transparent"
                      backdropClassName="border-0 border-b-2 border-transparent px-3.5 pt-1.5 pb-3 text-xs sm:text-sm leading-relaxed"
                      className="px-3.5 pt-1.5 pb-3 text-xs sm:text-sm leading-relaxed rounded-lg border-0 border-b-2 border-[#16695E] focus:border-[#1EB996] text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none transition resize-none overflow-hidden block"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Array Support (if array string) with Visual Typing Mistake Indicator */}
            {draftItem.type === 'array' && (
              <div className="space-y-2">
                {draftItem.items.map((ai) => (
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
                    <HighlightedTextarea
                      rows={1}
                      dir={direction}
                      value={ai.target}
                      ghostText={predict.ghostFor(`array:${ai.index}`, ai.target)}
                      resetKey={`${draftItem.id}-${ai.index}`}
                      onValueChange={(val) => {
                        handleArrayItemChange(ai.index, val);
                      }}
                      ref={(el) => {
                        arrayTextareaRefs.current[ai.index] = el;
                        if (el) {
                          const currentMin = parseFloat(el.style.minHeight) || 0;
                          el.style.height = 'auto';
                          const borderOffset = el.offsetHeight - el.clientHeight;
                          el.style.height = `${Math.max(el.scrollHeight + borderOffset, currentMin)}px`;
                        }
                      }}
                      onFocus={(e) =>
                        recordCursorPosition(e.currentTarget, 'array', { index: ai.index })
                      }
                      onBlur={(e) =>
                        handleTextareaBlur(e.currentTarget, 'array', { index: ai.index })
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
                        applyAutoClose(e.currentTarget, ai.target, `array:${ai.index}`, (v) => handleArrayItemChange(ai.index, v));
                      }}
                      placeholder={
                        isAr ? `ترجمة العنصر ${ai.index}...` : `Translate item ${ai.index}...`
                      }
                      containerClassName="rounded-lg bg-slate-100/90 dark:bg-[#0E121A] border border-slate-200/90 dark:border-transparent"
                      backdropClassName="border-0 border-b-2 border-transparent px-3.5 pt-1.5 pb-3 text-xs sm:text-sm leading-relaxed"
                      className="px-3.5 pt-1.5 pb-3 text-xs sm:text-sm leading-relaxed rounded-lg border-0 border-b-2 border-[#16695E] focus:border-[#1EB996] text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none transition resize-none overflow-hidden block"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Below-Textarea Status Bar */}
            <div className="flex items-center justify-between gap-2 pt-0.5 text-xs flex-wrap">
              {/* Left: LTR / RTL Pill Switcher & Copy/Paste Buttons */}
              <div className="flex items-center gap-1.5">
                <div className="flex items-center bg-slate-100 dark:bg-[#171D27] border border-slate-200/80 dark:border-transparent rounded-lg p-0.5 select-none">
                  {/* LTR Button */}
                  <button
                    type="button"
                    onClick={() => setDirection('ltr')}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition ${
                      direction === 'ltr'
                        ? 'bg-white dark:bg-[#1C2534] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <span>LTR</span>
                    <span
                      className={`w-3 h-3 rounded-full border flex items-center justify-center ${
                        direction === 'ltr'
                          ? 'border-[#1EB996] bg-[#1EB996]/20'
                          : 'border-slate-400 dark:border-slate-500'
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
                        ? 'bg-white dark:bg-[#1C2534] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <span>RTL</span>
                    <span
                      className={`w-3 h-3 rounded-full border flex items-center justify-center ${
                        direction === 'rtl'
                          ? 'border-[#1EB996] bg-[#1EB996]/20'
                          : 'border-slate-400 dark:border-slate-500'
                      }`}
                    >
                      {direction === 'rtl' && <span className="w-1 h-1 rounded-full bg-[#1EB996]" />}
                    </span>
                  </button>
                </div>

                {/* Copy & Paste Icon Buttons */}
                <button
                  id="copy-target-text-btn"
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleCopyTarget}
                  title={isAr ? 'نسخ نص الترجمة' : 'Copy translation text'}
                  aria-label={isAr ? 'نسخ نص الترجمة' : 'Copy translation text'}
                  className="p-1.5 rounded-lg hover:bg-slate-200/90 dark:hover:bg-[#202A3A] active:bg-slate-300 dark:active:bg-[#263246] text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition cursor-pointer flex items-center justify-center focus:outline-none"
                >
                  {copiedTarget ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>

                <button
                  id="paste-target-text-btn"
                  type="button"
                  onPointerDown={() => {
                    isInteractingWithToolbarOrPasteRef.current = true;
                  }}
                  onTouchStart={() => {
                    isInteractingWithToolbarOrPasteRef.current = true;
                  }}
                  onMouseDown={(e) => {
                    isInteractingWithToolbarOrPasteRef.current = true;
                    e.preventDefault();
                  }}
                  onClick={() => {
                    void handlePasteTarget();
                  }}
                  title={isAr ? 'لصق من الحافظة' : 'Paste from clipboard'}
                  aria-label={isAr ? 'لصق من الحافظة' : 'Paste from clipboard'}
                  className="p-1.5 rounded-lg hover:bg-slate-200/90 dark:hover:bg-[#202A3A] active:bg-slate-300 dark:active:bg-[#263246] text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition cursor-pointer flex items-center justify-center focus:outline-none"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Far Right: Bigger Undo / Redo Buttons */}
              {onUndo && onRedo && (
                <div className="inline-flex items-center bg-slate-100 dark:bg-[#171D27] border border-slate-200/80 dark:border-transparent rounded-xl p-1 select-none gap-0.5 ms-auto">
                  <button
                    id="editor-undo-btn"
                    type="button"
                    onClick={handleEditorUndo}
                    disabled={!effectiveCanUndo}
                    className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#202A3A] disabled:opacity-35 disabled:pointer-events-none transition cursor-pointer"
                    title={
                      isAr
                        ? `تراجع عن التعديل (Ctrl+Z)${effectiveUndoCount > 0 ? ` — ${effectiveUndoCount}` : ''}`
                        : `Undo edit (Ctrl+Z)${effectiveUndoCount > 0 ? ` — ${effectiveUndoCount}` : ''}`
                    }
                    aria-label="Undo"
                  >
                    <Undo2 className="w-4 h-4 text-[#1EB996] rtl:-scale-x-100" />
                  </button>
                  <div className="w-px h-4 bg-slate-300 dark:bg-[#2B3544]" />
                  <button
                    id="editor-redo-btn"
                    type="button"
                    onClick={handleEditorRedo}
                    disabled={!effectiveCanRedo}
                    className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#202A3A] disabled:opacity-35 disabled:pointer-events-none transition cursor-pointer"
                    title={
                      isAr
                        ? `إعادة التعديل (Ctrl+Y)${effectiveRedoCount > 0 ? ` — ${effectiveRedoCount}` : ''}`
                        : `Redo edit (Ctrl+Y)${effectiveRedoCount > 0 ? ` — ${effectiveRedoCount}` : ''}`
                    }
                    aria-label="Redo"
                  >
                    <Redo2 className="w-4 h-4 text-[#1EB996] rtl:-scale-x-100" />
                  </button>
                </div>
              )}
            </div>
            </>)}
          </div>

          {slot('r2', 'rounded-2xl overflow-hidden bg-white dark:bg-[#151922] border border-slate-200/80 dark:border-transparent', <>
          {saveGuard && (autoCorrect || saveGuard.empty) && (
            <div
              role="alert"
              className="mx-3 sm:mx-4 mb-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200 space-y-1"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="font-semibold">
                  {saveGuard.empty
                    ? isAr
                      ? 'لم يُحفظ شيء: لم تكتب أي ترجمة بعد.'
                      : 'Nothing saved: no translation has been typed yet.'
                    : saveGuard.notes.length > 0
                    ? isAr
                      ? 'لم يُحفظ النص. صحّحتُ الترجمة تلقائياً، راجعها ثم اضغط حفظ مرة أخرى:'
                      : 'Not saved. The translation was corrected automatically, review it and press Save again:'
                    : isAr
                      ? 'لم يُحفظ النص. توجد أخطاء لم أستطع إصلاحها، اضغط حفظ مرة أخرى لتجاهلها:'
                      : 'Not saved. Some errors could not be fixed automatically, press Save again to ignore them:'}
                </span>
              </div>
              {saveGuard.notes.length > 0 && (
                <ul className="list-disc ps-8 space-y-0.5">
                  {saveGuard.notes.map((n, i) => (
                    <li key={i} dir="auto">{isAr ? n.ar : n.en}</li>
                  ))}
                </ul>
              )}
              {saveGuard.remaining.length > 0 && (
                <ul className="list-disc ps-8 space-y-0.5 text-rose-700 dark:text-rose-300">
                  {saveGuard.remaining.map((i) => (
                    <li key={i.id} dir="auto">{isAr ? i.messageAr : i.messageEn}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <EditorActionButtons
            compact={!!bottomPortal}
            isAr={isAr}
            isSuggesting={isSuggesting}
            showSavedFeedback={showSavedFeedback}
            targetLang={targetLang}
            targetLocaleName={targetLocaleName}
            onClear={handleClearText}
            onSkip={() => discardDraftAndNavigate(onNavigateNext)}
            onSaveAndContinue={handleSaveAndContinue}
            onSaveWithoutContinuing={handleSaveWithoutContinuing}
            onSuggest={handleSuggest}
            onOpenLanguageModal={() => setShowLangModal(true)}
          />
          </>)}
        </div>

        {slot('r3', '', <EditorNavFooter
          isAr={isAr}
          currentIndex={currentIndex}
          totalCount={totalCount}
          onPrevious={() => discardDraftAndNavigate(onNavigatePrevious)}
          onNext={() => discardDraftAndNavigate(onNavigateNext)}
          onNextUntranslated={() => discardDraftAndNavigate(onNavigateNextUntranslated)}
        />)}
      </div>

      {/* Target Language Selection Dialog */}
      <LanguageSelectorModal
        isOpen={showLangModal}
        onClose={() => setShowLangModal(false)}
        currentLang={targetLang}
        onSelectLanguage={(selected) => {
          onLanguageChange?.(selected.code);
        }}
        appLang={appLang}
      />
    </div>
  );
};
