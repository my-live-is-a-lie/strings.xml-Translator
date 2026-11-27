import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useDialog } from '../utils/useDialog';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clipboard,
  Cpu,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  TranslationProviderConfig,
  ProviderEngineType,
  ProviderTestResult,
  getAllTranslationProviders,
  GTX_STATUS_EVENT,
  gtxLooksUnavailable,
  getActiveProviderId,
  setActiveProviderId,
  updateCustomProvider,
  removeCustomProvider,
} from '../utils/translator';
import { useKeyTest } from './providers/useKeyTest';
import { AddProviderForm } from './providers/AddProviderForm';
import { inferEngineFromName } from './providers/engineInference';
import { testErrorText as testErrorTextFor } from './providers/testErrorText';
import { ActiveProviderControls } from './providers/ActiveProviderControls';
import { useT, tg } from '../i18n/i18n';
import { readClipboardText } from './SecretField';
import { textDirection } from '../utils/direction';
import { getProviderRuntimeErrorsSnapshot, subscribeModelLists } from '../utils/providerModels';

export function getProviderDisplayName(prov: TranslationProviderConfig | undefined, isAr: boolean): string {
  if (!prov) return tg('google_translate');
  if (!isAr || !prov.isBuiltIn) return prov.name;
  if (prov.id === 'google') return 'ترجمة جوجل';
  if (prov.id === 'mymemory') return 'ذاكرة الترجمة (MyMemory)';
  return prov.name;
}

interface ProvidersPanelProps {
  isAr: boolean;
  /** Called after providers are added, edited, removed or the active one changes */
  onChanged: () => void;
}

