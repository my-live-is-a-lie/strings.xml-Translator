import React from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { TranslationProviderConfig } from '../../utils/translator';
import { useDialog } from '../../utils/useDialog';
import { useT } from '../../i18n/i18n';

interface DeleteProviderDialogProps {
  provider: TranslationProviderConfig;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Asks for confirmation before a custom provider is removed. */
export const DeleteProviderDialog: React.FC<DeleteProviderDialogProps> = ({ provider, onCancel, onConfirm }) => {
  const { t, tb } = useT();
  const deleteDialogRef = useDialog(true, onCancel);
  return createPortal(
    (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs"
          onClick={() => onCancel()}
        />
        <div ref={deleteDialogRef} role="alertdialog" aria-modal="true" aria-labelledby="delete-provider-title" tabIndex={-1} className="outline-none relative z-10 w-full max-w-sm rounded-2xl bg-white dark:bg-[#1B212E] border border-slate-200 dark:border-[#2F384B] p-5 shadow-2xl flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 shrink-0">
                <Trash2 className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 data-i18n id="delete-provider-title" className="text-sm font-bold text-slate-900 dark:text-white">
                  {t('delete_translation_provider')}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  {provider.name}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onCancel()}
              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p data-i18n className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {t('are_you_sure_you_want', provider.name)}
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onCancel()}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2E384B] text-slate-700 dark:text-slate-200 text-xs font-semibold transition cursor-pointer"
            >
              {tb('cancel')}
            </button>
            <button
              id="confirm-delete-provider-btn"
              type="button"
              onClick={onConfirm}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition cursor-pointer shadow-xs"
            >
              {tb('delete_2')}
            </button>
          </div>
        </div>
      </div>
    ),
    document.body
  );
};
