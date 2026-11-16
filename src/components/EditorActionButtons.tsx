/* eslint-disable react-hooks/refs -- the resize handlers come from useResizablePair, which only touches its gesture
   bookkeeping inside pointer events and callback refs, never while rendering. */
import React from 'react';
import { getArabicLanguageName, getLanguageOption } from '../utils/languages';
import { CheckCircle2, Globe, Sparkles, Trash2 } from 'lucide-react';
import { useResizablePair } from '../hooks/useResizablePair';
import { useColumnSwap } from '../hooks/useColumnSwap';
import { useT } from '../i18n/i18n';

// Held-and-dragged buttons: lifted look, and no text selection / context menu / page panning while resizing
const RESIZE_STYLE: React.CSSProperties = {
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
};
const ACTIVE_CLASS = 'ring-2 ring-white/50 brightness-110 scale-[1.03] z-10';

type IconContent = 'trash' | 'globe';
type TextContent = 'skip' | 'suggest';
type MainContent = 'continue' | 'stay';
type SwapPosition = 'top' | 'bottom';

/** The pointer handlers of a resize-pair hook ("row1h"/"row2h") for one of its three slots. */
interface RowSlotHandlers {
  onDown: (side: 'A' | 'B' | 'I', e: React.PointerEvent<HTMLButtonElement>) => void;
  onMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onClickCapture: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/** Merges a column-swap gesture (vertical, swaps this button with its neighbour) with a resize gesture (horizontal,
 *  trades width with the neighbour in the same row) on the same button. */
function mergeSwapAndResize(
  swap: ReturnType<typeof useColumnSwap>,
  position: SwapPosition,
  side: 'A' | 'B' | 'I',
  rowh: RowSlotHandlers
) {
  const b = swap.bind(position);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      b.onPointerDown(e);
      rowh.onDown(side, e);
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      b.onPointerMove(e);
      rowh.onMove(e);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      b.onPointerUp(e);
      rowh.onUp(e);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      b.onPointerCancel(e);
      rowh.onUp(e);
    },
    onClickCapture: (e: React.MouseEvent<HTMLButtonElement>) => {
      b.onClickCapture(e);
      rowh.onClickCapture(e);
    },
    className: b.className,
  };
}

interface EditorActionButtonsProps {
  isAr: boolean;
  isSuggesting: boolean;
  showSavedFeedback: boolean;
  targetLang: string;
  targetLocaleName?: string;
  onClear: () => void;
  onSkip: () => void;
  onSaveAndContinue: () => void;
  onSaveWithoutContinuing: () => void;
  onSuggest: () => void;
  onOpenLanguageModal: () => void;
  compact?: boolean;
}

