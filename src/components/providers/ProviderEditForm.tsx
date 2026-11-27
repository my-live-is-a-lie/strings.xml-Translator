import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Clipboard, Loader2, X } from 'lucide-react';
import {
  TranslationProviderConfig,
  ProviderEngineType,
  ProviderTestResult,
  updateCustomProvider,
} from '../../utils/translator';
import { useT } from '../../i18n/i18n';
import { readClipboardText } from '../SecretField';
import { textDirection } from '../../utils/direction';
import { useKeyTest } from './useKeyTest';
import { inferEngineFromName } from './engineInference';
import { testErrorText as testErrorTextFor } from './testErrorText';

interface ProviderEditFormProps {
  provider: TranslationProviderConfig;
  /** Called when the form is cancelled or saved */
  onClose: () => void;
  /** Called after the provider's settings are saved */
  refresh: () => void;
}

/** Inline form under a custom provider card: its name and API key (with verification). */
export const ProviderEditForm: React.FC<ProviderEditFormProps> = ({ provider: prov, onClose, refresh }) => {
  const { t, tb } = useT();
  // Lara keys are stored as "key:secret"; the form shows them in two fields.
  const savedKey = prov.apiKey || '';
  const splitLara = prov.type === 'lara' && savedKey.includes(':') && !savedKey.endsWith(':fx');
  const [editProviderName, setEditProviderName] = useState(prov.name);
  const [editApiKey, setEditApiKey] = useState(splitLara ? savedKey.slice(0, savedKey.indexOf(':')) : savedKey);
  const [editApiSecret, setEditApiSecret] = useState(splitLara ? savedKey.slice(savedKey.indexOf(':') + 1) : '');
  const [editFolderId, setEditFolderId] = useState(prov.folderId || '');
  const editTest = useKeyTest();
  // The edited key that was verified valid; saving a changed key is allowed only for this exact value.
  const [editVerified, setEditVerified] = useState<{ sig: string; result: ProviderTestResult } | null>(null);
  const editNameInputRef = useRef<HTMLInputElement | null>(null);
  const editKeyInputRef = useRef<HTMLInputElement | null>(null);

  const testErrorText = (result: ProviderTestResult) => testErrorTextFor(t, result);

  useEffect(() => {
    const timer = setTimeout(() => {
      editNameInputRef.current?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, []);

  // What the form would save, and whether it changes the stored key/folder.
  const resolveEditTarget = () => {
    const trimmedName = editProviderName.trim() || prov.name;
    const rawKey = editApiKey.trim() || (prov.type === 'libretranslate' ? 'none' : '');
    const rawSecret = editApiSecret.trim();
    const inferredEngine = inferEngineFromName(trimmedName, 'auto');
    const targetEngine =
      inferredEngine !== 'auto' ? (inferredEngine as ProviderEngineType) : prov.type;
    const combinedKey =
      targetEngine === 'lara' && rawSecret && !rawKey.includes(':')
        ? `${rawKey}:${rawSecret}`
        : rawKey;
    const editedFolderId = editFolderId.trim();
    const keyChanged =
      combinedKey !== (prov.apiKey || '').trim() ||
      ((targetEngine === 'yandex' || targetEngine === 'libretranslate') && editedFolderId !== (prov.folderId || '').trim());
    const sig = JSON.stringify([prov.id, targetEngine, combinedKey, editedFolderId]);
    return { trimmedName, rawKey, targetEngine, combinedKey, editedFolderId, keyChanged, sig };
  };

  // A changed key is verified automatically once typing pauses; Save stays disabled until it passes
  // (an unchanged key needs no check).
  const editSig = resolveEditTarget().sig;
  useEffect(() => {
    const target = resolveEditTarget();
    if (!target.keyChanged || !target.rawKey) return;
    const timer = setTimeout(async () => {
      const result = await editTest.run(target.targetEngine, target.combinedKey, target.editedFolderId);
      if (!result) return;
      if (result.success && result.matched) setEditVerified({ sig: target.sig, result });
    }, 400);
    return () => {
      clearTimeout(timer);
      editTest.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const { trimmedName, rawKey, targetEngine, combinedKey, editedFolderId, keyChanged, sig } =
      resolveEditTarget();
    if (!rawKey) return;

    // If only the provider name was changed, save immediately without re-running network verification
    if (!keyChanged) {
      updateCustomProvider(prov.id, {
        name: trimmedName,
        type: targetEngine,
      });
      refresh();
      onClose();
      editTest.setResult(null);
      return;
    }

    // A changed key is saved only if this exact key was already verified valid
    const result = editVerified && editVerified.sig === sig ? editVerified.result : null;
    if (!result) return;

    const detectedType: ProviderEngineType = result.detectedType || targetEngine;
    updateCustomProvider(prov.id, {
      name: trimmedName,
      apiKey: combinedKey,
      type: detectedType,
      folderId: detectedType === 'yandex' || detectedType === 'libretranslate' ? editedFolderId : '',
      // A changed key may have different model availability than the old one.
      ...(result.workingModel ? { model: result.workingModel } : {}),
    });
    refresh();
    onClose();
    editTest.setResult(null);
    setEditVerified(null);
  };

  return (
    <form
      onSubmit={handleSave}
      onClick={(e) => e.stopPropagation()}
      className="mt-2.5 pt-2.5 border-t border-slate-200/80 dark:border-[#262E3E] flex flex-col gap-2.5"
    >
      <div className="flex flex-col gap-1">
        <label data-i18n className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
          {t('edit_provider_name')}
        </label>
        <div
          className="relative flex items-center"
          dir={textDirection(editProviderName)}
        >
          <input
            ref={editNameInputRef}
            type="text"
            autoComplete="off"
            dir={textDirection(editProviderName)}
            value={editProviderName}
            onChange={(e) => setEditProviderName(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            placeholder={t('provider_name')}
            required
            className="w-full px-2.5 pe-7 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
          />
          {editProviderName && (
            <button
              type="button"
              onClick={() => {
                setEditProviderName('');
                editNameInputRef.current?.focus();
              }}
              className="absolute end-2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              aria-label="Clear edited provider name"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
          {prov.type === 'lara' ||
          inferEngineFromName(editProviderName, 'auto') === 'lara'
            ? t('lara_access_key_id_or')
            : t('edit_api_key')}
        </label>
        <div className="relative flex items-center" dir="ltr">
          <input
            ref={editKeyInputRef}
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            value={editApiKey}
            onChange={(e) => {
              editTest.cancel();
              editTest.setResult(null);
              setEditApiKey(e.target.value);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            placeholder={
              prov.type === 'lara' ||
              inferEngineFromName(editProviderName, 'auto') === 'lara'
                ? t('access_key_id_or_id')
                : t('api_key')
            }
            required
            // The key is always masked and can never be revealed
            style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
            className="w-full px-2.5 pe-8 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
          />
          <button
            type="button"
            onClick={async () => {
              if (editApiKey) {
                editTest.cancel();
                editTest.setResult(null);
                setEditApiKey('');
                editKeyInputRef.current?.focus();
                return;
              }
              try {
                const text = (await readClipboardText()).trim();
                if (text) {
                  editTest.setResult(null);
                  setEditApiKey(text);
                }
              } catch {
                editKeyInputRef.current?.focus(); // clipboard blocked: paste manually
              }
            }}
            className="absolute end-2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            title={editApiKey ? t('clear_key_field') : t('paste_from_clipboard')}
            aria-label={editApiKey ? t('clear_key_field') : t('paste_from_clipboard')}
          >
            {editApiKey ? <X className="w-3 h-3" /> : <Clipboard className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {(prov.type === 'lara' ||
        inferEngineFromName(editProviderName, 'auto') === 'lara') && (
        <div className="flex flex-col gap-1">
          <label data-i18n className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
            {t('lara_access_key_secret')}
          </label>
          <input
            type="text"
            autoComplete="off"
            value={editApiSecret}
            onChange={(e) => {
              editTest.setResult(null);
              setEditApiSecret(e.target.value);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            placeholder={
              t('access_key_secret_optional_if')
            }
            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
          />
        </div>
      )}

      {prov.type === 'libretranslate' && (
        <div className="flex flex-col gap-1">
          <label data-i18n className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
            {t('server_url')}
          </label>
          <input
            type="url"
            dir="ltr"
            autoComplete="off"
            value={editFolderId}
            onChange={(e) => {
              editTest.setResult(null);
              setEditFolderId(e.target.value);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            placeholder="https://libretranslate.example.com"
            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
          />
        </div>
      )}

      {(prov.type === 'yandex' ||
        inferEngineFromName(editProviderName, 'auto') === 'yandex' ||
        editApiKey.trim().startsWith('t1.')) && (
        <div className="flex flex-col gap-1">
          <label data-i18n className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
            {t('folder_id')}
          </label>
          <input
            type="text"
            dir="ltr"
            autoComplete="off"
            value={editFolderId}
            onChange={(e) => {
              editTest.setResult(null);
              setEditFolderId(e.target.value);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            placeholder={
              t('b1g_with_a_personal_account')
            }
            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
          />
        </div>
      )}

      {editTest.result && !editTest.result.matched && (
        <div className="p-2 rounded-lg border bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300 text-[10px] flex flex-col gap-1">
          <div className="flex items-center gap-1 font-semibold">
            <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            <span data-i18n>
              {t('new_api_key_verification_failed')}
            </span>
          </div>
          {editTest.result.error && (
            <p className="opacity-90 leading-snug">{testErrorText(editTest.result)}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        {editTest.running && (
          <button
            type="button"
            onClick={() => editTest.cancel()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-[11px] font-semibold transition cursor-pointer"
          >
            <X className="w-3 h-3" />
            <span data-i18n>{tb('cancel')}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            editTest.cancel();
            onClose();
            editTest.setResult(null);
          }}
          className="px-2.5 py-1.5 rounded-lg bg-slate-200/70 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2E384B] text-slate-700 dark:text-slate-200 text-[11px] font-semibold transition cursor-pointer"
        >
          {tb('cancel')}
        </button>
        <button
          type="submit"
          disabled={
            editTest.running ||
            (() => {
              const target = resolveEditTarget();
              return target.keyChanged && editVerified?.sig !== target.sig;
            })() ||
            !editProviderName.trim() ||
            (!editApiKey.trim() && prov.type !== 'libretranslate')
          }
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1EB996] hover:bg-[#19A585] disabled:opacity-50 text-white text-[11px] font-semibold transition cursor-pointer shadow-xs"
        >
          {editTest.running ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span data-i18n>{t('verifying')}</span>
            </>
          ) : (
            <>
              <Check className="w-3 h-3" />
              <span data-i18n>{t('save_changes')}</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};
