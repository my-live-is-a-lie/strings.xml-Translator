import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Upload, X } from 'lucide-react';
import { useT } from '../i18n/i18n';
import {
  addFontFiles,
  buildFamilies,
  removeFont,
  resolveChoice,
  setFontChoice,
  useFonts,
  type FontTarget,
} from '../utils/fonts';

type Props = { target: FontTarget; onClose: () => void };

export default function AddFontModal({ target, onClose }: Props) {
  const { t, tb } = useT();
  const snap = useFonts();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ fontId: string; label: string } | null>(null);

  const userFamilies = useMemo(() => buildFamilies(snap.fonts).filter((f) => !f.builtin), [snap.fonts]);
  const current = resolveChoice(buildFamilies(snap.fonts), snap.selection[target]);

  const onFiles = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (inputRef.current) inputRef.current.value = '';
    if (!files.length) return;
    setBusy(true);
    setMessage('');
    const { added, failed, sessionOnly } = await addFontFiles(files);
    setBusy(false);
    const parts: string[] = [];
    if (added.length) parts.push(t('font_added_count', added.length));
    if (failed) parts.push(t('font_failed_count', failed));
    if (sessionOnly) parts.push(t('font_session_only', sessionOnly));
    setMessage(parts.join(' · '));
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
        <div
          role="dialog"
          className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-[#161922] border border-slate-200 dark:border-[#252C3A] shadow-2xl flex flex-col gap-3 text-slate-800 dark:text-slate-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* The title and the Browse button stay visible while the font list scrolls */}
          <div className="sticky top-0 z-10 rounded-t-2xl bg-white dark:bg-[#161922] px-4 pt-4 pb-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-base" data-i18n>{t('font_add_title')}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={tb('font_close')}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1C2333] cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300" data-i18n>{t('font_browse_hint')}</p>

            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".ttf,.otf,.ttc,.woff,font/ttf,font/otf,font/woff,application/x-font-ttf,application/x-font-opentype,application/font-woff,application/octet-stream"
              className="hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="px-3 h-10 rounded-xl text-sm font-medium cursor-pointer flex items-center justify-center gap-2 transition bg-slate-100 dark:bg-[#1C2333] hover:bg-slate-200 dark:hover:bg-[#242E40] disabled:opacity-60 border border-slate-200/80 dark:border-[#2A3446]"
            >
              <Upload className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
              <span data-i18n>{tb('font_browse')}</span>
            </button>
            {message && <p className="text-xs text-slate-500 dark:text-slate-400" data-i18n>{message}</p>}
          </div>

          <div className="px-4 pb-4 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2 pt-1">
              <h3 className="text-sm font-semibold" data-i18n>{t('font_added_list')}</h3>
              {userFamilies.length > 0 && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400" data-i18n>{t('font_tap_to_use')}</span>
              )}
            </div>

            {userFamilies.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-3 text-center" data-i18n>{t('font_none_added')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {userFamilies.map((fam) => (
                  <li key={fam.id} className="rounded-xl border border-slate-200 dark:border-[#252C3A] overflow-hidden">
                    <div className="px-3 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-[#141822] text-slate-500 dark:text-slate-400 truncate" dir="auto">
                      {fam.name}
                    </div>
                    <ul>
                      {fam.variants.map((v) => {
                        const selected = current.family.id === fam.id && current.variant.key === v.key;
                        return (
                          <li key={v.key} className="flex items-center border-t border-slate-100 dark:border-[#1E2533]">
                            <button
                              type="button"
                              onClick={() => {
                                setFontChoice(target, { f: fam.id, v: v.key });
                                onClose();
                              }}
                              className={`flex-1 min-w-0 flex items-center justify-between gap-3 px-3 py-2.5 text-start cursor-pointer transition hover:bg-slate-100 dark:hover:bg-[#1C2333] ${
                                selected ? 'bg-slate-100 dark:bg-[#1C2333]' : ''
                              }`}
                            >
                              <span
                                className="truncate text-base"
                                dir="auto"
                                style={{
                                  fontFamily: fam.css,
                                  fontWeight: v.weight,
                                  fontStyle: v.italic ? 'italic' : 'normal',
                                  color: selected ? 'var(--accent-primary)' : undefined,
                                }}
                              >
                                {fam.name} · {v.label}
                              </span>
                              <span
                                className="shrink-0 text-base text-slate-500 dark:text-slate-400"
                                dir="auto"
                                style={{ fontFamily: fam.css, fontWeight: v.weight, fontStyle: v.italic ? 'italic' : 'normal' }}
                              >
                                Abc أبج
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete({ fontId: v.fontId!, label: `${fam.name} · ${v.label}` })}
                              title={tb('font_delete')}
                              aria-label={tb('font_delete')}
                              className="shrink-0 w-10 h-10 mx-1 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition"
                            >
                              <Trash2 className="w-4.5 h-4.5" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            role="alertdialog"
            aria-label={t('font_delete_title')}
            className="w-full max-w-xs rounded-2xl bg-white dark:bg-[#161922] border border-slate-200 dark:border-[#252C3A] shadow-2xl p-4 flex flex-col gap-3 text-slate-800 dark:text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-base" data-i18n>{t('font_delete_title')}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300" data-i18n>{t('font_delete_msg', confirmDelete.label)}</p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3 h-9 rounded-xl text-sm font-medium cursor-pointer bg-slate-100 dark:bg-[#1C2333] hover:bg-slate-200 dark:hover:bg-[#242E40]"
              >
                <span data-i18n>{tb('cancel')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void removeFont(confirmDelete.fontId);
                  setConfirmDelete(null);
                }}
                className="px-3 h-9 rounded-xl text-sm font-medium cursor-pointer bg-red-500 hover:bg-red-600 text-white"
              >
                <span data-i18n>{tb('font_delete_confirm')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
