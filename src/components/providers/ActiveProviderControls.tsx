import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import {
  TranslationProviderConfig,
  updateCustomProvider,
  parseLaraInstructions,
  LARA_INSTRUCTION_MAX_WORDS,
} from '../../utils/translator';
import { DeeplOptionsControls } from './DeeplOptionsControls';
import { useT } from '../../i18n/i18n';
import {
  getModelProbeSnapshot,
  getModelProbeStatesVersion,
  getProviderModelsSnapshot,
  noteModelProbeSuccess,
  peekModelProbe,
  peekModelProbeOkAt,
  providerSupportsModelChoice,
  providerSupportsThinking,
  subscribeModelLists,
} from '../../utils/providerModels';

interface ActiveProviderControlsProps {
  /** The provider these controls edit */
  activeProviderObj: TranslationProviderConfig | undefined;
  /** Called after the provider's settings are saved */
  refresh: () => void;
}

/** Model, thinking and Lara controls shown under the provider card; they edit the ACTIVE provider. */
export const ActiveProviderControls: React.FC<ActiveProviderControlsProps> = ({ activeProviderObj, refresh }) => {
  const { t } = useT();
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
  // Unmount invalidates any probe still polling, so its timer chain ends instead of setting state.
  useEffect(() => {
    const seqRef = modelProbeSeq;
    return () => {
      seqRef.current += 1;
    };
  }, []);
  // The model picker is a custom dropdown (the native Android popup swallows same-option taps
  // and ignores option styling): tapping the already-selected model re-tests it.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [laraModeMenuOpen, setLaraModeMenuOpen] = useState(false);
  const [laraEffortMenuOpen, setLaraEffortMenuOpen] = useState(false);
  const [laraStyleMenuOpen, setLaraStyleMenuOpen] = useState(false);
  // Unsaved text of the Lara instructions box (saved when the box loses focus).
  const [laraInstrDraft, setLaraInstrDraft] = useState<string | null>(null);
  // Close a picker on a real tap outside it (click never fires after a drag). No full-screen overlay: it would
  // swallow touch drags meant for the drawer and let the page behind scroll.
  useEffect(() => {
    if (!modelMenuOpen && !thinkingMenuOpen && !laraModeMenuOpen && !laraEffortMenuOpen && !laraStyleMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element | null;
      const inside = (id: string) => !!el?.closest(`#${id}-list, #${id}-select`);
      if (modelMenuOpen && !inside('active-provider-model')) setModelMenuOpen(false);
      if (thinkingMenuOpen && !inside('active-provider-thinking')) setThinkingMenuOpen(false);
      if (laraModeMenuOpen && !inside('active-lara-mode')) setLaraModeMenuOpen(false);
      if (laraEffortMenuOpen && !inside('active-lara-effort')) setLaraEffortMenuOpen(false);
      if (laraStyleMenuOpen && !inside('active-lara-style')) setLaraStyleMenuOpen(false);
    };
    document.addEventListener('click', onDown, true);
    return () => document.removeEventListener('click', onDown, true);
  }, [modelMenuOpen, thinkingMenuOpen, laraModeMenuOpen, laraEffortMenuOpen, laraStyleMenuOpen]);
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
        // Stale (another model was picked) or unmounted: stop polling instead of ticking on.
        if (seq !== modelProbeSeq.current) return;
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
            {activeProviderObj && !activeProviderObj.isBuiltIn && activeProviderObj.type === 'deepl' && (
              <DeeplOptionsControls provider={activeProviderObj} refresh={refresh} />
            )}
            {activeProviderObj && !activeProviderObj.isBuiltIn && activeProviderObj.type === 'lara' && (() => {
              const laraProv = activeProviderObj;
              const laraThink = laraProv.laraMode === 'think';
              const laraEffort = laraProv.laraEffort || 'low';
              const laraStyle = laraProv.laraStyle || 'faithful';
              const laraInstrText = laraInstrDraft ?? laraProv.laraInstructions ?? '';
              const laraInstrTooLong = parseLaraInstructions(laraInstrText).some(
                (l) => l.split(/\s+/).length > LARA_INSTRUCTION_MAX_WORDS
              );
              const laraNoTrace = !!laraProv.laraNoTrace;
              const pickerButton = 'px-2 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-[11px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996] flex items-center justify-between gap-2 whitespace-nowrap w-full';
              const listBox = 'absolute z-50 mt-1 min-w-[9rem] max-h-64 overflow-y-auto overscroll-contain touch-pan-y rounded-lg border border-slate-300 dark:border-[#2E384D] bg-white dark:bg-[#1B212E] shadow-xl py-1';
              const renderList = (
                id: string,
                position: string,
                options: Array<{ value: string; label: string }>,
                current: string,
                onPick: (value: string) => void,
                close: () => void
              ) => (
                <ul role="listbox" id={`${id}-list`} className={`${listBox} ${position}`}>
                  {options.map((o) => (
                    <li key={o.value} role="option" aria-selected={current === o.value}>
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          onPick(o.value);
                        }}
                        className={`w-full px-2 py-1.5 text-start text-[11px] flex items-center justify-between gap-2 whitespace-nowrap hover:bg-slate-100 dark:hover:bg-[#262E3F] ${
                          current === o.value ? 'text-[#1EB996] font-semibold' : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        <span>{o.label}</span>
                        {current === o.value && <Check className="w-3 h-3 shrink-0" />}
                      </button>
                    </li>
                  ))}
                </ul>
              );
              return (
                <div className="flex flex-col gap-2 px-1" onClick={(e) => e.stopPropagation()}>
                  <div className="relative flex gap-2">
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <label
                        htmlFor="active-lara-mode-select"
                        className="text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                      >
                        {t('lara_mode')}
                      </label>
                      <div>
                        <button
                          id="active-lara-mode-select"
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded={laraModeMenuOpen}
                          onClick={() => {
                            setLaraEffortMenuOpen(false);
                            setLaraStyleMenuOpen(false);
                            setLaraModeMenuOpen((open) => !open);
                          }}
                          className={pickerButton}
                        >
                          <span className="truncate">{laraThink ? t('lara_mode_think') : t('lara_mode_standard')}</span>
                          <ChevronDown className="w-3 h-3 shrink-0 text-slate-500 dark:text-slate-400" />
                        </button>
                        {laraModeMenuOpen &&
                          renderList(
                            'active-lara-mode',
                            'start-0',
                            [
                              { value: 'standard', label: t('lara_mode_standard') },
                              { value: 'think', label: t('lara_mode_think') },
                            ],
                            laraThink ? 'think' : 'standard',
                            (value) => {
                              updateCustomProvider(laraProv.id, { laraMode: value === 'think' ? 'think' : '' });
                              refresh();
                            },
                            () => setLaraModeMenuOpen(false)
                          )}
                      </div>
                    </div>
                    {laraThink && (
                      <div className="flex flex-col gap-1 min-w-0 shrink-0">
                        <label
                          htmlFor="active-lara-effort-select"
                          className="text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                        >
                          {t('lara_effort')}
                        </label>
                        <div>
                          <button
                            id="active-lara-effort-select"
                            type="button"
                            aria-haspopup="listbox"
                            aria-expanded={laraEffortMenuOpen}
                            onClick={() => {
                              setLaraModeMenuOpen(false);
                              setLaraEffortMenuOpen((open) => !open);
                            }}
                            className={`${pickerButton} min-w-[6.5rem]`}
                          >
                            <span className="truncate">{t(`thinking_${laraEffort}`)}</span>
                            <ChevronDown className="w-3 h-3 shrink-0 text-slate-500 dark:text-slate-400" />
                          </button>
                          {laraEffortMenuOpen &&
                            renderList(
                              'active-lara-effort',
                              'end-0',
                              [
                                { value: 'low', label: t('thinking_low') },
                                { value: 'medium', label: t('thinking_medium') },
                                { value: 'high', label: t('thinking_high') },
                              ],
                              laraEffort,
                              (value) => {
                                updateCustomProvider(laraProv.id, { laraEffort: value });
                                refresh();
                              },
                              () => setLaraEffortMenuOpen(false)
                            )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative flex flex-col gap-1">
                    <label
                      htmlFor="active-lara-style-select"
                      className="text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                    >
                      {t('lara_style')}
                    </label>
                    <div>
                      <button
                        id="active-lara-style-select"
                        type="button"
                        aria-haspopup="listbox"
                        aria-expanded={laraStyleMenuOpen}
                        onClick={() => {
                          setLaraModeMenuOpen(false);
                          setLaraEffortMenuOpen(false);
                          setLaraStyleMenuOpen((open) => !open);
                        }}
                        className={pickerButton}
                      >
                        <span className="truncate">{t(`lara_style_${laraStyle}`)}</span>
                        <ChevronDown className="w-3 h-3 shrink-0 text-slate-500 dark:text-slate-400" />
                      </button>
                      {laraStyleMenuOpen &&
                        renderList(
                          'active-lara-style',
                          'start-0',
                          [
                            { value: 'faithful', label: t('lara_style_faithful') },
                            { value: 'fluid', label: t('lara_style_fluid') },
                            { value: 'creative', label: t('lara_style_creative') },
                          ],
                          laraStyle,
                          (value) => {
                            updateCustomProvider(laraProv.id, { laraStyle: value });
                            refresh();
                          },
                          () => setLaraStyleMenuOpen(false)
                        )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="active-lara-instructions"
                      className="text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                    >
                      {t('lara_instructions')}
                    </label>
                    <textarea
                      id="active-lara-instructions"
                      rows={3}
                      value={laraInstrText}
                      placeholder={t('lara_instructions_placeholder')}
                      onChange={(e) => setLaraInstrDraft(e.target.value)}
                      onBlur={() => {
                        if (laraInstrDraft === null) return;
                        updateCustomProvider(laraProv.id, { laraInstructions: laraInstrDraft });
                        setLaraInstrDraft(null);
                        refresh();
                      }}
                      className="px-2 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-[11px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996] w-full resize-none"
                    />
                    {laraInstrTooLong && (
                      <span id="active-lara-instructions-warning" className="text-[10px] text-red-500">
                        {t('lara_instructions_too_long')}
                      </span>
                    )}
                  </div>
                  <button
                    id="active-lara-notrace"
                    type="button"
                    role="switch"
                    aria-checked={laraNoTrace}
                    onClick={() => {
                      updateCustomProvider(laraProv.id, { laraNoTrace: !laraNoTrace });
                      refresh();
                    }}
                    className="flex items-center justify-between gap-3 text-start cursor-pointer"
                  >
                    <span className="text-[11px] text-slate-600 dark:text-slate-300">{t('lara_notrace')}</span>
                    <span
                      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${laraNoTrace ? 'bg-[var(--accent-primary)]' : 'bg-slate-300 dark:bg-[#2A3446]'}`}
                    >
                      <span
                        className={`absolute top-0.5 start-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${laraNoTrace ? 'translate-x-4 rtl:-translate-x-4' : ''}`}
                      />
                    </span>
                  </button>
                </div>
              );
            })()}
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
                              <ul
                                dir="ltr"
                                role="listbox"
                                id="active-provider-model-list"
                                className="absolute inset-x-0 z-50 mt-1 max-h-64 overflow-y-auto overscroll-contain touch-pan-y rounded-lg border border-slate-300 dark:border-[#2E384D] bg-white dark:bg-[#1B212E] shadow-xl py-1"
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
                            className={`px-2 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-[11px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996] flex items-center justify-between gap-2 whitespace-nowrap min-w-[6.5rem] ${providerSupportsModelChoice(activeProviderObj.type) ? '' : 'w-full'}`}
                          >
                            <span className="truncate">{thinkingLabel(effectiveThinking)}</span>
                            <ChevronDown className="w-3 h-3 shrink-0 text-slate-500 dark:text-slate-400" />
                          </button>
                          {thinkingMenuOpen && (
                            <>
                              <ul
                                role="listbox"
                                id="active-provider-thinking-list"
                                className="absolute end-0 z-50 mt-1 min-w-[9rem] max-h-64 overflow-y-auto overscroll-contain touch-pan-y rounded-lg border border-slate-300 dark:border-[#2E384D] bg-white dark:bg-[#1B212E] shadow-xl py-1"
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
  );
};
