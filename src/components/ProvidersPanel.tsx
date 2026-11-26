import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDialog } from '../utils/useDialog';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, CheckCircle2, ChevronDown, Clipboard, Cpu, KeyRound, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ENGINE_OPTIONS } from './headerOptions';
import { testGeminiKeyDirect, looksLikeGeminiKey } from '../utils/geminiDirect';
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
import { useT, tg } from '../i18n/i18n';
import { SecretField, readClipboardText } from './SecretField';
import { textDirection } from '../utils/direction';
import {
  getModelProbeSnapshot,
  getModelProbeStatesVersion,
  getProviderModelsSnapshot,
  getProviderRuntimeErrorsSnapshot,
  noteModelProbeSuccess,
  peekModelProbe,
  sweepGeminiModels,
  peekModelProbeOkAt,
  providerSupportsModelChoice,
  providerSupportsThinking,
  subscribeModelLists,
} from '../utils/providerModels';

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
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderEngine, setNewProviderEngine] = useState<string>('auto');
  const [newApiKey, setNewApiKey] = useState('');
  const [newApiSecret, setNewApiSecret] = useState('');
  const [newFolderId, setNewFolderId] = useState('');
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const addKeyFormRef = useRef<HTMLFormElement | null>(null);
  const providerNameInputRef = useRef<HTMLInputElement | null>(null);
  // An in-flight verification: aborting lets the user stop a stuck check; editing the key
  // cancels it too, since the result would describe a key that is no longer in the field.
  const testAbortRef = useRef<{ controller: AbortController; cancelled: boolean } | null>(null);

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
  // The edited key that was verified valid; saving a changed key is allowed only for this exact value.
  const [editVerified, setEditVerified] = useState<{ sig: string; result: ProviderTestResult } | null>(null);
  const editNameInputRef = useRef<HTMLInputElement | null>(null);
  const editKeyInputRef = useRef<HTMLInputElement | null>(null);
  const editTestAbortRef = useRef<{ controller: AbortController; cancelled: boolean } | null>(null);

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

  const refresh = () => {
    setProvidersList(getAllTranslationProviders());
    onChanged();
  };

  const handleSelectProvider = (id: string) => {
    setActiveProviderId(id);
    setSelectedProviderId(id);
    onChanged();
  };

  // Arabic-first UI: a categorized failure renders the app's Arabic copy, never the raw
  // mixed-language API message (e.g. "Gemini: عربي / English").
  const testErrorText = (result: ProviderTestResult): string => {
    switch (result.errorKind) {
      case 'expired-key':
        return t('provider_key_expired');
      case 'invalid-key':
        return t('provider_key_invalid');
      case 'quota-exhausted':
        return t('provider_quota_exhausted');
      case 'unreachable':
        return t('provider_unreachable');
      case 'provider-error':
        return t('provider_error');
      default:
        // The add-key flow never shows a raw API message: anything uncategorized still gets
        // key-scoped Arabic copy, not a mixed-language string about a model.
        return t('provider_key_rejected');
    }
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
  const cancelOngoingTest = (
    ref: React.MutableRefObject<{ controller: AbortController; cancelled: boolean } | null>,
    stopSpinner: (v: boolean) => void
  ) => {
    if (!ref.current) return;
    ref.current.cancelled = true;
    ref.current.controller.abort();
    ref.current = null;
    stopSpinner(false);
  };

  const testEngineKey = (
    engine: string,
    key: string,
    folderId?: string,
    signal?: AbortSignal
  ): Promise<ProviderTestResult> =>
    // Gemini verifies straight from the browser even on Auto-Detect when the key shape gives it
    // away: without this, Auto-Detect + a Gemini key lands on the server path and fails wherever
    // the server is unreachable (static web demo). Google allows CORS from any origin.
    engine === 'gemini' || (engine === 'auto' && looksLikeGeminiKey(key))
      ? testGeminiKeyDirect(key, signal)
      : testProviderApiKey(engine, key, folderId);

  const handleTestAndAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    const pendingEngine = inferEngineFromName(newProviderName, newProviderEngine);
    if (!newApiKey.trim() && pendingEngine !== 'libretranslate') return;

    setIsTestingKey(true);
    setTestResult(null);
    const testAbort = { controller: new AbortController(), cancelled: false };
    testAbortRef.current = testAbort;

    const effectiveEngine = inferEngineFromName(newProviderName, newProviderEngine);
    const rawKey = newApiKey.trim() || (effectiveEngine === 'libretranslate' ? 'none' : '');
    const rawSecret = newApiSecret.trim();
    const combinedApiKey =
      effectiveEngine === 'lara' && rawSecret && !rawKey.includes(':')
        ? `${rawKey}:${rawSecret}`
        : rawKey;

    const folderId = newFolderId.trim();
    const result = await testEngineKey(effectiveEngine, combinedApiKey, folderId, testAbort.controller.signal);
    if (testAbort.cancelled) return; // cancelled: the user already moved on
    testAbortRef.current = null;
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

      // The verification already found a model that answers on this plan: make it the default
      // so the first real translation does not start by failing on a quota-limited one.
      if (result.workingModel) {
        updateCustomProvider(added.id, { model: result.workingModel });
      }

      // Then quietly test every discovered model in the background (one bare 2s attempt each):
      // plan-limited and unusable models land in their picker groups, passes float to the top.
      if (detectedType === 'gemini') {
        void sweepGeminiModels(combinedApiKey);
      }

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
    const sig = JSON.stringify([targetEngine, combinedKey, editedFolderId]);
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
    const abort = { controller: new AbortController(), cancelled: false };
    const timer = setTimeout(async () => {
      editTestAbortRef.current = abort;
      setIsTestingEditKey(true);
      const result = await testEngineKey(
        target.targetEngine,
        target.combinedKey,
        target.editedFolderId,
        abort.controller.signal
      );
      if (abort.cancelled) return;
      editTestAbortRef.current = null;
      setIsTestingEditKey(false);
      setEditTestResult(result);
      if (result.success && result.matched) setEditVerified({ sig: target.sig, result });
    }, 400);
    return () => {
      clearTimeout(timer);
      abort.cancelled = true;
      abort.controller.abort();
      if (editTestAbortRef.current === abort) editTestAbortRef.current = null;
      setIsTestingEditKey(false);
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
      setEditTestResult(null);
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
    setEditTestResult(null);
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

  // The pickers under the provider button edit the ACTIVE provider. Its model list comes from the
  // provider's list-models endpoint (cached external store; static fallback inside).
  const activeProviderType = activeProviderObj?.type;
  const activeProviderKey = activeProviderObj?.apiKey;
  const modelListResult = useSyncExternalStore(subscribeModelLists, () =>
    getProviderModelsSnapshot(activeProviderType ?? '', activeProviderKey)
  );
  const modelChoices = Array.isArray(modelListResult) ? modelListResult : [];
  const activeModelsLoading = modelListResult === 'loading';
  // Re-render when any probe lands so the available/unavailable groups stay current.
  useSyncExternalStore(subscribeModelLists, getModelProbeStatesVersion);
  // Two groups in the picker: a model lands in "unavailable" only on a definite API answer
  // (404-style unusable, or a model-scoped quota like a free-tier limit of 0) - transient
  // failures never move anything. Picking one from there re-tests it.
  // Two marked groups, each placed only by the model's own definite answer: "not on your
  // plan" (the API said the model's limit on this key is 0 - it can never run here) and
  // "unavailable" (404-style, the model does not run at all). A model whose daily quota is
  // used up is on the plan, so it stays in the available list and shows its note when picked.
  // Picking one from either group re-tests it.
  const isPlanLimitedModel = (name: string): boolean => {
    const entry = peekModelProbe(activeProviderType ?? '', activeProviderKey, name);
    return entry?.modelQuota === true && entry.quotaKind !== 'daily-used';
  };
  const isDefiniteUnavailableModel = (name: string): boolean =>
    peekModelProbe(activeProviderType ?? '', activeProviderKey, name)?.availability === 'unavailable';
  const isUnavailableModel = (name: string): boolean =>
    isPlanLimitedModel(name) || isDefiniteUnavailableModel(name);
  // A model that was tested and succeeded floats to the top, most recent success first; the
  // rest keep the API list's order (the sort is stable).
  const okAt = (name: string) => peekModelProbeOkAt(activeProviderType ?? '', activeProviderKey, name);
  const availableModels = modelChoices
    .filter((m) => !isUnavailableModel(m.name))
    .sort((a, b) => okAt(b.name) - okAt(a.name));
  const planLimitedModels = modelChoices.filter((m) => isPlanLimitedModel(m.name));
  const unavailableModels = modelChoices.filter(
    (m) => isDefiniteUnavailableModel(m.name) && !isPlanLimitedModel(m.name)
  );
  // Definite key/account problems (invalid key, exhausted quota) stick on the provider card.
  const providerRuntimeErrors = useSyncExternalStore(subscribeModelLists, getProviderRuntimeErrorsSnapshot);

  const [modelProbe, setModelProbe] = useState<
    | 'idle'
    | 'checking'
    | 'unavailable'
    | 'inconclusive'
    | 'expired-key'
    | 'invalid-key'
    | 'quota-exhausted'
    | 'model-quota'
    | 'daily-quota-used'
  >('idle');
  const modelProbeSeq = useRef(0);
  // The model picker is a custom dropdown (the native Android popup swallows same-option taps
  // and ignores option styling): tapping the already-selected model re-tests it.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const thinkingLabel = (level: string) =>
    level === 'auto'
      ? probeLoading
        ? '…'
        : t('thinking_auto')
      : level === 'minimal'
        ? t('thinking_minimal')
        : level === 'low'
          ? t('thinking_low')
          : level === 'medium'
            ? t('thinking_medium')
            : level === 'high'
              ? t('thinking_high')
              : t('thinking_xhigh');

  // The thinking picker only offers the levels the reference model (the pinned one, or the top of
  // the fetched list on 'auto') actually accepted in a tiny runtime probe - nothing about model
  // versions is hardcoded. A stored level the model rejected displays and saves as 'auto'.
  const thinkingModelRef = activeProviderObj?.model || modelChoices[0]?.name || '';
  const probeResult = useSyncExternalStore(subscribeModelLists, () =>
    getModelProbeSnapshot(activeProviderType ?? '', activeProviderKey, thinkingModelRef || undefined)
  );
  const probeLoading = probeResult === 'loading';
  const thinkingLevels = probeResult && probeResult !== 'loading' ? probeResult.levels : [];
  const storedThinking = activeProviderObj?.thinkingLevel || 'auto';
  const effectiveThinking =
    storedThinking !== 'auto' && !probeLoading && !thinkingLevels.includes(storedThinking)
      ? 'auto'
      : storedThinking;
  // The thinking picker hides when the endpoint said the reference model does not think at all.
  const refModelInfo = modelChoices.find((m) => m.name === thinkingModelRef);
  const showThinkingPicker = providerSupportsThinking(activeProviderObj?.type ?? '') &&
    (refModelInfo ? refModelInfo.thinking : true);

  // A tap on the already-selected model re-tests it live (cache bypassed); any other tap is a
  // normal pick, which is probed before saving as usual. 'auto' has nothing to re-test.
  const pickModel = (name: string) => {
    setModelMenuOpen(false);
    if (!activeProviderObj) return;
    if (name && name === (activeProviderObj.model || '') && activeProviderObj.type === 'gemini') {
      saveActiveModelChoice(name, effectiveThinking, { forceRetest: true });
      return;
    }
    saveActiveModelChoice(name, effectiveThinking);
  };

  const saveActiveModelChoice = (
    model: string,
    thinkingLevel: string,
    opts?: { forceRetest?: boolean }
  ) => {
    if (!activeProviderObj || activeProviderObj.isBuiltIn) return;
    const providerId = activeProviderObj.id;
    const apiKey = activeProviderObj.apiKey;
    const persist = (level: string) => {
      updateCustomProvider(providerId, {
        model,
        thinkingLevel: level === 'auto' ? '' : level,
      });
      refresh();
    };
    // A pinned model is probed before saving: the list endpoint names models the key cannot
    // actually run (other tiers, freshly retired), and picking one of those should say so instead
    // of silently saving a choice that 404s on the next suggestion. The probe also answers which
    // thinking levels the new model accepts; a stored level it rejects falls back to 'auto'.
    if (model && activeProviderObj.type === 'gemini' && apiKey) {
      const seq = ++modelProbeSeq.current;
      setModelProbe('checking');
      // A model picked from the unavailable group is an explicit re-test: bypass the cache so a
      // recovered model moves back to "available" and a still-failing one stays put.
      const force = opts?.forceRetest === true || isUnavailableModel(model);
      // Kicks off the probe: force bypasses the cache for the re-test. The polling below must
      // NOT force - a forced poll would relaunch the probe on every tick and never settle.
      getModelProbeSnapshot(activeProviderObj.type, apiKey, model, { force });
      const waitForProbe = () => {
        const entry = getModelProbeSnapshot(activeProviderObj.type, apiKey, model);
        if (entry === 'loading') {
          window.setTimeout(waitForProbe, 150);
          return;
        }
        if (seq !== modelProbeSeq.current) return;
        if (!entry || entry.availability === 'unavailable') {
          setModelProbe('unavailable');
          return;
        }
        // A definite key problem (invalid/expired key, quota exhausted) is named in red; a
        // model-scoped quota (this model not on the key's tier) warns in amber but keeps the
        // pick; an inconclusive probe (transient key/network trouble) just notes the check did
        // not run. Picking a different model re-probes and resets this state, so the warning
        // clears as soon as a working model is picked.
        setModelProbe(
          entry.keyProblem ??
            (entry.modelQuota
              ? entry.quotaKind === 'daily-used'
                ? 'daily-quota-used'
                : 'model-quota'
              : entry.availability === 'unknown'
                ? 'inconclusive'
                : 'idle')
        );
        // A successful (re-)test clears this model's runtime line from the provider card and
        // floats it to the top of the picker - including cache-hit picks, which skip the
        // network path where the ordering timestamp is otherwise set.
        if (entry.availability === 'ok') {
          noteModelProbeSuccess(activeProviderObj.type, apiKey, model);
        }
        const levelForModel =
          thinkingLevel !== 'auto' && !entry.levels.includes(thinkingLevel) ? 'auto' : thinkingLevel;
        persist(levelForModel);
      };
      waitForProbe();
      return;
    }
    modelProbeSeq.current += 1;
    setModelProbe('idle');
    persist(thinkingLevel);
  };

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
                                      : prov.type === 'google' || prov.type === 'google_cloud'
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
                                    cancelOngoingTest(editTestAbortRef, setIsTestingEditKey);
                                    setEditTestResult(null);
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
                                      cancelOngoingTest(editTestAbortRef, setIsTestingEditKey);
                                      setEditTestResult(null);
                                      setEditApiKey('');
                                      editKeyInputRef.current?.focus();
                                      return;
                                    }
                                    try {
                                      const text = (await readClipboardText()).trim();
                                      if (text) {
                                        setEditTestResult(null);
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
                                    setEditTestResult(null);
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
                                    setEditTestResult(null);
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
                                    setEditTestResult(null);
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

                            {editTestResult && !editTestResult.matched && (
                              <div className="p-2 rounded-lg border bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300 text-[10px] flex flex-col gap-1">
                                <div className="flex items-center gap-1 font-semibold">
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                  <span data-i18n>
                                    {t('new_api_key_verification_failed')}
                                  </span>
                                </div>
                                {editTestResult.error && (
                                  <p className="opacity-90 leading-snug">{testErrorText(editTestResult)}</p>
                                )}
                              </div>
                            )}

                            <div className="flex items-center justify-end gap-1.5 pt-0.5">
                              {isTestingEditKey && (
                                <button
                                  type="button"
                                  onClick={() => cancelOngoingTest(editTestAbortRef, setIsTestingEditKey)}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-[11px] font-semibold transition cursor-pointer"
                                >
                                  <X className="w-3 h-3" />
                                  <span data-i18n>{tb('cancel')}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  cancelOngoingTest(editTestAbortRef, setIsTestingEditKey);
                                  setEditingProviderId(null);
                                  setEditTestResult(null);
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-200/70 hover:bg-slate-200 dark:bg-[#252D3D] dark:hover:bg-[#2E384B] text-slate-700 dark:text-slate-200 text-[11px] font-semibold transition cursor-pointer"
                              >
                                {tb('cancel')}
                              </button>
                              <button
                                type="submit"
                                disabled={
                                  isTestingEditKey ||
                                  (() => {
                                    const target = resolveEditTarget(prov);
                                    return target.keyChanged && editVerified?.sig !== target.sig;
                                  })() ||
                                  !editProviderName.trim() ||
                                  (!editApiKey.trim() && prov.type !== 'libretranslate')
                                }
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1EB996] hover:bg-[#19A585] disabled:opacity-50 text-white text-[11px] font-semibold transition cursor-pointer shadow-xs"
                              >
                                {isTestingEditKey ? (
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
                  <span data-i18n>
                    {t('add_translator_api_key')}
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
                      <span data-i18n className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        {t('swipe_list_to_choose_provider')}
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
                    <SecretField
                      id="provider-api-key-input"
                      label={
                        inferEngineFromName(newProviderName, newProviderEngine) === 'lara'
                          ? t('lara_access_key_id_or')
                          : t('translator_api_key')
                      }
                      value={newApiKey}
                      onChange={(v) => {
                        cancelOngoingTest(testAbortRef, setIsTestingKey);
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
                        isTestingKey ||
                        (!newApiKey.trim() && inferEngineFromName(newProviderName, newProviderEngine) !== 'libretranslate')
                      }
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#1EB996] hover:bg-[#19A585] disabled:opacity-50 text-white text-xs font-semibold transition cursor-pointer shadow-xs shrink-0"
                    >
                      {isTestingKey ? (
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
                    {isTestingKey && (
                      <button
                        id="provider-verify-cancel-btn"
                        type="button"
                        onClick={() => cancelOngoingTest(testAbortRef, setIsTestingKey)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-semibold transition cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span data-i18n>{tb('cancel')}</span>
                      </button>
                    )}

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
                              <span data-i18n>
                                {testResult.modelsQuotaLimited || testResult.noWorkingModel
                                  ? t('api_key_works_no_models')
                                  : testResult.translationUnverified
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

                        {testResult.testSource && (
                          <div className="text-[10px] space-y-0.5 text-slate-600 dark:text-slate-300 bg-black/5 dark:bg-black/25 p-1.5 rounded">
                            <div>
                              <span data-i18n className="opacity-70">
                                {t('test')}
                              </span>
                              <span className="font-mono">{testResult.testSource}</span>
                            </div>
                            {testResult.googleTranslation && (
                              <div>
                                <span data-i18n className="opacity-70">
                                  {t('google_translate_2')}
                                </span>
                                <span className="font-semibold">
                                  {testResult.googleTranslation}
                                </span>
                              </div>
                            )}
                            {testResult.providerTranslation && (
                              <div>
                                <span data-i18n className="opacity-70">
                                  {t('provider')}
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
                            {testErrorText(testResult)}
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

        {/* Model and thinking pickers: loose controls under the provider card (no card around them), hidden while the provider list is expanded */}
        {!providersPanelOpen && (
          <>
            {activeProviderObj &&
              !activeProviderObj.isBuiltIn &&
              (providerSupportsModelChoice(activeProviderObj.type) ||
                providerSupportsThinking(activeProviderObj.type)) && (
                <div
                  className="flex flex-col gap-2 px-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="relative flex gap-2">
                    {providerSupportsModelChoice(activeProviderObj.type) && (
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <label
                          htmlFor="active-provider-model-select"
                          className="text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                        >
                          {t('model')}
                        </label>
                        <div>
                          <button
                            id="active-provider-model-select"
                            type="button"
                            dir="ltr"
                            aria-haspopup="listbox"
                            aria-expanded={modelMenuOpen}
                            onClick={() => setModelMenuOpen((open) => !open)}
                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-[11px] font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996] flex items-center justify-between gap-1 text-left"
                          >
                            <span className="truncate">
                              {activeProviderObj.model ||
                                (activeModelsLoading ? '…' : t('model_auto_recommended'))}
                            </span>
                            <ChevronDown className="w-3 h-3 shrink-0 text-slate-500 dark:text-slate-400" />
                          </button>
                          {modelMenuOpen && (
                            <>
                              <div
                                className="fixed inset-0 z-40 cursor-default"
                                onClick={() => setModelMenuOpen(false)}
                              />
                              <ul
                                dir="ltr"
                                role="listbox"
                                className="absolute inset-x-0 z-50 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-300 dark:border-[#2E384D] bg-white dark:bg-[#1B212E] shadow-xl py-1"
                              >
                                {([
                                  { name: '', label: activeModelsLoading ? '…' : t('model_auto_recommended'), dimmed: false },
                                  ...availableModels.map((m) => ({ name: m.name, label: m.name, dimmed: false })),
                                  ...(activeProviderObj.model &&
                                  activeProviderObj.model !== '' &&
                                  !modelChoices.some((m) => m.name === activeProviderObj.model)
                                    ? [{ name: activeProviderObj.model, label: activeProviderObj.model, dimmed: false }]
                                    : []),
                                ] as Array<{ name: string; label: string; dimmed: boolean }>).map((item) => (
                                  <li key={item.name || '__auto__'} role="option" aria-selected={(activeProviderObj.model || '') === item.name}>
                                    <button
                                      type="button"
                                      onClick={() => pickModel(item.name)}
                                      className={`w-full px-2 py-1.5 text-left text-[11px] font-mono flex items-center justify-between gap-1 hover:bg-slate-100 dark:hover:bg-[#262E3F] ${
                                        (activeProviderObj.model || '') === item.name
                                          ? 'text-[#1EB996] font-semibold'
                                          : 'text-slate-900 dark:text-slate-100'
                                      }`}
                                    >
                                      <span className="truncate">{item.label}</span>
                                      {(activeProviderObj.model || '') === item.name && (
                                        <Check className="w-3 h-3 shrink-0" />
                                      )}
                                    </button>
                                  </li>
                                ))}
                                {([
                                  { heading: t('models_plan_unavailable'), models: planLimitedModels },
                                  { heading: t('models_unavailable'), models: unavailableModels },
                                ] as Array<{ heading: string; models: typeof planLimitedModels }>).map(
                                  (group) =>
                                    group.models.length > 0 && (
                                      <li key={group.heading}>
                                        <div dir="rtl" className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400 text-right">
                                          {group.heading}
                                        </div>
                                        <ul>
                                          {group.models.map((m) => (
                                            <li key={m.name} role="option" aria-selected={activeProviderObj.model === m.name}>
                                              <button
                                                type="button"
                                                onClick={() => pickModel(m.name)}
                                                className={`w-full px-2 py-1.5 text-left text-[11px] font-mono flex items-center justify-between gap-1 hover:bg-slate-100 dark:hover:bg-[#262E3F] ${
                                                  activeProviderObj.model === m.name
                                                    ? 'text-[#1EB996] font-semibold'
                                                    : 'text-slate-400 dark:text-slate-500'
                                                }`}
                                              >
                                                <span className="truncate">{m.name}</span>
                                                {activeProviderObj.model === m.name && (
                                                  <Check className="w-3 h-3 shrink-0" />
                                                )}
                                              </button>
                                            </li>
                                          ))}
                                        </ul>
                                      </li>
                                    )
                                )}
                              </ul>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    {showThinkingPicker && (
                      <div className={`flex flex-col gap-1 min-w-0 ${providerSupportsModelChoice(activeProviderObj.type) ? 'shrink-0' : 'flex-1'}`}>
                        <label
                          htmlFor="active-provider-thinking-select"
                          className="text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                        >
                          {t('thinking_power')}
                        </label>
                        <div>
                          <button
                            id="active-provider-thinking-select"
                            type="button"
                            aria-haspopup="listbox"
                            aria-expanded={thinkingMenuOpen}
                            onClick={() => setThinkingMenuOpen((open) => !open)}
                            className={`px-2 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-[11px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996] flex items-center justify-between gap-2 whitespace-nowrap ${providerSupportsModelChoice(activeProviderObj.type) ? '' : 'w-full'}`}
                          >
                            <span className="truncate">{thinkingLabel(effectiveThinking)}</span>
                            <ChevronDown className="w-3 h-3 shrink-0 text-slate-500 dark:text-slate-400" />
                          </button>
                          {thinkingMenuOpen && (
                            <>
                              <div
                                className="fixed inset-0 z-40 cursor-default"
                                onClick={() => setThinkingMenuOpen(false)}
                              />
                              <ul
                                role="listbox"
                                className="absolute end-0 z-50 mt-1 min-w-[9rem] max-h-64 overflow-auto rounded-lg border border-slate-300 dark:border-[#2E384D] bg-white dark:bg-[#1B212E] shadow-xl py-1"
                              >
                                {['auto', ...thinkingLevels].map((level: string) => (
                                  <li key={level} role="option" aria-selected={effectiveThinking === level}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setThinkingMenuOpen(false);
                                        saveActiveModelChoice(activeProviderObj.model || '', level);
                                      }}
                                      className={`w-full px-2 py-1.5 text-start text-[11px] flex items-center justify-between gap-2 whitespace-nowrap hover:bg-slate-100 dark:hover:bg-[#262E3F] ${
                                        effectiveThinking === level
                                          ? 'text-[#1EB996] font-semibold'
                                          : 'text-slate-900 dark:text-slate-100'
                                      }`}
                                    >
                                      <span>{thinkingLabel(level)}</span>
                                      {effectiveThinking === level && <Check className="w-3 h-3 shrink-0" />}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {(() => {
                    // A quota note from picking this model clears the moment the model actually
                    // runs again (a successful suggest or re-test records an 'ok' probe entry).
                    const liveEntry = activeProviderObj?.model
                      ? peekModelProbe(activeProviderObj.type, activeProviderObj.apiKey, activeProviderObj.model)
                      : undefined;
                    if (
                      (modelProbe === 'model-quota' || modelProbe === 'daily-quota-used') &&
                      liveEntry &&
                      liveEntry.availability === 'ok'
                    )
                      return null;
                    return modelProbe !== 'idle' && (
                    <div
                      className={`flex items-center gap-1.5 text-[10px] ${
                        modelProbe === 'unavailable' ||
                        modelProbe === 'expired-key' ||
                        modelProbe === 'invalid-key' ||
                        modelProbe === 'quota-exhausted'
                          ? 'text-red-500 dark:text-red-400'
                          : modelProbe === 'model-quota' || modelProbe === 'daily-quota-used'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {modelProbe === 'checking' ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                          <span>{t('checking_model_availability')}</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span>
                            {modelProbe === 'unavailable'
                              ? t('model_not_available_on_plan')
                              : modelProbe === 'expired-key'
                                ? t('provider_key_expired')
                                : modelProbe === 'invalid-key'
                                  ? t('provider_key_invalid')
                                  : modelProbe === 'quota-exhausted'
                                    ? t('provider_quota_exhausted')
                                    : modelProbe === 'model-quota'
                                      ? t('model_quota_unavailable')
                                      : modelProbe === 'daily-quota-used'
                                        ? t('model_daily_quota_used')
                                        : t('model_check_inconclusive')}
                          </span>
                        </>
                      )}
                    </div>
                    );
                  })()}
                </div>
              )}
          </>
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
