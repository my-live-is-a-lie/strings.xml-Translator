import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { TranslationProject } from '../types';
import { parseAndroidXml, normalizePluralsForLanguage } from '../utils/xmlParser';
import { diffSources } from '../utils/sourceDiff';
import { useDialog } from '../utils/useDialog';
import { useT } from '../i18n/i18n';

const MAX_BYTES = 5 * 1024 * 1024;

interface UpdateSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: TranslationProject;
  onApply: (parsed: ReturnType<typeof parseAndroidXml>, rawXml: string) => void;
  appLang?: 'ar' | 'en';
}

export const UpdateSourceModal: React.FC<UpdateSourceModalProps> = ({
  isOpen,
  onClose,
  project,
  onApply,
  appLang: _appLang = 'ar',
}) => {
  const { t, tb } = useT();
  const dialogRef = useDialog(isOpen, onClose);
  const [xml, setXml] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => (xml.trim() ? parseAndroidXml(xml) : null), [xml]);
  const diff = useMemo(() => {
    if (!parsed || parsed.errors.length > 0 || parsed.items.length === 0) return null;
    return diffSources(project.items, normalizePluralsForLanguage(parsed.items, project.targetLang));
  }, [parsed, project.items, project.targetLang]);

  if (!isOpen) return null;

  const close = () => {
    setXml('');
    setError(null);
    onClose();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(t('the_file_is_larger_than'));
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => setXml(String(ev.target?.result ?? ''));
    reader.readAsText(file);
  };

  const apply = () => {
    if (!parsed || !diff) return;
    onApply(parsed, xml);
    close();
  };

  const section = (title: string, names: string[], tone: string) =>
    names.length > 0 && (
      <details className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
        <summary className={`cursor-pointer text-sm font-semibold ${tone}`}>
          {title} ({names.length})
        </summary>
        <ul className="mt-2 max-h-32 overflow-y-auto text-xs font-mono text-slate-600 dark:text-slate-300 space-y-0.5" dir="ltr">
          {names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-source-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-[#1E1F20] rounded-3xl m3-elevation-3 border border-slate-200/80 dark:border-slate-800/80 p-6 flex flex-col gap-4 my-6 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h2 data-i18n id="update-source-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('update_source_file')}
              </h2>
              <p data-i18n className="text-xs text-slate-600 dark:text-slate-400">
                {t('load_a_newer_english_strings')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t('close')}
            className="p-2 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <input
          id="update-source-file"
          type="file"
          accept=".xml,text/xml,application/xml"
          onChange={handleFile}
          aria-label={t('choose_a_new_strings_xml')}
          className="text-xs file:me-3 file:px-3 file:py-1.5 file:rounded-full file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200 file:cursor-pointer"
        />
        <textarea
          id="update-source-text"
          dir="ltr"
          value={xml}
          onChange={(e) => {
            if (e.target.value.length > MAX_BYTES) {
              setError(t('the_text_is_larger_than'));
              return;
            }
            setError(null);
            setXml(e.target.value);
          }}
          rows={6}
          placeholder="<resources>…</resources>"
          aria-label={t('or_paste_the_strings_xml')}
          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#131720] p-3 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/40"
        />

        {error && (
          <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        {parsed && parsed.errors.length > 0 && (
          <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
            {parsed.errors.join(' ')}
          </p>
        )}

        {diff && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p data-i18n className="text-sm text-slate-700 dark:text-slate-200">
              {t('new_changed_removed_unchanged', diff.added.length, diff.changed.length, diff.removed.length, diff.unchanged.length)}
            </p>
            {section(t('new_strings'), diff.added, 'text-emerald-600 dark:text-emerald-400')}
            {section(t('source_changed_needs_review'), diff.changed, 'text-amber-600 dark:text-amber-400')}
            {section(t('removed_from_source_will_be'), diff.removed, 'text-rose-600 dark:text-rose-400')}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={close} className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer">
            {tb('cancel')}
          </button>
          <button
            id="update-source-apply"
            type="button"
            onClick={apply}
            disabled={!diff}
            className="px-5 py-2.5 rounded-full bg-[#0B57D0] hover:bg-[#0842A0] dark:bg-[#1EB996] dark:hover:bg-[#19A585] text-white text-xs font-semibold shadow-xs disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            {tb('apply_update')}
          </button>
        </div>
      </div>
    </div>
  );
};
