import React, { useRef, useState } from 'react';
import { Archive, Check, Loader2, X } from 'lucide-react';
import { ResourceItem, TranslationProject } from '../types';
import { SUPPORTED_LANGUAGES, getArabicLanguageName } from '../utils/languages';
import { bulkTranslateItems, getActiveProviderId, getAllTranslationProviders, withTranslationProvider } from '../utils/translator';
import { getProviderDisplayName } from './ProvidersPanel';
import { downloadZip, itemsForLanguage, needsTranslation, valuesDirFor, xmlForLanguage } from '../utils/multiLang';
import { useDialog } from '../utils/useDialog';

type LangStatus = { state: 'pending' | 'running' | 'done' | 'error'; done: number; total: number; message?: string };

interface MultiLanguageModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: TranslationProject;
  /** Stores the translated languages in the project so they can be opened later from the language picker */
  onSaveLanguages: (byLang: Record<string, ResourceItem[]>) => void;
  appLang?: 'ar' | 'en';
}

export const MultiLanguageModal: React.FC<MultiLanguageModalProps> = ({
  isOpen,
  onClose,
  project,
  onSaveLanguages,
  appLang = 'ar',
}) => {
  const isAr = appLang === 'ar';
  const dialogRef = useDialog(isOpen, onClose);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, LangStatus>>({});
  const [results, setResults] = useState<Record<string, ResourceItem[]>>({});
  // Providers that need a key are only offered once a key has been saved; the choice applies to this run only
  const [providers] = useState(() => getAllTranslationProviders().filter((p) => p.isBuiltIn || p.apiKey));
  const [providerId, setProviderId] = useState(() => {
    const active = getActiveProviderId();
    return providers.some((p) => p.id === active) ? active : providers[0]?.id ?? '';
  });
  const [running, setRunning] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [saved, setSaved] = useState(false);
  const cancelRef = useRef(false);

  if (!isOpen) return null;

  const langName = (code: string, name: string, native: string) => (isAr ? getArabicLanguageName(code, name) : `${name} (${native})`);
  const visible = SUPPORTED_LANGUAGES.filter((l) => {
    const q = query.trim().toLowerCase();
    return !q || l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q) || l.nativeName.toLowerCase().includes(q) || getArabicLanguageName(l.code, l.name).includes(q);
  });
  const doneCount = Object.values(statuses).filter((s) => s.state === 'done').length;

  const toggle = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const start = async () => {
    cancelRef.current = false;
    setRunning(true);
    setSaved(false);
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code).filter((c) => selected.has(c));
    setStatuses(Object.fromEntries(codes.map((c) => [c, { state: 'pending', done: 0, total: 0 } as LangStatus])));
    const out: Record<string, ResourceItem[]> = {};

    for (const code of codes) {
      if (cancelRef.current) break;
      const base = itemsForLanguage(project, code);
      const todo = base.filter(needsTranslation);
      setStatuses((s) => ({ ...s, [code]: { state: 'running', done: 0, total: todo.length } }));
      try {
        const translated = await withTranslationProvider(providerId, () =>
          bulkTranslateItems(todo, code, getArabicLanguageName(code), (done, total) =>
            setStatuses((s) => ({ ...s, [code]: { state: 'running', done, total } }))
          )
        );
        const byId = new Map(translated.map((t) => [t.id, t]));
        out[code] = base.map((item) => byId.get(item.id) ?? item);
        setStatuses((s) => ({ ...s, [code]: { state: 'done', done: todo.length, total: todo.length } }));
      } catch (err) {
        setStatuses((s) => ({
          ...s,
          [code]: { state: 'error', done: 0, total: todo.length, message: err instanceof Error ? err.message : String(err) },
        }));
      }
    }
    setResults((prev) => ({ ...prev, ...out }));
    setRunning(false);
  };

  const download = async () => {
    setZipping(true);
    try {
      const files = Object.entries(results).map(([code, items]) => ({
        path: `${valuesDirFor(code)}/strings.xml`,
        content: xmlForLanguage(project, items),
      }));
      await downloadZip(files, `${(project.name || 'strings').replace(/[^\w.-]+/g, '_')}-translations.zip`);
    } finally {
      setZipping(false);
    }
  };

  const close = () => {
    if (running) cancelRef.current = true;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="multilang-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-[#1E1F20] rounded-3xl m3-elevation-3 border border-slate-200/80 dark:border-slate-800/80 p-6 flex flex-col gap-4 my-6 max-h-[90vh] outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Archive className="w-6 h-6 text-[#1EB996]" aria-hidden="true" />
            <div>
              <h2 id="multilang-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                {isAr ? 'ترجمة عدة لغات وتصدير ZIP' : 'Translate several languages → ZIP'}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {isAr
                  ? 'تُترجم النصوص غير المترجمة فقط بالمزود المختار، ويُنشأ مجلد values-xx لكل لغة.'
                  : 'Only untranslated strings are translated with the selected provider; one values-xx folder is created per language.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={close} aria-label={isAr ? 'إغلاق' : 'Close'} className="p-2 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <input
          id="multilang-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={running}
          placeholder={isAr ? 'ابحث عن لغة…' : 'Search languages…'}
          aria-label={isAr ? 'ابحث عن لغة' : 'Search languages'}
          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#131720] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1EB996]/40"
        />

        <ul className="overflow-y-auto min-h-0 max-h-72 grid grid-cols-1 sm:grid-cols-2 gap-1.5 pe-1" aria-label={isAr ? 'اللغات' : 'Languages'}>
          {visible.map((l) => {
            const st = statuses[l.code];
            const isCurrent = l.code.toLowerCase() === project.targetLang.toLowerCase();
            return (
              <li key={l.code}>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <input
                    type="checkbox"
                    checked={selected.has(l.code)}
                    onChange={() => toggle(l.code)}
                    disabled={running}
                    className="w-4 h-4 accent-[#1EB996]"
                    data-lang={l.code}
                  />
                  <span className="flex-1 min-w-0 truncate text-slate-800 dark:text-slate-100">
                    {langName(l.code, l.name, l.nativeName)}
                    <span className="ms-1 font-mono text-[10px] text-slate-400" dir="ltr">{l.androidDir}</span>
                    {isCurrent && <span className="ms-1 text-[10px] text-[#1EB996]">{isAr ? '(الحالية)' : '(current)'}</span>}
                  </span>
                  {st?.state === 'running' && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-500" aria-live="polite">
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                      {st.done}/{st.total}
                    </span>
                  )}
                  {st?.state === 'done' && <Check className="w-4 h-4 text-emerald-500" aria-label={isAr ? 'تم' : 'Done'} />}
                  {st?.state === 'error' && (
                    <span className="text-[10px] text-rose-500" title={st.message}>
                      {isAr ? 'فشل' : 'Failed'}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>

        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <span className="shrink-0">{isAr ? 'مزوّد الترجمة:' : 'Translation provider:'}</span>
          <select
            id="multilang-provider"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            disabled={running}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#1E1F20] text-slate-800 dark:text-slate-100"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {getProviderDisplayName(p, isAr)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-slate-600 dark:text-slate-400" aria-live="polite">
            {isAr ? `${selected.size} لغة محددة` : `${selected.size} selected`}
            {doneCount > 0 && (isAr ? ` · ${doneCount} جاهزة` : ` · ${doneCount} ready`)}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <button type="button" onClick={() => (cancelRef.current = true)} className="px-4 py-2 rounded-full border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                {isAr ? 'إيقاف بعد اللغة الحالية' : 'Stop after current language'}
              </button>
            ) : (
              <button
                id="multilang-start"
                type="button"
                onClick={start}
                disabled={selected.size === 0}
                className="px-4 py-2 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#1EB996] dark:hover:bg-[#19A585] text-white text-xs font-semibold disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                {isAr ? 'ابدأ الترجمة' : 'Start translating'}
              </button>
            )}
            <button
              id="multilang-save"
              type="button"
              onClick={() => {
                onSaveLanguages(results);
                setSaved(true);
              }}
              disabled={Object.keys(results).length === 0 || running}
              className="px-4 py-2 rounded-full border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              {saved ? (isAr ? 'تم الحفظ في المشروع' : 'Saved to project') : isAr ? 'حفظ في المشروع' : 'Save to project'}
            </button>
            <button
              id="multilang-download"
              type="button"
              onClick={download}
              disabled={Object.keys(results).length === 0 || running || zipping}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1EB996] hover:bg-[#19A585] text-white text-xs font-semibold disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              {zipping && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              {isAr ? 'تنزيل ZIP' : 'Download ZIP'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