export const EditorActionButtons: React.FC<EditorActionButtonsProps> = ({
  isAr,
  isSuggesting,
  showSavedFeedback,
  targetLang,
  targetLocaleName,
  onClear,
  onSkip,
  onSaveAndContinue,
  onSaveWithoutContinuing,
  onSuggest,
  onOpenLanguageModal,
  compact = false,
}) => {
  const { t, tb } = useT();
  // Press-and-hold + drag swaps a button with its vertical neighbour (top <-> bottom). Each column (the round icon,
  // the text button next to it, and the big pill on the right) remembers its own swap independently.
  const iconSwap = useColumnSwap('editor_buttons_icon_swap_v1');
  const textSwap = useColumnSwap('editor_buttons_text_swap_v1');
  const mainSwap = useColumnSwap('editor_buttons_main_swap_v1');

  // Row 1 is always the physical top row, row 2 the physical bottom row; swapping only changes which content (and
  // which swap-column "position") renders in each.
  const row1IconContent: IconContent = iconSwap.swapped ? 'globe' : 'trash';
  const row2IconContent: IconContent = iconSwap.swapped ? 'trash' : 'globe';
  const row1TextContent: TextContent = textSwap.swapped ? 'suggest' : 'skip';
  const row2TextContent: TextContent = textSwap.swapped ? 'skip' : 'suggest';
  const row1MainContent: MainContent = mainSwap.swapped ? 'stay' : 'continue';
  const row2MainContent: MainContent = mainSwap.swapped ? 'continue' : 'stay';

  // The remembered width split is keyed by which content currently occupies the row, not by the row itself: when a
  // button is dragged into a new row, the row resizes (animated, via gridStyle's own transition) to whatever width
  // that content last had there, instead of keeping the previous occupant's width.
  const [row1, row1h] = useResizablePair(
    `editor_buttons_pair_${row1IconContent}_${row1TextContent}_${row1MainContent}_v1`
  );
  const [row2, row2h] = useResizablePair(
    `editor_buttons_pair_${row2IconContent}_${row2TextContent}_${row2MainContent}_v1`
  );

  const c = compact
    ? { sq: 'w-[calc(2rem_+_var(--ex,0px))] h-8', h: 'h-8' }
    : { sq: 'w-[calc(2.375rem_+_var(--ex,0px))] sm:w-[calc(2.5rem_+_var(--ex,0px))] h-9.5 sm:h-10', h: 'h-9.5 sm:h-10' };

  const renderIconButton = (
    content: IconContent,
    swapPosition: SwapPosition,
    rowh: RowSlotHandlers,
    setRef: (el: HTMLButtonElement | null) => void,
    iconExtra: number,
    activeSide: 'A' | 'B' | 'I' | null
  ) => {
    const gesture = mergeSwapAndResize(iconSwap, swapPosition, 'I', rowh);
    if (content === 'trash') {
      return (
        <button
          id="weblate-quick-delete-btn"
          type="button"
          ref={setRef}
          {...gesture}
          onContextMenu={(e) => e.preventDefault()}
          style={{ ...RESIZE_STYLE, ['--ex' as string]: `${iconExtra}px` }}
          onClick={onClear}
          title={t('clear_translation_field')}
          className={`${c.sq} rounded-full bg-slate-100 hover:bg-rose-100 active:bg-rose-200 dark:bg-[#1C2330] dark:hover:bg-rose-950/40 dark:active:bg-rose-900/60 border border-slate-300 hover:border-rose-300 dark:border-[#2B3545] dark:hover:border-rose-800/60 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 flex items-center justify-center shrink-0 max-w-[45%] transition-colors cursor-pointer shadow-xs group ${activeSide === 'I' ? ACTIVE_CLASS : ''} ${gesture.className}`}
        >
          <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
        </button>
      );
    }
    return (
      <button
        id="editor-switch-lang-btn"
        type="button"
        ref={setRef}
        {...gesture}
        onContextMenu={(e) => e.preventDefault()}
        style={{ ...RESIZE_STYLE, ['--ex' as string]: `${iconExtra}px` }}
        onClick={onOpenLanguageModal}
        title={
          isAr
            ? `تغيير لغة الترجمة المستهدفة (${getArabicLanguageName(targetLang, targetLocaleName)} / values-${targetLang})`
            : `Switch target language (${getLanguageOption(targetLang).name} / values-${targetLang})`
        }
        className={`${c.sq} rounded-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 dark:bg-[#1C2330] dark:hover:bg-[#252E3E] dark:active:bg-[#2C374A] border border-slate-300 dark:border-[#2B3545] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center shrink-0 max-w-[45%] transition-colors cursor-pointer shadow-xs group ${activeSide === 'I' ? ACTIVE_CLASS : ''} ${gesture.className}`}
      >
        <Globe className="w-4 h-4 group-hover:rotate-12 transition-transform" />
      </button>
    );
  };

  const renderTextButton = (
    content: TextContent,
    swapPosition: SwapPosition,
    rowh: RowSlotHandlers,
    setRef: (el: HTMLButtonElement | null) => void,
    activeSide: 'A' | 'B' | 'I' | null
  ) => {
    const gesture = mergeSwapAndResize(textSwap, swapPosition, 'A', rowh);
    if (content === 'skip') {
      return (
        <button
          id="weblate-skip-btn"
          ref={setRef}
          type="button"
          {...gesture}
          onContextMenu={(e) => e.preventDefault()}
          style={RESIZE_STYLE}
          onClick={onSkip}
          title={t('skip_to_next_string')}
          className={`flex-1 min-w-0 ${c.h} rounded-full bg-[#185F54] hover:bg-[#1C6F63] active:bg-[#144F46] text-white font-medium text-xs sm:text-sm flex items-center justify-center transition cursor-pointer shadow-xs overflow-hidden ${activeSide === 'A' ? ACTIVE_CLASS : ''} ${gesture.className}`}
        >
          <span data-i18n className="whitespace-nowrap">{tb('skip')}</span>
        </button>
      );
    }
    return (
      <button
        id="weblate-suggest-btn"
        ref={setRef}
        type="button"
        {...gesture}
        onContextMenu={(e) => e.preventDefault()}
        style={RESIZE_STYLE}
        onClick={onSuggest}
        disabled={isSuggesting}
        className={`flex-1 min-w-0 ${c.h} rounded-full bg-slate-200 hover:bg-slate-300 active:bg-slate-400 dark:bg-[#262E3B] dark:hover:bg-[#323D4E] dark:active:bg-[#1E2530] text-slate-800 dark:text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50 overflow-hidden ${activeSide === 'A' ? ACTIVE_CLASS : ''} ${gesture.className}`}
      >
        <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="whitespace-nowrap">{isSuggesting ? t('suggesting') : t('suggest')}</span>
      </button>
    );
  };

  const renderMainButton = (
    content: MainContent,
    swapPosition: SwapPosition,
    rowh: RowSlotHandlers,
    setRef: (el: HTMLButtonElement | null) => void,
    activeSide: 'A' | 'B' | 'I' | null
  ) => {
    const gesture = mergeSwapAndResize(mainSwap, swapPosition, 'B', rowh);
    if (content === 'continue') {
      return (
        <button
          id="weblate-save-continue-btn"
          ref={setRef}
          type="button"
          {...gesture}
          onContextMenu={(e) => e.preventDefault()}
          style={RESIZE_STYLE}
          onClick={onSaveAndContinue}
          className={`w-full ${c.h} rounded-full bg-[#1EB996] hover:bg-[#19A585] active:bg-[#158C71] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm overflow-hidden ${activeSide === 'B' ? ACTIVE_CLASS : ''} ${gesture.className}`}
        >
          <span data-i18n className="whitespace-nowrap">{tb('save_continue')}</span>
        </button>
      );
    }
    return (
      <button
        id="weblate-save-stay-btn"
        ref={setRef}
        type="button"
        {...gesture}
        onContextMenu={(e) => e.preventDefault()}
        style={RESIZE_STYLE}
        onClick={onSaveWithoutContinuing}
        className={`w-full ${c.h} rounded-full bg-[#185F54] hover:bg-[#1C6F63] active:bg-[#144F46] text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer relative overflow-hidden ${activeSide === 'B' ? ACTIVE_CLASS : ''} ${gesture.className}`}
      >
        {showSavedFeedback ? (
          <span className="flex items-center gap-1.5 text-emerald-300 whitespace-nowrap">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span data-i18n>{t('saved')}</span>
          </span>
        ) : (
          <span data-i18n className="whitespace-nowrap">{t('save_stay')}</span>
        )}
      </button>
    );
  };

  return (
    <div className={`${compact ? 'px-2 py-1.5' : 'px-3 sm:px-4 py-2.5 sm:py-3'} bg-slate-50 dark:bg-[#131720] border-t border-slate-200 dark:border-[#232936] ${compact ? 'space-y-1.5' : 'space-y-2'}`}>
      {/* Row 1 (physical top) */}
      <div ref={row1h.setGrid} style={row1.gridStyle} className="grid gap-2 sm:gap-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {renderIconButton(row1IconContent, 'top', row1h, row1h.setIcon, row1.iconExtra, row1.activeSide)}
          {renderTextButton(row1TextContent, 'top', row1h, row1h.setBtnA, row1.activeSide)}
        </div>
        {renderMainButton(row1MainContent, 'top', row1h, row1h.setBtnB, row1.activeSide)}
      </div>

      {/* Row 2 (physical bottom) */}
      <div ref={row2h.setGrid} style={row2.gridStyle} className="grid gap-2 sm:gap-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {renderIconButton(row2IconContent, 'bottom', row2h, row2h.setIcon, row2.iconExtra, row2.activeSide)}
          {renderTextButton(row2TextContent, 'bottom', row2h, row2h.setBtnA, row2.activeSide)}
        </div>
        {renderMainButton(row2MainContent, 'bottom', row2h, row2h.setBtnB, row2.activeSide)}
      </div>
    </div>
  );
};
