import React, { useState, useMemo } from 'react';
import { X, Search, Globe, Check, Plus } from 'lucide-react';
import {
  SUPPORTED_LANGUAGES,
  LanguageOption,
  getLanguageOption,
  getArabicLanguageName,
} from '../utils/languages';

interface LanguageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLang: string;
  onSelectLanguage: (lang: LanguageOption) => void;
  appLang?: 'ar' | 'en';
}

export const LanguageSelectorModal: React.FC<LanguageSelectorModalProps> = ({
  isOpen,
  onClose,
  currentLang,
  onSelectLanguage,
  appLang = 'ar',
}) => {
  const isAr = appLang === 'ar';
  const [search, setSearch] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [customName, setCustomName] = useState('');

  const filteredLanguages = useMemo(() => {
    if (!search.trim()) return SUPPORTED_LANGUAGES;
    const q = search.toLowerCase();
    return SUPPORTED_LANGUAGES.filter((l) => {
      const arName = getArabicLanguageName(l.code, l.name).toLowerCase();
      return (
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        arName.includes(q) ||
        l.code.toLowerCase().includes(q) ||
        l.androidDir.toLowerCase().includes(q)
      );
    });
  }, [search]);

  if (!isOpen) return null;

  const handleSelect = (lang: LanguageOption) => {
    onSelectLanguage(lang);
    onClose();
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCode.trim()) return;

    const cleanCode = customCode.trim().replace(/^values-/, '');
    const option = getLanguageOption(cleanCode);
    if (customName.trim()) {
      option.name = customName.trim();
      option.nativeName = customName.trim();
    }
    handleSelect(option);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      {/* M3 Dialog Card */}
      <div className="w-full max-w-xl bg-white dark:bg-[#161A23] rounded-3xl border border-slate-200 dark:border-[#283244] shadow-2xl overflow-hidden flex flex-col my-4 max-h-[88vh]">
        {/* Dialog Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-[#242D3D] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#0B57D0]/10 dark:bg-[#1EB996]/20 flex items-center justify-center text-[#0B57D0] dark:text-[#1EB996]">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {isAr ? 'تغيير لغة الترجمة المستهدفة' : 'Switch Target Language'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isAr
                  ? 'اختر لغة أندرويد لترجمة النصوص إليها'
                  : 'Select an Android locale to translate your strings into'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#202736] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="p-4 pb-2 border-b border-slate-100 dark:border-[#242D3D]">
          <div className="relative flex items-center bg-slate-100 dark:bg-[#121620] rounded-2xl px-3.5 py-2 ring-1 ring-slate-200/80 dark:ring-[#2A3448] focus-within:ring-2 focus-within:ring-[#1EB996]">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 mr-2 shrink-0" />
            <input
              type="text"
              placeholder={
                isAr
                  ? 'ابحث باسم اللغة، الرمز (ar, es, fr)، أو المجلد...'
                  : 'Search by language name, code (ar, es, fr), or folder...'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
              autoFocus
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Languages List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {filteredLanguages.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              {isAr
                ? 'لم يتم العثور على لغات مطابقة. يمكنك إضافتها أدناه كرمز لغة مخصص.'
                : 'No matching languages found. You can add it below as a custom locale.'}
            </div>
          ) : (
            filteredLanguages.map((lang) => {
              const isSelected = currentLang.toLowerCase() === lang.code.toLowerCase();
              const displayLangName = isAr
                ? getArabicLanguageName(lang.code, lang.name)
                : lang.name;
              return (
                <button
                  key={lang.code}
                  onClick={() => handleSelect(lang)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-2xl transition cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#1EB996]/15 text-[#1EB996] border border-[#1EB996]/40 dark:bg-[#1EB996]/20'
                      : 'hover:bg-slate-100 dark:hover:bg-[#1E2534] text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-xl bg-slate-200/70 dark:bg-[#263042] flex items-center justify-center font-mono text-[11px] font-semibold shrink-0 uppercase">
                      {lang.code.substring(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-semibold truncate">
                          {displayLangName}
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-slate-400 truncate">
                          ({lang.nativeName})
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                        {lang.androidDir} {lang.isRtl && (isAr ? '· من اليمين لليسار' : '· RTL')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <code className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#131722] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-[#2C374A]">
                      {lang.code}
                    </code>
                    {isSelected && <Check className="w-4 h-4 text-[#1EB996] stroke-[2.5]" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Custom Locale Entry Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-[#242D3D] bg-slate-50/50 dark:bg-[#121620]">
          <form onSubmit={handleAddCustom} className="space-y-2">
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
              {isAr
                ? 'أو أدخل رمز لغة أندرويد مخصص:'
                : 'Or enter custom Android locale code:'}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                dir="ltr"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                placeholder={
                  isAr ? 'مثال: es-rMX, zh-rHK, b+sr+Latn' : 'e.g. es-rMX, zh-rHK, b+sr+Latn'
                }
                className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-[#1A202C] border border-slate-200 dark:border-[#2D384C] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#1EB996]"
              />
              <button
                type="submit"
                disabled={!customCode.trim()}
                className="px-3 py-1.5 rounded-xl bg-[#1EB996] hover:bg-[#18A283] disabled:opacity-40 text-white text-xs font-semibold cursor-pointer transition inline-flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isAr ? 'تبديل' : 'Switch'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
