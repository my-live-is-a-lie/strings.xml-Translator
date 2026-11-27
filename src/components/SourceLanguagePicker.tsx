import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useT } from '../i18n/i18n';
import { SOURCE_LANGUAGES, normalizeSourceLang } from '../shared/sourceLang';

interface SourceLanguagePickerProps {
  sourceLang?: string;
  status?: 'detected' | 'unsure';
  isAr: boolean;
  onChange?: (code: string) => void;
}

/** The language name that sits on each string card; tap it to change the project's source language. */
export const SourceLanguagePicker: React.FC<SourceLanguagePickerProps> = ({ sourceLang, status, isAr, onChange }) => {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const code = normalizeSourceLang(sourceLang);
  const nameOf = (c: string) => {
    const l = SOURCE_LANGUAGES.find((x) => x.code === c) || SOURCE_LANGUAGES[0];
    return isAr ? l.nameAr : l.name;
  };

  // Close on a real tap outside (click never fires after a drag).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDown, true);
    return () => document.removeEventListener('click', onDown, true);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0 flex flex-col items-end" onClick={(e) => e.stopPropagation()}>
      <button
        id="source-lang-select"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('source_language')}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-slate-600 dark:text-slate-300 text-xs sm:text-sm font-medium"
      >
        <span>{nameOf(code)}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-slate-500 dark:text-slate-400" />
      </button>
      {status && (
        <span
          id="source-lang-note"
          className={`text-[10px] ${status === 'unsure' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}
        >
          {status === 'unsure' ? t('source_unsure') : t('source_detected')}
        </span>
      )}
      {open && (
        <ul
          role="listbox"
          id="source-lang-list"
          className="absolute end-0 top-full z-50 mt-1 min-w-[9rem] max-h-64 overflow-y-auto overscroll-contain touch-pan-y rounded-lg border border-slate-300 dark:border-[#2E384D] bg-white dark:bg-[#1B212E] shadow-xl py-1"
        >
          {SOURCE_LANGUAGES.map((l) => (
            <li key={l.code} role="option" aria-selected={l.code === code}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (l.code !== code) onChange?.(l.code);
                }}
                className={`w-full px-2 py-1.5 text-start text-[11px] flex items-center justify-between gap-2 whitespace-nowrap hover:bg-slate-100 dark:hover:bg-[#262E3F] ${
                  l.code === code ? 'text-[#1EB996] font-semibold' : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                <span>{nameOf(l.code)}</span>
                {l.code === code && <Check className="w-3 h-3 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
