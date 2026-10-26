import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface EditorNavFooterProps {
  isAr: boolean;
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onNextUntranslated: () => void;
}

export const EditorNavFooter: React.FC<EditorNavFooterProps> = ({
  isAr,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onNextUntranslated,
}) => {
  return (
    <div className="flex items-center justify-between text-[11px] text-slate-400 px-2 py-0.5">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPrevious()}
          disabled={currentIndex === 0}
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full hover:bg-slate-800/60 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
        >
          <ChevronLeft className="w-3 h-3 rtl:rotate-180" />
          <span>{isAr ? 'السابق' : 'Previous'}</span>
        </button>
        <button
          onClick={() => onNext()}
          disabled={currentIndex === totalCount - 1}
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full hover:bg-slate-800/60 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
        >
          <span>{isAr ? 'التالي' : 'Next'}</span>
          <ChevronRight className="w-3 h-3 rtl:rotate-180" />
        </button>
      </div>

      <div className="font-mono text-slate-400 tabular-nums">
        {currentIndex + 1} / {totalCount}
      </div>

      <button
        onClick={onNextUntranslated}
        className="text-[#1EB996] hover:underline cursor-pointer"
      >
        {isAr ? 'التالي غير المترجم' : 'Next Untranslated'}
      </button>
    </div>
  );
};
