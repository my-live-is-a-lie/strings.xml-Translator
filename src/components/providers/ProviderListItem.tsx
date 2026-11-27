import React from 'react';
import { AlertCircle, Check, Pencil, Trash2 } from 'lucide-react';
import { TranslationProviderConfig } from '../../utils/translator';
import { useT } from '../../i18n/i18n';
import type { ProviderRuntimeError } from '../../utils/providerModels';
import { KEY_KIND_UI_KEY } from './errorKindText';
import { ProviderEditForm } from './ProviderEditForm';

interface ProviderListItemProps {
  provider: TranslationProviderConfig;
  /** The name shown on the card */
  label: string;
  isSelected: boolean;
  isEditing: boolean;
  /** A definite key/account problem that sticks on the card */
  runtimeError: ProviderRuntimeError | undefined;
  onSelect: () => void;
  onToggleEdit: () => void;
  onCloseEdit: () => void;
  onDelete: () => void;
  /** Called after the provider's settings are saved */
  refresh: () => void;
}

/** One provider card in the selection list, with its edit and delete buttons and inline edit form. */
export const ProviderListItem: React.FC<ProviderListItemProps> = ({
  provider: prov,
  label,
  isSelected,
  isEditing,
  runtimeError,
  onSelect,
  onToggleEdit,
  onCloseEdit,
  onDelete,
  refresh,
}) => {
  const { t } = useT();
  return (
    <div
      className={`flex flex-col rounded-xl px-2.5 py-2 border transition shrink-0 ${
        isSelected
          ? 'bg-[#1EB996]/12 border-[#1EB996]/50 text-slate-900 dark:text-white'
          : 'bg-white/80 dark:bg-[#151A24] border-slate-200/70 dark:border-[#262E3E] text-slate-700 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-[#1E2534]'
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => onSelect()}
          className="flex-1 flex items-center justify-between gap-2 text-start min-w-0 cursor-pointer"
        >
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold truncate">
                {label}
              </span>
              {!prov.isBuiltIn && (
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#1EB996]/15 text-[#1EB996] border border-[#1EB996]/30 shrink-0">
                  API
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-600 dark:text-slate-400 truncate">
              {prov.type === 'lara'
                ? t('lara_translate_ai')
                : prov.type === 'yandex'
                  ? t('yandex_ai_translator')
                  : prov.type === 'gemini'
                    ? t('gemini_ai_engine')
                    : prov.type === 'google_cloud'
                      ? 'Google Cloud'
                    : prov.type === 'google'
                      ? t('google_neural_translate')
                      : prov.type === 'deepl'
                        ? t('deepl_neural_mt')
                        : prov.type === 'openai'
                          ? t('openai_gpt_translator')
                          : prov.type === 'microsoft'
                            ? t('microsoft_azure_mt')
                            : t('mymemory_tm')}
            </span>
          </div>
          {isSelected && <Check className="w-4 h-4 text-[#1EB996] shrink-0" />}
        </button>

        {/* Edit & Trash Icons for custom API key providers */}
        {!prov.isBuiltIn && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleEdit();
              }}
              className={`p-1.5 rounded-lg transition cursor-pointer shrink-0 ${
                isEditing
                  ? 'text-[#1EB996] bg-[#1EB996]/15'
                  : 'text-slate-400 hover:text-[#1EB996] hover:bg-[#1EB996]/10'
              }`}
              title={t('edit_name_or_api_key')}
              aria-label={`Edit ${prov.name}`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer shrink-0"
              title={t('delete_provider')}
              aria-label={`Delete ${prov.name}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {runtimeError && (
        <div
          className="flex items-center gap-1.5 mt-1.5 text-[10px] text-red-500 dark:text-red-400"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>
            {t(KEY_KIND_UI_KEY[runtimeError.kind])}
          </span>
        </div>
      )}

      {/* Inline Edit Form for Custom Provider Name & API Key */}
      {!prov.isBuiltIn && isEditing && (
        <ProviderEditForm provider={prov} onClose={onCloseEdit} refresh={refresh} />
      )}
    </div>
  );
};
