import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, CheckCircle2, ChevronDown, Cpu, KeyRound, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ENGINE_OPTIONS } from './headerOptions';
import { testGeminiKeyDirect } from '../utils/geminiDirect';
import {
  TranslationProviderConfig,
  ProviderEngineType,
  ProviderTestResult,
  getAllTranslationProviders,
  GTX_STATUS_EVENT,
  gtxLooksUnavailable,
  getActiveProviderId,
  setActiveProviderId,
  addCustomProvider,
  updateCustomProvider,
  removeCustomProvider,
  testProviderApiKey,
} from '../utils/translator';

export function getProviderDisplayName(prov: TranslationProviderConfig | undefined, isAr: boolean): string {
  if (!prov) return isAr ? 'ترجمة جوجل' : 'Google Translate';
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
  // Translation Providers state inside the sidebar
  const [providersPanelOpen, setProvidersPanelOpen] = useState(false);
  const [providersList, setProvidersList] = useState<TranslationProviderConfig[]>(() =>
    getAllTranslationProviders()
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => getActiveProviderId());

  // Add new API key form state
  const [showAddKeyForm, setShowAddKeyForm] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderEngine, setNewProviderEngine] = useState<string>('auto');
  const [newApiKey, setNewApiKey] = useState('');
  const [newApiSecret, setNewApiSecret] = useState('');
  const [newFolderId, setNewFolderId] = useState('');
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const addKeyFormRef = useRef<HTMLFormElement | null>(null);
  const providerNameInputRef = useRef<HTMLInputElement | null>(null);

  // Confirm delete dialog state
  const [providerToDelete, setProviderToDelete] = useState<TranslationProviderConfig | null>(null);

  // Edit existing custom provider state
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editProviderName, setEditProviderName] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editApiSecret, setEditApiSecret] = useState('');
  const [editFolderId, setEditFolderId] = useState('');
  const [isTestingEditKey, setIsTestingEditKey] = useState(false);
  const [editTestResult, setEditTestResult] = useState<ProviderTestResult | null>(null);
  const editNameInputRef = useRef<HTMLInputElement | null>(null);

  // Warn when the free Google engine keeps failing, since it relies on an unofficial endpoint
  const [gtxDown, setGtxDown] = useState(() => gtxLooksUnavailable());
  useEffect(() => {
    const onChange = () => setGtxDown(gtxLooksUnavailable());
    window.addEventListener(GTX_STATUS_EVENT, onChange);
    return () => window.removeEventListener(GTX_STATUS_EVENT, onChange);
  }, []);

  const refresh = () => {
    setProvidersList(getAllTranslationProviders());
    onChanged();
  };

  const handleSelectProvider = (id: string) => {
    setActiveProviderId(id);
    setSelectedProviderId(id);
    onChanged();
  };

  const inferEngineFromName = (typedName: string, selectedEngine: string): string => {
    if (selectedEngine && selectedEngine !== 'auto') return selectedEngine;
    const lower = typedName.trim().toLowerCase();
    if (lower.includes('libre') || lower.includes('ليبر')) return 'libretranslate';
    if (lower.includes('lara') || lower.includes('لارا') || lower.includes('translated')) return 'lara';
    if (lower.includes('yandex') || lower.includes('ياندكس')) return 'yandex';
    if (lower.includes('deepl') || lower.includes('ديب')) return 'deepl';
    if (lower.includes('gemini') || lower.includes('جيميني')) return 'gemini';
    if (lower.includes('openai') || lower.includes('gpt') || lower.includes('chatgpt')) return 'openai';
    if (lower.includes('microsoft') || lower.includes('azure') || lower.includes('bing')) return 'microsoft';
    if (lower.includes('google') || lower.includes('جوجل')) return 'google_cloud';
    return 'auto';
  };

  // Gemini keys are verified straight from the browser; every other provider goes through the server
  const testEngineKey = (
    engine: string,
    key: string,
    folderId?: string
  ): Promise<ProviderTestResult> =>
    engine === 'gemini' ? testGeminiKeyDirect(key) : testProviderApiKey(engine, key, folderId);

  const handleTestAndAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    const pendingEngine = inferEngineFromName(newProviderName, newProviderEngine);
    if (!newApiKey.trim() && pendingEngine !== 'libretranslate') return;

    setIsTestingKey(true);
    setTestResult(null);

    const effectiveEngine = inferEngineFromName(newProviderName, newProviderEngine);
    const rawKey = newApiKey.trim() || (effectiveEngine === 'libretranslate' ? 'none' : '');
    const rawSecret = newApiSecret.trim();
    const combinedApiKey =
      effectiveEngine === 'lara' && rawSecret && !rawKey.includes(':')
        ? `${rawKey}:${rawSecret}`
        : rawKey;

    const folderId = newFolderId.trim();
    const result = await testEngineKey(effectiveEngine, combinedApiKey, folderId);
    setIsTestingKey(false);
    setTestResult(result);

    if (result.success && result.matched) {
      const detectedType: ProviderEngineType =
        result.detectedType ||
        (effectiveEngine !== 'auto' ? (effectiveEngine as ProviderEngineType) : 'yandex');

      const defaultNameMap: Record<string, string> = {
        lara: 'Lara Translate',
        yandex: 'Yandex AI',
        deepl: 'DeepL',
        gemini: 'Gemini AI',
        openai: 'OpenAI GPT',
        google_cloud: 'Google Cloud',
        microsoft: 'Microsoft Translator',
      };

      const finalName =
        newProviderName.trim() || `${defaultNameMap[detectedType] || 'Custom'} API`;

      const added = addCustomProvider({
        name: finalName,
        type: detectedType,
        apiKey: combinedApiKey,
        folderId: detectedType === 'yandex' || detectedType === 'libretranslate' ? folderId : undefined,
      });

      refresh();
      setSelectedProviderId(added.id);
      setNewProviderName('');
      setNewApiKey('');
      setNewApiSecret('');
      setNewFolderId('');
    }
  };

  const handleStartEditProvider = (prov: TranslationProviderConfig) => {
    if (editingProviderId === prov.id) {
      setEditingProviderId(null);
      setEditTestResult(null);
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
    setEditTestResult(null);
    setTimeout(() => {
      editNameInputRef.current?.focus();
    }, 60);
  };

  const handleSaveEditedProvider = async (
    e: React.FormEvent,
    prov: TranslationProviderConfig
  ) => {
    e.preventDefault();
    const trimmedName = editProviderName.trim() || prov.name;
    const rawKey = editApiKey.trim() || (prov.type === 'libretranslate' ? 'none' : '');
    const rawSecret = editApiSecret.trim();
    if (!rawKey) return;

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

    // If only the provider name was changed, save immediately without re-running network verification
    if (!keyChanged) {
      updateCustomProvider(prov.id, {
        name: trimmedName,
        type: targetEngine,
      });
      refresh();
      setEditingProviderId(null);
      setEditTestResult(null);
      return;
    }

    // If the API key was modified, verify the new API key against Google Translate first
    setIsTestingEditKey(true);
    setEditTestResult(null);

    const result = await testEngineKey(targetEngine, combinedKey, editedFolderId);
    setIsTestingEditKey(false);
    setEditTestResult(result);

    if (result.success && result.matched) {
      const detectedType: ProviderEngineType = result.detectedType || targetEngine;
      updateCustomProvider(prov.id, {
        name: trimmedName,
        apiKey: combinedKey,
        type: detectedType,
        folderId: detectedType === 'yandex' || detectedType === 'libretranslate' ? editedFolderId : '',
      });
      refresh();
      setEditingProviderId(null);
      setEditTestResult(null);
    }
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
                <span className="w-full text-xs sm:text-sm font-semibold truncate">
                  {isAr ? 'مزودو الترجمة الآلية' : 'Translate Providers'}
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
                <p
                  role="status"
                  className="text-[11px] leading-snug rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 py-2"
                >
                  {isAr
                    ? 'محرك جوجل المجاني لا يستجيب حالياً. أضف مزوداً بمفتاح أو خادم LibreTranslate لضمان استمرار الترجمة.'
                    : 'The free Google engine is not responding. Add a provider with a key, or a LibreTranslate server, to keep translating.'}
                </p>
              )}

              {/* Providers Selection List */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                  {isAr ? 'اختر مزود الترجمة لزر الاقتراح' : 'Select Provider for Suggest'}
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
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                                {prov.type === 'lara'
                                  ? isAr
                                    ? 'محرك Lara الذكي للترجمة'
                                    : 'Lara Translate AI'
                                  : prov.type === 'yandex'
                                    ? isAr
                                      ? 'محرك Yandex الذكي'
                                      : 'Yandex AI Translator'
                                    : prov.type === 'gemini'
                                      ? isAr
                                        ? 'محرك ذكاء Gemini الاصطناعي'
                                        : 'Gemini AI Engine'
                                      : prov.type === 'google' || prov.type === 'google_cloud'
                                        ? isAr
                                          ? 'الترجمة العصبية من جوجل'
                                          : 'Google Neural Translate'
                                        : prov.type === 'deepl'
                                          ? isAr
                                            ? 'الترجمة العصبية من DeepL'
                                            : 'DeepL Neural MT'
                                          : prov.type === 'openai'
                                            ? isAr
                                              ? 'مترجم OpenAI GPT الذكي'
                                              : 'OpenAI GPT Translator'
                                            : prov.type === 'microsoft'
                                              ? isAr
                                                ? 'مترجم Microsoft Azure'
                                                : 'Microsoft Azure MT'
                                              : isAr
                                                ? 'ذاكرة الترجمة التشاركية'
                                                : 'MyMemory TM'}
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
                                title={isAr ? 'تعديل الاسم أو مفتاح API' : 'Edit name or API key'}
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
                                title={isAr ? 'حذف مزود الترجمة' : 'Delete provider'}
                                aria-label={`Delete ${prov.name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Inline Edit Form for Custom Provider Name & API Key */}
                        {!prov.isBuiltIn && isEditing && (
                          <form
                            onSubmit={(e) => handleSaveEditedProvider(e, prov)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-2.5 pt-2.5 border-t border-slate-200/80 dark:border-[#262E3E] flex flex-col gap-2.5"
                          >
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                {isAr ? 'تعديل اسم المزود' : 'Edit Provider Name'}
                              </label>
                              <div className="relative flex items-center">
                                <input
                                  ref={editNameInputRef}
                                  type="text"
                                  autoComplete="off"
                                  value={editProviderName}
                                  onChange={(e) => setEditProviderName(e.target.value)}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  placeholder={isAr ? 'اسم المزود...' : 'Provider name...'}
                                  required
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
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
                                  ? isAr
                                    ? 'معرّف مفتاح Lara (أو المعرّف:السر)'
                                    : 'Lara Access Key ID (or ID:Secret)'
                                  : isAr
                                    ? 'تعديل مفتاح API'
                                    : 'Edit API Key'}
                              </label>
                              <input
                                type="text"
                                autoComplete="off"
                                value={editApiKey}
                                onChange={(e) => setEditApiKey(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                placeholder={
                                  prov.type === 'lara' ||
                                  inferEngineFromName(editProviderName, 'auto') === 'lara'
                                    ? isAr
                                      ? 'معرّف المفتاح (أو المعرّف:السر)...'
                                      : 'Access Key ID (or ID:Secret)...'
                                    : isAr
                                      ? 'مفتاح API...'
                                      : 'API Key...'
                                }
                                required
                                className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                              />
                            </div>

                            {(prov.type === 'lara' ||
                              inferEngineFromName(editProviderName, 'auto') === 'lara') && (
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                  {isAr
                                    ? 'السر الخاص بمفتاح Lara'
                                    : 'Lara Access Key Secret'}
                                </label>
                                <input
                                  type="text"
                                  autoComplete="off"
                                  value={editApiSecret}
                                  onChange={(e) => setEditApiSecret(e.target.value)}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  placeholder={
                                    isAr
                                      ? 'السر الخاص بالمفتاح (اختياري إذا كان مدمجاً أعلاه)...'
                                      : 'Access Key Secret (optional if ID:Secret above)...'
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                                />
                              </div>
                            )}

                            {prov.type === 'libretranslate' && (
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                  {isAr ? 'عنوان الخادم' : 'Server URL'}
                                </label>
                                <input
                                  type="url"
                                  dir="ltr"
                                  autoComplete="off"
                                  value={editFolderId}
                                  onChange={(e) => setEditFolderId(e.target.value)}
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
                                <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                  {isAr ? 'معرّف المجلد (Folder ID)' : 'Folder ID'}
                                </label>
                                <input
                                  type="text"
                                  dir="ltr"
                                  autoComplete="off"
                                  value={editFolderId}
                                  onChange={(e) => setEditFolderId(e.target.value)}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  placeholder={
                                    isAr
                                      ? 'b1g... (مع رمز IAM لحساب شخصي)'
                                      : 'b1g... (with a personal-account IAM token)'
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                                />
                              </div>
                            )}

                            {editTestResult && !editTestResult.matched && (
                              <div className="p-2 rounded-lg border bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300 text-[10px] flex flex-col gap-1">
                                <div className="flex items-center gap-1 font-semibold">
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                  <span>
                                    {isAr
                                      ? 'فشل التحقق من مفتاح API الجديد'
                                      : 'New API key verification failed'}
                                  </span>
                                </div>
                                {editTestResult.error && (
                                  <p className="opacity-90 leading-snug">{editTestResult.error}</p>
                                )}
                              </div>
                            )}

                            <div className="flex items-center justify-end gap-1.5 pt-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingProviderId(null);
                                  setEditTestResult(null);
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-200/70 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2E384B] text-slate-700 dark:text-slate-200 text-[11px] font-semibold transition cursor-pointer"
                              >
                                {isAr ? 'إلغاء' : 'Cancel'}
                              </button>
                              <button
                                type="submit"
                                disabled={
                                  isTestingEditKey ||
                                  !editProviderName.trim() ||
                                  (!editApiKey.trim() && prov.type !== 'libretranslate')
                                }
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1EB996] hover:bg-[#19A585] disabled:opacity-50 text-white text-[11px] font-semibold transition cursor-pointer shadow-xs"
                              >
                                {isTestingEditKey ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span>{isAr ? 'جاري الفحص...' : 'Verifying...'}</span>
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-3 h-3" />
                                    <span>{isAr ? 'حفظ التعديلات' : 'Save Changes'}</span>
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
                  onClick={() => {
                    const nextOpen = !showAddKeyForm;
                    setShowAddKeyForm(nextOpen);
                    setTestResult(null);
                    if (nextOpen) {
                      setTimeout(() => {
                        addKeyFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }, 80);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-200/70 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2D374B] text-slate-800 dark:text-slate-200 text-xs font-semibold transition cursor-pointer shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#1EB996]" />
                  <span>
                    {isAr ? 'إضافة مفتاح API لمزود ترجمة' : 'Add Translator API Key'}
                  </span>
                  <Plus
                    className={`w-3.5 h-3.5 transition-transform ${
                      showAddKeyForm ? 'rotate-45' : ''
                    }`}
                  />
                </button>

                {showAddKeyForm && (
                  <form
                    ref={addKeyFormRef}
                    onSubmit={handleTestAndAddProvider}
                    className="flex flex-col gap-3 p-3 rounded-xl bg-white dark:bg-[#141821] border border-slate-200/80 dark:border-[#283142]"
                  >
                    {/* Provider Custom Name Input (Typable) */}
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="provider-custom-name-input"
                        className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                      >
                        {isAr ? 'اسم المزود (اكتب الاسم أو اختر من القائمة أدناه)' : 'Provider Name (Type or swipe list below)'}
                      </label>
                      <div className="relative flex items-center">
                        <input
                          ref={providerNameInputRef}
                          id="provider-custom-name-input"
                          type="text"
                          autoComplete="off"
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
                            isAr ? 'اكتب اسم المزود (مثال: Yandex AI)...' : 'Type provider name (e.g. Yandex AI)...'
                          }
                          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
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
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        {isAr ? 'اسحب القائمة لاختيار نوع المزود:' : 'Swipe list to choose provider engine:'}
                      </span>
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
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="provider-api-key-input"
                        className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                      >
                        {inferEngineFromName(newProviderName, newProviderEngine) === 'lara'
                          ? isAr
                            ? 'معرّف مفتاح Lara (أو المعرّف:السر)'
                            : 'Lara Access Key ID (or ID:Secret)'
                          : isAr
                            ? 'مفتاح API للمزود'
                            : 'Translator API Key'}
                      </label>
                      <input
                        id="provider-api-key-input"
                        type="text"
                        autoComplete="off"
                        value={newApiKey}
                        onChange={(e) => setNewApiKey(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        placeholder={
                          inferEngineFromName(newProviderName, newProviderEngine) === 'lara'
                            ? isAr
                              ? 'الصق معرّف المفتاح (أو المعرّف:السر)...'
                              : 'Paste Access Key ID (or ID:Secret)...'
                            : isAr
                              ? 'الصق مفتاح API هنا...'
                              : 'Paste API key here...'
                        }
                        required
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                      />
                    </div>

                    {/* Optional Lara Access Key Secret Input when Lara Translate is selected */}
                    {inferEngineFromName(newProviderName, newProviderEngine) === 'lara' && (
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="provider-api-secret-input"
                          className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          {isAr
                            ? 'السر الخاص بمفتاح Lara'
                            : 'Lara Access Key Secret'}
                        </label>
                        <input
                          id="provider-api-secret-input"
                          type="text"
                          autoComplete="off"
                          value={newApiSecret}
                          onChange={(e) => setNewApiSecret(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          placeholder={
                            isAr
                              ? 'الصق السر الخاص بالمفتاح (اختياري إذا كتبت المعرّف:السر أعلاه)...'
                              : 'Paste Access Key Secret (optional if ID:Secret above)...'
                          }
                          className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996]"
                        />
                      </div>
                    )}

                    {/* Where the key is kept; the user should restrict it in the provider's console */}
                    <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                      {isAr
                        ? 'تُحفظ المفاتيح مشفّرة على هذا الجهاز فقط، ولا تُرسل إلا إلى المزود الذي تختاره. ينصح بتقييد المفتاح من لوحة تحكم المزود.'
                        : 'Keys are encrypted on this device and sent only to the provider you choose. Restrict the key in your provider console.'}
                    </p>

                    {/* LibreTranslate: the instance to use (self-hosted or public) */}
                    {inferEngineFromName(newProviderName, newProviderEngine) === 'libretranslate' && (
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="provider-server-url-input"
                          className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          {isAr ? 'عنوان الخادم' : 'Server URL'}
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
                        <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                          {isAr
                            ? 'يجب أن يبدأ بـ https. مفتاح API اختياري: اتركه فارغاً إذا كان الخادم لا يطلبه.'
                            : 'Must start with https. The API key is optional: leave it empty if the server does not require one.'}
                        </p>
                      </div>
                    )}

                    {/* Yandex Cloud folder ID: needed with an IAM token (personal account) */}
                    {(inferEngineFromName(newProviderName, newProviderEngine) === 'yandex' ||
                      newApiKey.trim().startsWith('t1.')) && (
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="provider-folder-id-input"
                          className="text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                        >
                          {isAr ? 'معرّف المجلد (Folder ID)' : 'Folder ID'}
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
                        <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                          {isAr
                            ? 'مطلوب مع رمز IAM لحساب Yandex شخصي. الرمز يبدأ بـ t1 وصلاحيته 12 ساعة كحد أقصى. غير مطلوب مع مفتاح API لحساب خدمة.'
                            : 'Required with an IAM token from a personal Yandex account (starts with t1., valid for at most 12 hours). Not needed with a service-account API key.'}
                        </p>
                      </div>
                    )}

                    {/* Submit / Verify Key Button */}
                    <button
                      id="provider-verify-add-btn"
                      type="submit"
                      disabled={
                        isTestingKey ||
                        (!newApiKey.trim() && inferEngineFromName(newProviderName, newProviderEngine) !== 'libretranslate')
                      }
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#1EB996] hover:bg-[#19A585] disabled:opacity-50 text-white text-xs font-semibold transition cursor-pointer shadow-xs shrink-0"
                    >
                      {isTestingKey ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>
                            {isAr
                              ? 'جاري الاختبار والمقارنة مع Google...'
                              : 'Testing & comparing with Google...'}
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            {isAr
                              ? 'فحص المفتاح وإضافته للمزودين'
                              : 'Verify & Add to Providers'}
                          </span>
                        </>
                      )}
                    </button>

                    {/* Verification & Google Comparison Result Box */}
                    {testResult && (
                      <div
                        className={`p-2.5 rounded-lg border text-[11px] flex flex-col gap-1.5 ${
                          testResult.success && testResult.matched
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                            : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-semibold">
                          {testResult.success && testResult.matched ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span>
                                {isAr
                                  ? 'المفتاح يعمل! تطابقت الترجمة وتمت الإضافة'
                                  : 'API Key works! Translation matched & added'}
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              <span>
                                {isAr
                                  ? 'فشل التحقق من المفتاح'
                                  : 'API Key verification failed'}
                              </span>
                            </>
                          )}
                        </div>

                        {testResult.testSource && (
                          <div className="text-[10px] space-y-0.5 text-slate-600 dark:text-slate-300 bg-black/5 dark:bg-black/25 p-1.5 rounded">
                            <div>
                              <span className="opacity-70">
                                {isAr ? 'نص الاختبار: ' : 'Test: '}
                              </span>
                              <span className="font-mono">{testResult.testSource}</span>
                            </div>
                            {testResult.googleTranslation && (
                              <div>
                                <span className="opacity-70">
                                  {isAr ? 'ترجمة جوجل: ' : 'Google Translate: '}
                                </span>
                                <span className="font-semibold">
                                  {testResult.googleTranslation}
                                </span>
                              </div>
                            )}
                            {testResult.providerTranslation && (
                              <div>
                                <span className="opacity-70">
                                  {isAr ? 'ترجمة المزود: ' : 'Provider: '}
                                </span>
                                <span className="font-semibold">
                                  {testResult.providerTranslation}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {testResult.error && (
                          <p className="text-[10px] leading-snug opacity-90">
                            {testResult.error}
                          </p>
                        )}
                      </div>
                    )}
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      {providerToDelete && createPortal(
        (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-xs"
              onClick={() => setProviderToDelete(null)}
            />
            <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white dark:bg-[#1B212E] border border-slate-200 dark:border-[#2F384B] p-5 shadow-2xl flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 shrink-0">
                    <Trash2 className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {isAr ? 'حذف مزود الترجمة؟' : 'Delete Translation Provider?'}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {isAr
                  ? `هل أنت متأكد أنك تريد حذف "${providerToDelete.name}" ومفتاح API المرتبط به من قائمة مزودي الترجمة؟`
                  : `Are you sure you want to remove "${providerToDelete.name}" and its API key from your translation providers list?`}
              </p>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setProviderToDelete(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2E384B] text-slate-700 dark:text-slate-200 text-xs font-semibold transition cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  id="confirm-delete-provider-btn"
                  type="button"
                  onClick={handleConfirmDeleteProvider}
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition cursor-pointer shadow-xs"
                >
                  {isAr ? 'تأكيد الحذف' : 'Delete'}
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