export const ProvidersPanel: React.FC<ProvidersPanelProps> = ({ isAr, onChanged }) => {
  const { t, tb } = useT();
  // Translation Providers state inside the sidebar
  const [providersPanelOpen, setProvidersPanelOpen] = useState(false);
  const [providersList, setProvidersList] = useState<TranslationProviderConfig[]>(() =>
    getAllTranslationProviders()
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => getActiveProviderId());

  // Add new API key form state
  const [showAddKeyForm, setShowAddKeyForm] = useState(false);

  // Confirm delete dialog state
  const [providerToDelete, setProviderToDelete] = useState<TranslationProviderConfig | null>(null);

  // Edit existing custom provider state
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editProviderName, setEditProviderName] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editApiSecret, setEditApiSecret] = useState('');
  const [editFolderId, setEditFolderId] = useState('');
  const editTest = useKeyTest();
  // The edited key that was verified valid; saving a changed key is allowed only for this exact value.
  const [editVerified, setEditVerified] = useState<{ sig: string; result: ProviderTestResult } | null>(null);
  const editNameInputRef = useRef<HTMLInputElement | null>(null);
  const editKeyInputRef = useRef<HTMLInputElement | null>(null);

  // Warn when the free Google engine keeps failing, since it relies on an unofficial endpoint.
  // The status is read on every render: it expires with time (no event fires for that), and the
  // panel re-renders when it opens, so the warning is current whenever it is visible.
  const [, setGtxStatusTick] = useState(0);
  useEffect(() => {
    const onChange = () => setGtxStatusTick((n) => n + 1);
    window.addEventListener(GTX_STATUS_EVENT, onChange);
    return () => window.removeEventListener(GTX_STATUS_EVENT, onChange);
  }, []);
  const gtxDown = gtxLooksUnavailable();

  const deleteDialogRef = useDialog(providerToDelete !== null, () => setProviderToDelete(null));

  const testErrorText = (result: ProviderTestResult) => testErrorTextFor(t, result);

  const refresh = () => {
    setProvidersList(getAllTranslationProviders());
    onChanged();
  };

  const handleSelectProvider = (id: string) => {
    setActiveProviderId(id);
    setSelectedProviderId(id);
    onChanged();
  };


  const handleStartEditProvider = (prov: TranslationProviderConfig) => {
    if (editingProviderId === prov.id) {
      setEditingProviderId(null);
      editTest.setResult(null);
      return;
    }
    setEditingProviderId(prov.id);
    setEditProviderName(prov.name);
    const savedKey = prov.apiKey || '';
    if (prov.type === 'lara' && savedKey.includes(':') && !savedKey.endsWith(':fx')) {
      const sepIdx = savedKey.indexOf(':');
      setEditApiKey(savedKey.slice(0, sepIdx));
      setEditApiSecret(savedKey.slice(sepIdx + 1));
    } else {
      setEditApiKey(savedKey);
      setEditApiSecret('');
    }
    setEditFolderId(prov.folderId || '');
    editTest.setResult(null);
    setTimeout(() => {
      editNameInputRef.current?.focus();
    }, 60);
  };

  // What the edit form would save, and whether it changes the stored key/folder.
  const resolveEditTarget = (prov: TranslationProviderConfig) => {
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
  const editingProv = editingProviderId ? providersList.find((p) => p.id === editingProviderId) : undefined;
  const editSig = editingProv ? resolveEditTarget(editingProv).sig : '';
  useEffect(() => {
    if (!editingProv) return;
    const target = resolveEditTarget(editingProv);
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
  }, [editingProviderId, editSig]);

  const handleSaveEditedProvider = async (
    e: React.FormEvent,
    prov: TranslationProviderConfig
  ) => {
    e.preventDefault();
    const { trimmedName, rawKey, targetEngine, combinedKey, editedFolderId, keyChanged, sig } =
      resolveEditTarget(prov);
    if (!rawKey) return;

    // If only the provider name was changed, save immediately without re-running network verification
    if (!keyChanged) {
      updateCustomProvider(prov.id, {
        name: trimmedName,
        type: targetEngine,
      });
      refresh();
      setEditingProviderId(null);
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
    setEditingProviderId(null);
    editTest.setResult(null);
    setEditVerified(null);
  };

  const handleConfirmDeleteProvider = () => {
    if (!providerToDelete) return;
    if (editingProviderId === providerToDelete.id) {
      setEditingProviderId(null);
    }
    removeCustomProvider(providerToDelete.id);
    refresh();
    setSelectedProviderId(getActiveProviderId());
    setProviderToDelete(null);
  };


  const activeProviderObj =
    providersList.find((p) => p.id === selectedProviderId) || providersList[0];
  const providerLabel = (prov?: TranslationProviderConfig) => getProviderDisplayName(prov, isAr);
  // Definite key/account problems (invalid key, exhausted quota) stick on the provider card.
  const providerRuntimeErrors = useSyncExternalStore(subscribeModelLists, getProviderRuntimeErrorsSnapshot);

  return (
    <>
        <div className="flex flex-col shrink-0 rounded-2xl border border-slate-200/90 dark:border-[#2F384B] bg-slate-50/70 dark:bg-[#1B212E] transition-all">
          <button
            id="drawer-translate-providers-btn"
            type="button"
            onClick={() => setProvidersPanelOpen((prev) => !prev)}
            className={`w-full flex items-center justify-between gap-2 px-4 py-3 ${
              providersPanelOpen ? 'rounded-t-2xl' : 'rounded-2xl'
            } bg-slate-100/90 hover:bg-slate-200/70 dark:bg-[#202634] dark:hover:bg-[#2A3244] text-slate-800 dark:text-slate-100 text-sm font-medium transition cursor-pointer text-left`}
          >
            <div className="flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden">
              <Cpu className="w-4 h-4 text-[#1EB996] shrink-0" />
              <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                <span data-i18n className="w-full text-xs sm:text-sm font-semibold truncate">
                  {t('translate_providers')}
                </span>
                <span className="w-full text-[11px] text-[#1EB996] font-medium truncate">
                  {providerLabel(activeProviderObj)}
                </span>
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${
                providersPanelOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {providersPanelOpen && (
            <div className="p-3 flex flex-col gap-3 border-t border-slate-200/80 dark:border-[#2A3244]">
              {gtxDown && (
                <p data-i18n
                  role="status"
                  className="text-[11px] leading-snug rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 py-2"
                >
                  {t('the_free_google_engine_is')}
                </p>
              )}

              {/* Providers Selection List */}
              <div className="flex flex-col gap-1.5">
                <span data-i18n className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 px-1">
                  {t('select_provider_for_suggest')}
                </span>

                <div className="flex flex-col gap-1.5 pe-0.5">
                  {providersList.map((prov) => {
                    const isSelected = prov.id === selectedProviderId;
                    const isEditing = editingProviderId === prov.id;
                    return (
                      <div
                        key={prov.id}
                        className={`flex flex-col rounded-xl px-2.5 py-2 border transition shrink-0 ${
                          isSelected
                            ? 'bg-[#1EB996]/12 border-[#1EB996]/50 text-slate-900 dark:text-white'
                            : 'bg-white/80 dark:bg-[#151A24] border-slate-200/70 dark:border-[#262E3E] text-slate-700 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-[#1E2534]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSelectProvider(prov.id)}
                            className="flex-1 flex items-center justify-between gap-2 text-start min-w-0 cursor-pointer"
                          >
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold truncate">
                                  {providerLabel(prov)}
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
                                  handleStartEditProvider(prov);
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
                                  setProviderToDelete(prov);
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

                        {providerRuntimeErrors.get(prov.id) && (
                          <div
                            className="flex items-center gap-1.5 mt-1.5 text-[10px] text-red-500 dark:text-red-400"
                          >
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>
                              {providerRuntimeErrors.get(prov.id)?.kind === 'expired-key'
                                ? t('provider_key_expired')
                                : providerRuntimeErrors.get(prov.id)?.kind === 'invalid-key'
                                  ? t('provider_key_invalid')
                                  : providerRuntimeErrors.get(prov.id)?.kind === 'quota-or-limit'
                                    ? t('provider_quota_or_limit')
                                    : t('provider_quota_exhausted')}
                            </span>
                          </div>
                        )}

                        {/* Inline Edit Form for Custom Provider Name & API Key */}
                        {!prov.isBuiltIn && isEditing && (
                          <form
                            onSubmit={(e) => handleSaveEditedProvider(e, prov)}
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
                                  setEditingProviderId(null);
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
                                    const target = resolveEditTarget(prov);
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
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Toggle Add Custom API Key Section */}
              <div className="pt-2 border-t border-slate-200/70 dark:border-[#262E3E] flex flex-col gap-2.5">
                <button
                  id="drawer-toggle-add-apikey-btn"
                  type="button"
                  onClick={() => setShowAddKeyForm((open) => !open)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-200/70 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2D374B] text-slate-800 dark:text-slate-200 text-xs font-semibold transition cursor-pointer shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#1EB996]" />
                  <span data-i18n>
                    {t('add_translator_api_key')}
                  </span>
                  <Plus
                    className={`w-3.5 h-3.5 transition-transform ${
                      showAddKeyForm ? 'rotate-45' : ''
                    }`}
                  />
                </button>

                <AddProviderForm open={showAddKeyForm} isAr={isAr} onAdded={(id) => { refresh(); setSelectedProviderId(id); }} />
              </div>
            </div>
          )}
        </div>

        {!providersPanelOpen && (
          <ActiveProviderControls activeProviderObj={activeProviderObj} refresh={refresh} />
        )}
      {providerToDelete && createPortal(
        (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-xs"
              onClick={() => setProviderToDelete(null)}
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
                      {providerToDelete.name}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setProviderToDelete(null)}
                  className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p data-i18n className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {t('are_you_sure_you_want', providerToDelete.name)}
              </p>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setProviderToDelete(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2E384B] text-slate-700 dark:text-slate-200 text-xs font-semibold transition cursor-pointer"
                >
                  {tb('cancel')}
                </button>
                <button
                  id="confirm-delete-provider-btn"
                  type="button"
                  onClick={handleConfirmDeleteProvider}
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition cursor-pointer shadow-xs"
                >
                  {tb('delete_2')}
                </button>
              </div>
            </div>
          </div>
        ),
        document.body
      )}
    </>
  );
};
