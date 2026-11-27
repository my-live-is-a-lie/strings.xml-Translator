import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Loader2, X } from 'lucide-react';
import { ENGINE_OPTIONS } from '../headerOptions';
import {
  ProviderEngineType,
  ProviderTestResult,
  addCustomProvider,
  updateCustomProvider,
  getCustomProviders,
} from '../../utils/translator';
import { sweepGeminiModels } from '../../utils/providerModels';
import { useT } from '../../i18n/i18n';
import { SecretField } from '../SecretField';
import { textDirection } from '../../utils/direction';
import { useKeyTest } from './useKeyTest';
import { inferEngineFromName } from './engineInference';
import { testErrorText as testErrorTextFor } from './testErrorText';

interface AddProviderFormProps {
  /** Whether the form is shown. It stays mounted when closed so typed values are kept */
  open: boolean;
  isAr: boolean;
  /** Called after a provider is added, with its id */
  onAdded: (id: string) => void;
}

/** The "add translator API key" form: pick an engine, verify the key, add the provider. */
export const AddProviderForm: React.FC<AddProviderFormProps> = ({ open, isAr, onAdded }) => {
  const { t, tb } = useT();
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderEngine, setNewProviderEngine] = useState<string>('auto');
  const [newApiKey, setNewApiKey] = useState('');
  const [newApiSecret, setNewApiSecret] = useState('');
  const [newFolderId, setNewFolderId] = useState('');
  const addTest = useKeyTest();
  const addKeyFormRef = useRef<HTMLFormElement | null>(null);
  const providerNameInputRef = useRef<HTMLInputElement | null>(null);
  const testErrorText = (result: ProviderTestResult) => testErrorTextFor(t, result);

  // Opening or closing the form clears the last test result; opening also scrolls it into view.
  useEffect(() => {
    addTest.setResult(null);
    if (!open) return;
    const timer = setTimeout(() => {
      addKeyFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
    return () => clearTimeout(timer);
    // setResult is a stable state setter; only the open flag should rerun this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The "key works, provider added" box goes away by itself after 5 seconds.
  useEffect(() => {
    if (!addTest.result || !(addTest.result.success && addTest.result.matched)) return;
    const timer = window.setTimeout(() => addTest.setResult(null), 5000);
    return () => window.clearTimeout(timer);
    // setResult is a stable state setter; only a new result should restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTest.result]);

  const handleTestAndAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    const pendingEngine = inferEngineFromName(newProviderName, newProviderEngine);
    if (!newApiKey.trim() && pendingEngine !== 'libretranslate') return;

    addTest.setResult(null);

    const effectiveEngine = inferEngineFromName(newProviderName, newProviderEngine);
    const rawKey = newApiKey.trim() || (effectiveEngine === 'libretranslate' ? 'none' : '');
    const rawSecret = newApiSecret.trim();
    const combinedApiKey =
      effectiveEngine === 'lara' && rawSecret && !rawKey.includes(':')
        ? `${rawKey}:${rawSecret}`
        : rawKey;

    const folderId = newFolderId.trim();
    const result = await addTest.run(effectiveEngine, combinedApiKey, folderId);
    if (!result) return; // cancelled: the user already moved on

    if (result.success && result.matched) {
      const detectedType: ProviderEngineType =
        result.detectedType ||
        (effectiveEngine !== 'auto' ? (effectiveEngine as ProviderEngineType) : 'yandex');

      const defaultNameMap: Record<string, string> = {
        lara: 'Lara Translate',
        yandex: 'Yandex Cloud Translate',
        deepl: 'DeepL API',
        gemini: 'Gemini API',
        openai: 'OpenAI API',
        google_cloud: 'Google Cloud',
        libretranslate: 'LibreTranslate',
        microsoft: 'Microsoft Azure Translator',
      };

      const finalName =
        newProviderName.trim() || defaultNameMap[detectedType] || 'Custom API';

      const added = addCustomProvider({
        name: finalName,
        type: detectedType,
        apiKey: combinedApiKey,
        folderId: detectedType === 'yandex' || detectedType === 'libretranslate' ? folderId : undefined,
      });

      // The verification already found a model that answers on this plan: make it the default
      // so the first real translation does not start by failing on a quota-limited one.
      if (result.workingModel) {
        updateCustomProvider(added.id, { model: result.workingModel });
      }

      // Then quietly test every discovered model in the background (one bare 2s attempt each):
      // plan-limited and unusable models land in their picker groups, passes float to the top.
      if (detectedType === 'gemini') {
        void sweepGeminiModels(combinedApiKey, () => getCustomProviders().some((p) => p.id === added.id));
      }

      onAdded(added.id);
      setNewProviderName('');
      setNewApiKey('');
      setNewApiSecret('');
      setNewFolderId('');
    }
  };

  if (!open) return null;
  return (
                  <form
                    ref={addKeyFormRef}
                    onSubmit={handleTestAndAddProvider}
                    className="flex flex-col gap-3 p-3 rounded-xl bg-white dark:bg-[#141821] border border-slate-200/80 dark:border-[#283142]"
                  >
                    {/* Provider Custom Name Input (Typable) */}
                    <div className="flex flex-col gap-1.5">
                      <label data-i18n
                        htmlFor="provider-custom-name-input"
                        className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                      >
                        {t('provider_name_type_or_swipe')}
                      </label>
                      <div
                        className="relative flex items-center"
                        dir={textDirection(newProviderName)}
                      >
                        <input
                          ref={providerNameInputRef}
                          id="provider-custom-name-input"
                          type="text"
                          autoComplete="off"
                          dir={textDirection(newProviderName)}
                          value={newProviderName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewProviderName(val);
                            const inferred = inferEngineFromName(val, 'auto');
                            if (inferred !== 'auto') {
                              setNewProviderEngine(inferred);
                            }
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          placeholder={
                            t('type_provider_name_e_g')
                          }
                          className="w-full px-3 pe-9 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                        />
                        {newProviderName && (
                          <button
                            type="button"
                            onClick={() => {
                              setNewProviderName('');
                              providerNameInputRef.current?.focus();
                            }}
                            className="absolute end-2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                            aria-label="Clear provider name"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Swipeable / Scrollable Provider Engine List */}
                    <div className="flex flex-col gap-1.5">
                      <div
                        id="provider-swipe-list"
                        onTouchMove={(e) => e.stopPropagation()}
                        className="flex flex-col gap-1 max-h-36 overflow-y-auto overscroll-contain touch-pan-y p-1.5 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-200 dark:border-[#2E384D]"
                      >
                        {ENGINE_OPTIONS.map((opt) => {
                          const isSelectedEngine = newProviderEngine === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                setNewProviderEngine(opt.value);
                                if (opt.value !== 'auto') {
                                  const presetName = isAr ? opt.nameAr : opt.nameEn;
                                  if (presetName) {
                                    setNewProviderName(presetName);
                                  }
                                }
                              }}
                              className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs text-start transition cursor-pointer shrink-0 ${
                                isSelectedEngine
                                  ? 'bg-[#1EB996]/15 text-[#1EB996] font-semibold border border-[#1EB996]/40'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#252E40]'
                              }`}
                            >
                              <span className="truncate">{isAr ? opt.labelAr : opt.labelEn}</span>
                              {isSelectedEngine && <Check className="w-3.5 h-3.5 text-[#1EB996] shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* API Key Input */}
                    <SecretField
                      id="provider-api-key-input"
                      label={
                        inferEngineFromName(newProviderName, newProviderEngine) === 'lara'
                          ? t('lara_access_key_id_or')
                          : t('translator_api_key')
                      }
                      value={newApiKey}
                      onChange={(v) => {
                        addTest.cancel();
                        setNewApiKey(v);
                      }}
                      placeholder={
                        inferEngineFromName(newProviderName, newProviderEngine) === 'lara'
                          ? t('paste_access_key_id_or')
                          : t('paste_api_key_here')
                      }
                      required
                    />

                    {/* Optional Lara Access Key Secret Input when Lara Translate is selected */}
                    {inferEngineFromName(newProviderName, newProviderEngine) === 'lara' && (
                      <SecretField
                        id="provider-api-secret-input"
                        label={t('lara_access_key_secret')}
                        value={newApiSecret}
                        onChange={setNewApiSecret}
                        placeholder={t('paste_access_key_secret_optional')}
                      />
                    )}

                    {/* Where the key is kept; the user should restrict it in the provider's console */}
                    <p data-i18n className="text-[10px] leading-snug text-slate-600 dark:text-slate-400">
                      {t('keys_are_encrypted_on_this')}
                    </p>

                    {/* LibreTranslate: the instance to use (self-hosted or public) */}
                    {inferEngineFromName(newProviderName, newProviderEngine) === 'libretranslate' && (
                      <div className="flex flex-col gap-1.5">
                        <label data-i18n
                          htmlFor="provider-server-url-input"
                          className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          {t('server_url')}
                        </label>
                        <input
                          id="provider-server-url-input"
                          type="url"
                          dir="ltr"
                          autoComplete="off"
                          value={newFolderId}
                          onChange={(e) => setNewFolderId(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          placeholder="https://libretranslate.example.com"
                          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                        />
                        <p data-i18n className="text-[10px] leading-snug text-slate-600 dark:text-slate-400">
                          {t('must_start_with_https_the')}
                        </p>
                      </div>
                    )}

                    {/* Yandex Cloud folder ID: needed with an IAM token (personal account) */}
                    {(inferEngineFromName(newProviderName, newProviderEngine) === 'yandex' ||
                      newApiKey.trim().startsWith('t1.')) && (
                      <div className="flex flex-col gap-1.5">
                        <label data-i18n
                          htmlFor="provider-folder-id-input"
                          className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          {t('folder_id')}
                        </label>
                        <input
                          id="provider-folder-id-input"
                          type="text"
                          dir="ltr"
                          autoComplete="off"
                          value={newFolderId}
                          onChange={(e) => setNewFolderId(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          placeholder="b1g..."
                          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                        />
                        <p data-i18n className="text-[10px] leading-snug text-slate-600 dark:text-slate-400">
                          {t('required_with_an_iam_token')}
                        </p>
                      </div>
                    )}

                    {/* Submit / Verify Key Button */}
                    <button
                      id="provider-verify-add-btn"
                      type="submit"
                      disabled={
                        addTest.running ||
                        (!newApiKey.trim() && inferEngineFromName(newProviderName, newProviderEngine) !== 'libretranslate')
                      }
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#1EB996] hover:bg-[#19A585] disabled:opacity-50 text-white text-xs font-semibold transition cursor-pointer shadow-xs shrink-0"
                    >
                      {addTest.running ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span data-i18n>
                            {t('testing_comparing_with_google')}
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span data-i18n>
                            {t('verify_add_to_providers')}
                          </span>
                        </>
                      )}
                    </button>

                    {/* Stop a stuck verification instead of waiting it out */}
                    {addTest.running && (
                      <button
                        id="provider-verify-cancel-btn"
                        type="button"
                        onClick={() => addTest.cancel()}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-semibold transition cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span data-i18n>{tb('cancel')}</span>
                      </button>
                    )}

                    {/* Verification & Google Comparison Result Box */}
                    {addTest.result && (
                      <div
                        className={`p-2.5 rounded-lg border text-[11px] flex flex-col gap-1.5 ${
                          addTest.result.success && addTest.result.matched
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-semibold">
                          {addTest.result.success && addTest.result.matched ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span data-i18n>
                                {addTest.result.modelsQuotaLimited || addTest.result.noWorkingModel
                                  ? t('api_key_works_no_models')
                                  : addTest.result.translationUnverified
                                    ? t('api_key_works')
                                    : t('api_key_works_translation_matched')}
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              <span data-i18n>
                                {t('api_key_verification_failed')}
                              </span>
                            </>
                          )}
                        </div>

                        {addTest.result.testSource && (
                          <div className="text-[10px] space-y-0.5 text-slate-600 dark:text-slate-300 bg-black/5 dark:bg-black/25 p-1.5 rounded">
                            <div>
                              <span data-i18n className="opacity-70">
                                {t('test')}
                              </span>
                              <span className="font-mono">{addTest.result.testSource}</span>
                            </div>
                            {addTest.result.googleTranslation && (
                              <div>
                                <span data-i18n className="opacity-70">
                                  {t('google_translate_2')}
                                </span>
                                <span className="font-semibold">
                                  {addTest.result.googleTranslation}
                                </span>
                              </div>
                            )}
                            {addTest.result.providerTranslation && (
                              <div>
                                <span data-i18n className="opacity-70">
                                  {t('provider')}
                                </span>
                                <span className="font-semibold">
                                  {addTest.result.providerTranslation}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {addTest.result.error && (
                          <p className="text-[10px] leading-snug opacity-90">
                            {testErrorText(addTest.result)}
                          </p>
                        )}
                      </div>
                    )}
                  </form>
  );
};
