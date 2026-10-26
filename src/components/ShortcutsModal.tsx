import React from 'react';
import { Keyboard, X } from 'lucide-react';
import { useDialog } from '../utils/useDialog';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appLang?: 'ar' | 'en';
}

const SHORTCUTS: Array<{ keys: string[]; en: string; ar: string }> = [
  { keys: ['Ctrl', 'Enter'], en: 'Save and go to the next string', ar: 'حفظ والانتقال للنص التالي' },
  { keys: ['Alt', '→ / ←'], en: 'Next / previous string (follows the page direction)', ar: 'النص التالي / السابق (حسب اتجاه الصفحة)' },
  { keys: ['Ctrl', 'J'], en: 'Jump to the next untranslated string', ar: 'الانتقال لأقرب نص غير مترجم' },
  { keys: ['Alt', 'U'], en: 'Jump to the next untranslated string', ar: 'الانتقال لأقرب نص غير مترجم' },
  { keys: ['Ctrl', 'Z'], en: 'Undo', ar: 'تراجع' },
  { keys: ['Ctrl', 'Y'], en: 'Redo (also Ctrl+Shift+Z)', ar: 'إعادة (أو Ctrl+Shift+Z)' },
  { keys: ['?'], en: 'Show this list', ar: 'عرض هذه القائمة' },
  { keys: ['Esc'], en: 'Close the open dialog', ar: 'إغلاق النافذة المفتوحة' },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose, appLang = 'ar' }) => {
  const isAr = appLang === 'ar';
  const dialogRef = useDialog(isOpen, onClose);
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white dark:bg-[#1E1F20] border border-slate-200/80 dark:border-slate-800/80 m3-elevation-3 p-6 outline-none"
      >
        <div className="flex items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-5 h-5 text-[#1EB996]" aria-hidden="true" />
            <h2 id="shortcuts-title" className="text-base font-semibold text-slate-900 dark:text-white">
              {isAr ? 'اختصارات لوحة المفاتيح' : 'Keyboard shortcuts'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isAr ? 'إغلاق' : 'Close'}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {SHORTCUTS.map((s) => (
            <li key={s.keys.join('+') + s.en} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <span className="text-slate-700 dark:text-slate-200">{isAr ? s.ar : s.en}</span>
              <span className="flex items-center gap-1 shrink-0" dir="ltr">
                {s.keys.map((k, i) => (
                  <React.Fragment key={k}>
                    {i > 0 && <span className="text-slate-400 text-xs">+</span>}
                    <kbd className="px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-xs font-mono text-slate-700 dark:text-slate-200">
                      {k}
                    </kbd>
                  </React.Fragment>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
