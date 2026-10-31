import React from 'react';
import { getArabicLanguageName, getLanguageOption } from '../utils/languages';
import { CheckCircle2, Globe, Sparkles, Trash2 } from 'lucide-react';

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
  const c = compact
    ? { sq: 'w-8 h-8', h: 'h-8' }
    : { sq: 'w-9.5 sm:w-10 h-9.5 sm:h-10', h: 'h-9.5 sm:h-10' };
  return (
    <div className={`${compact ? 'px-2 py-1.5' : 'px-3 sm:px-4 py-2.5 sm:py-3'} bg-slate-50 dark:bg-[#131720] border-t border-slate-200 dark:border-[#232936] ${compact ? 'space-y-1.5' : 'space-y-2'}`}>
      {/* Row 1: Quick delete & Skip button on left, "حفظ ومتابعة" on right */}
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
        {/* Left: Quick Delete Icon Button on far left + Skip Button */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Quick Delete / Clear Icon Button */}
          <button
            id="weblate-quick-delete-btn"
            type="button"
            onClick={onClear}
            title={isAr ? 'مسح حقل الترجمة' : 'Clear translation field'}
            className={`${c.sq} rounded-full bg-slate-100 hover:bg-rose-100 active:bg-rose-200 dark:bg-[#1C2330] dark:hover:bg-rose-950/40 dark:active:bg-rose-900/60 border border-slate-300 hover:border-rose-300 dark:border-[#2B3545] dark:hover:border-rose-800/60 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 flex items-center justify-center shrink-0 transition cursor-pointer shadow-xs group`}
          >
            <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
          </button>

          {/* Skip Button (in place of Tools button, without icon) */}
          <button
            id="weblate-skip-btn"
            type="button"
            onClick={onSkip}
            title={isAr ? 'تخطّي إلى السلسلة التالية' : 'Skip to next string'}
            className={`flex-1 min-w-0 ${c.h} rounded-full bg-[#185F54] hover:bg-[#1C6F63] active:bg-[#144F46] text-white font-medium text-xs sm:text-sm flex items-center justify-center transition cursor-pointer shadow-xs`}
          >
            <span>{isAr ? 'تخطّي' : 'Skip'}</span>
          </button>
        </div>

        {/* Right: "حفظ ومتابعة" (Primary Bright Teal Pill) */}
        <button
          id="weblate-save-continue-btn"
          type="button"
          onClick={onSaveAndContinue}
          className={`w-full ${c.h} rounded-full bg-[#1EB996] hover:bg-[#19A585] active:bg-[#158C71] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm`}
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
            onClick={onOpenLanguageModal}
            title={
              isAr
                ? `تغيير لغة الترجمة المستهدفة (${getArabicLanguageName(targetLang, targetLocaleName)} / values-${targetLang})`
                : `Switch target language (${getLanguageOption(targetLang).name} / values-${targetLang})`
            }
            className={`${c.sq} rounded-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 dark:bg-[#1C2330] dark:hover:bg-[#252E3E] dark:active:bg-[#2C374A] border border-slate-300 dark:border-[#2B3545] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center shrink-0 transition cursor-pointer shadow-xs group`}
          >
            <Globe className="w-4 h-4 group-hover:rotate-12 transition-transform" />
          </button>

          <button
            id="weblate-suggest-btn"
            type="button"
            onClick={onSuggest}
            disabled={isSuggesting}
            className={`flex-1 min-w-0 ${c.h} rounded-full bg-slate-200 hover:bg-slate-300 active:bg-slate-400 dark:bg-[#262E3B] dark:hover:bg-[#323D4E] dark:active:bg-[#1E2530] text-slate-800 dark:text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50`}
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
          onClick={onSaveWithoutContinuing}
          className={`w-full ${c.h} rounded-full bg-[#185F54] hover:bg-[#1C6F63] active:bg-[#144F46] text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer relative`}
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
  );
};
