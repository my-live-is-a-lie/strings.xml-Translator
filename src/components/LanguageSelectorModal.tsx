import { useDialog } from '../utils/useDialog';
import React, { useState, useMemo, useRef } from 'react';
import { X, Search, Check, Plus, Pencil, Trash2 } from 'lucide-react';
import {
  SUPPORTED_LANGUAGES, LanguageOption, getArabicLanguageName,
  getCustomTargetLocales, saveCustomTargetLocales, normalizeLocaleCode,
} from '../utils/languages';
import { useT } from '../i18n/i18n';

interface LanguageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLang: string;
  onSelectLanguage: (lang: LanguageOption) => void;
  appLang?: 'ar' | 'en';
}

export const LanguageSelectorModal: React.FC<LanguageSelectorModalProps> = ({
  isOpen, onClose, currentLang, onSelectLanguage, appLang = 'ar',
}) => {
  const { t } = useT();
  const isAr = appLang === 'ar';
  const dialogRef = useDialog(isOpen, onClose);
  const codeRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [customCode, setCustomCode] = useState('');
  const [customName, setCustomName] = useState('');
  const [customLanguages, setCustomLanguages] = useState(getCustomTargetLocales);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [error, setError] = useState('');

  const filteredLanguages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...customLanguages, ...SUPPORTED_LANGUAGES].filter((l) =>
      !q || [l.name, l.nativeName, getArabicLanguageName(l.code, l.name), l.code, l.androidDir]
        .some((value) => value.toLowerCase().includes(q)));
  }, [search, customLanguages]);

  if (!isOpen) return null;

  const handleSelect = (lang: LanguageOption) => {
    onSelectLanguage(lang);
    onClose();
  };
  const resetForm = () => {
    setCustomCode(''); setCustomName(''); setEditingCode(null); setError('');
  };
  const persist = (languages: LanguageOption[]) => {
    saveCustomTargetLocales(languages);
    setCustomLanguages(languages);
  };
  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeLocaleCode(customCode);
    const name = customName.trim();
    if (!code) {
      setError(isAr ? 'أدخل رمز لغة صالحًا، مثل es-rMX أو b+sr+Latn.' : 'Enter a valid locale code, e.g. es-rMX or b+sr+Latn.');
      return;
    }
    if (!name) return;
    if ([...SUPPORTED_LANGUAGES, ...customLanguages].some((l) =>
      l.code.toLowerCase() === code.toLowerCase() && l.code !== editingCode)) {
      setError(isAr ? 'رمز اللغة موجود بالفعل في القائمة.' : 'This language code is already in the list.');
      return;
    }
    const option: LanguageOption = {
      code, name, nativeName: name, androidDir: `values-${code}`,
      isRtl: /^(ar|fa|he|ur)(?:-|$)|^b\+(ar|fa|he|ur)(?:\+|$)/i.test(code),
    };
    persist(editingCode ? customLanguages.map((l) => l.code === editingCode ? option : l) : [...customLanguages, option]);
    const wasEditing = !!editingCode;
    resetForm();
    setSearch('');
    if (!wasEditing) handleSelect(option);
  };
  const inputClass = 'min-w-0 w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-[#1A202C] border border-slate-200 dark:border-[#2D384C] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#1EB996]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="language-modal-title" tabIndex={-1} className="outline-none w-full max-w-xl bg-white dark:bg-[#161A23] rounded-3xl border border-slate-200 dark:border-[#283244] shadow-2xl overflow-hidden flex flex-col my-4 max-h-[88dvh]">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-[#242D3D] flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 data-i18n id="language-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">{t('switch_target_language_2')}</h2>
            <p data-i18n className="text-xs text-slate-600 dark:text-slate-400">{t('select_an_android_locale_to')}</p>
          </div>
          <button type="button" aria-label={t('close')} onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-[#202736] cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 pb-3 border-b border-slate-100 dark:border-[#242D3D] shrink-0">
          <div className="flex items-center bg-slate-100 dark:bg-[#121620] rounded-2xl focus-within:rounded-md transition-[border-radius] px-3.5 py-2 ring-1 ring-slate-200/80 dark:ring-[#2A3448] focus-within:ring-2 focus-within:ring-[#1EB996]">
            {searchFocused || search ? (
              <button
                type="button"
                aria-label={search ? (isAr ? 'مسح النص' : 'Clear search') : (isAr ? 'إغلاق البحث' : 'Close search')}
                // keep the field focused while the button is pressed
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { if (search) { setSearch(''); searchRef.current?.focus(); } else { onClose(); } }}
                className="me-2 shrink-0 -ms-1 p-0.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              ><X className="w-4 h-4" /></button>
            ) : (
              <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => searchRef.current?.focus()} className="me-2 shrink-0 -ms-1 p-0.5 text-slate-400 cursor-pointer"><Search className="w-4 h-4" /></button>
            )}
            <input ref={searchRef} type="search" aria-label={t('search_by_language_name_or')} placeholder={t('search_by_language_name_or')} value={search} onChange={(e) => setSearch(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} className="min-w-0 w-full text-xs bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none [&::-webkit-search-cancel-button]:appearance-none" />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
          {filteredLanguages.length === 0 && <div className="py-8 text-center text-xs text-slate-400">{t('no_matching_languages_found_you')}</div>}
          {filteredLanguages.map((lang) => {
            const isSelected = currentLang.toLowerCase() === lang.code.toLowerCase();
            const isCustom = customLanguages.some((l) => l.code === lang.code);
            return (
              <div key={lang.code} data-locale={lang.code} className={`rounded-2xl border ${isSelected ? 'bg-slate-100 text-slate-900 border-transparent dark:bg-[#1B222C] dark:text-white dark:border-transparent' : 'border-transparent text-slate-800 dark:text-slate-200'}`}>
                <div className="flex items-center gap-1 pe-2">
                  <button type="button" onClick={() => handleSelect(lang)} aria-pressed={isSelected} className="flex-1 min-w-0 text-start px-3.5 py-2.5 rounded-2xl hover:bg-slate-100/60 dark:hover:bg-white/5 transition cursor-pointer flex items-center justify-between gap-3">
                    <span className="min-w-0 block">
                      <span dir="auto" className="block text-xs sm:text-sm font-semibold truncate">{lang.name}</span>
                      <span dir="auto" className="block text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{isCustom ? (isAr ? 'لغة مخصصة' : 'Custom language') : lang.nativeName}</span>
                    </span>
                  </button>
                  {isCustom && <div className="flex items-center shrink-0">
                    <button type="button" aria-label={`${isAr ? 'تعديل' : 'Edit'} ${lang.name}`} title={isAr ? 'تعديل اللغة' : 'Edit language'} onClick={() => { setEditingCode(lang.code); setCustomCode(lang.code); setCustomName(lang.name); setError(''); setDeletingCode(null); codeRef.current?.focus(); }} className="p-2.5 rounded-full text-[#1EB996] bg-[#1EB996]/10 hover:bg-[#1EB996]/20 transition cursor-pointer"><Pencil className="w-4 h-4" /></button>
                    <button type="button" aria-label={`${isAr ? 'حذف' : 'Delete'} ${lang.name}`} title={isAr ? 'حذف اللغة' : 'Delete language'} onClick={() => setDeletingCode(deletingCode === lang.code ? null : lang.code)} className="p-2.5 rounded-full text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                  </div>}
                  <button type="button" onClick={() => handleSelect(lang)} aria-label={`${isAr ? 'اختيار' : 'Select'} ${lang.name}`} className="flex items-center gap-2 shrink-0 py-2.5 ps-1 pe-1.5 cursor-pointer">
                    <span className="flex items-center gap-2 shrink-0">
                      <code dir="ltr" className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#131722] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-[#2C374A]">{lang.code}</code>
                      {isSelected && <Check className="w-4 h-4 text-[var(--accent-primary)] stroke-[2.5]" />}
                    </span>
                  </button>
                </div>
                {deletingCode === lang.code && <div className="px-3 pb-3 text-xs space-y-2">
                  <p className="text-slate-500 dark:text-slate-400">{isAr ? 'حذف من القائمة فقط؟ ترجماتك المحفوظة لن تُحذف.' : 'Remove from the list only? Saved translations will be kept.'}</p>
                  <div className="flex gap-2"><button type="button" onClick={() => { persist(customLanguages.filter((l) => l.code !== lang.code)); setDeletingCode(null); if (editingCode === lang.code) resetForm(); }} className="px-3 py-1.5 bg-red-500/15 text-red-500 rounded-lg cursor-pointer">{isAr ? 'حذف' : 'Delete'}</button><button type="button" onClick={() => setDeletingCode(null)} className="px-3 py-1.5 text-slate-400 cursor-pointer">{isAr ? 'إلغاء' : 'Cancel'}</button></div>
                </div>}
              </div>
            );
          })}
        </div>
        <div className="p-4 border-t border-slate-100 dark:border-[#242D3D] bg-slate-50/50 dark:bg-[#121620] shrink-0">
          <form onSubmit={handleAddCustom} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{editingCode ? (isAr ? 'تعديل اللغة المخصصة' : 'Edit custom language') : t('or_enter_custom_android_locale')}</span>
              {editingCode && <button type="button" onClick={resetForm} className="text-[11px] text-slate-400 cursor-pointer">{isAr ? 'إلغاء' : 'Cancel'}</button>}
            </div>
            <div className="flex items-center gap-2">
              <input ref={codeRef} type="text" dir="ltr" aria-label={isAr ? 'رمز اللغة' : 'Locale code'} value={customCode} onChange={(e) => { setCustomCode(e.target.value); setError(''); }} placeholder="es-rMX" className={`${inputClass} flex-[0.8]`} required maxLength={64} />
              <input type="text" dir="auto" aria-label={isAr ? 'اسم اللغة' : 'Language name'} value={customName} onChange={(e) => { setCustomName(e.target.value); setError(''); }} placeholder={isAr ? 'اسم اللغة' : 'Language name'} className={`${inputClass} flex-1`} required maxLength={100} />
              <button type="submit" disabled={!customCode.trim() || !customName.trim()} className="px-3 py-2 rounded-xl bg-[#1EB996] hover:bg-[#18A283] disabled:opacity-40 text-white text-xs font-semibold cursor-pointer transition inline-flex items-center gap-1 shrink-0">
                {editingCode ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}<span>{editingCode ? (isAr ? 'حفظ' : 'Save') : t('switch')}</span>
              </button>
            </div>
            {error && <p role="alert" className="text-[11px] text-red-500">{error}</p>}
          </form>
        </div>
      </div>
    </div>
  );
};
