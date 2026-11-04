import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Trash2, Upload, X } from 'lucide-react';
import { addCustomLanguage, removeCustomLanguage, useCustomLanguages, useT } from '../i18n/i18n';
import { saveFile } from '../utils/saveFile';
import { debugIgnored } from '../utils/debug';
import { generateEnglishUiXml, parseUiXml } from '../i18n/stringsXml';

type Props = { onClose: () => void; activeCode: string; onAdded: (code: string) => void; onRemoved: (code: string) => void };

export default function AddLanguageModal({ onClose, activeCode, onAdded, onRemoved }: Props) {
  const { t, tb } = useT();
  const langs = useCustomLanguages();
  const [name, setName] = useState('');
  const [rtl, setRtl] = useState(false);
  const [parsed, setParsed] = useState<ReturnType<typeof parseUiXml> | null>(null);

  const download = () => {
    void saveFile(new Blob([generateEnglishUiXml()], { type: 'application/xml' }), 'strings.xml').catch((err) =>
      debugIgnored('AddLanguageModal.download', err)
    );
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setParsed(parseUiXml(await f.text()));
  };
  const valid = !!parsed && parsed.found > 0 && name.trim().length > 0;
  const submit = () => {
    if (!parsed || !valid) return;
    const entry = addCustomLanguage({ label: name.trim(), rtl, strings: parsed.strings });
    onAdded(entry.code);
    onClose();
  };
  const btn = 'px-3 h-9 rounded-xl text-sm font-medium cursor-pointer flex items-center gap-2 transition';

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161922] border border-slate-200 dark:border-[#252C3A] shadow-2xl p-4 flex flex-col gap-3 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base" data-i18n>{t('add_lang_title')}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1C2333] cursor-pointer">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
        <ol className="list-decimal ps-5 text-sm space-y-1.5 text-slate-600 dark:text-slate-300">
          {['add_lang_step1', 'add_lang_step2', 'add_lang_step3', 'add_lang_step4'].map((k) => (
            <li key={k} data-i18n>{t(k)}</li>
          ))}
        </ol>
        <button type="button" onClick={download} className={`${btn} bg-slate-100 dark:bg-[#1C2333] hover:bg-slate-200 dark:hover:bg-[#242E40]`}>
          <Download className="w-4 h-4 shrink-0" />
          <span data-i18n>{t('add_lang_download')}</span>
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tb('add_lang_name')}
          className="h-9 px-3 rounded-xl text-sm bg-slate-100 dark:bg-[#1C2333] outline-none border border-transparent focus:border-[var(--accent-primary)]"
        />
        <div className="grid grid-cols-2 gap-2">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setRtl(v)}
              className={`${btn} justify-center border ${rtl === v ? 'border-[var(--accent-primary)] bg-slate-200 dark:bg-[#252F42]' : 'border-transparent bg-slate-100 dark:bg-[#1C2333]'}`}
            >
              {tb(v ? 'add_lang_rtl' : 'add_lang_ltr')}
            </button>
          ))}
        </div>
        <label className={`${btn} bg-slate-100 dark:bg-[#1C2333] hover:bg-slate-200 dark:hover:bg-[#242E40]`}>
          <Upload className="w-4 h-4 shrink-0" />
          <span data-i18n>{t('add_lang_upload')}</span>
          <input type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {parsed && (
          <p className="text-xs text-slate-500" data-i18n>
            {parsed.found > 0 ? t('add_lang_found', parsed.found, parsed.unknown) : t('add_lang_invalid')}
          </p>
        )}
        <button
          type="button"
          disabled={!valid}
          onClick={submit}
          className={`${btn} justify-center text-white bg-[var(--accent-primary)] disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {tb('add_lang_add')}
        </button>
        {langs.length > 0 && (
          <div className="border-t border-slate-200 dark:border-[#252C3A] pt-2 space-y-1">
            <div className="text-xs text-slate-500" data-i18n>{t('add_lang_yours')}</div>
            {langs.map((l) => (
              <div key={l.code} className="flex items-center justify-between text-sm">
                <span>{l.label}</span>
                <button
                  type="button"
                  aria-label="Delete"
                  title={tb('add_lang_delete')}
                  onClick={() => {
                    removeCustomLanguage(l.code);
                    if (activeCode === l.code) onRemoved(l.code);
                  }}
                  className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
