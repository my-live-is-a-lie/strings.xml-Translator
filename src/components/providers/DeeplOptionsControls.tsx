import React, { useEffect, useRef, useState } from 'react';
import { TranslationProviderConfig, getCustomProviders, updateCustomProvider } from '../../utils/translator';
import { useT } from '../../i18n/i18n';
import { sanitizeDeeplOptions, deeplSupportsFormality, DEEPL_CONTEXT_MAX_LENGTH, type DeeplOptions } from '../../shared/deeplOptions';

interface DeeplOptionsControlsProps {
  provider: TranslationProviderConfig;
  /** The project's target language code; formality is shown only where DeepL supports it */
  targetLang: string;
  /** Called after the provider's settings are saved */
  refresh: () => void;
}

/** DeepL options shown under the provider card: formality, model type, context, formatting, sentence splitting. */
export const DeeplOptionsControls: React.FC<DeeplOptionsControlsProps> = ({ provider, targetLang, refresh }) => {
  const { t } = useT();
  const options: DeeplOptions = sanitizeDeeplOptions(provider.deeplOptions) ?? {};
  const [contextDraft, setContextDraft] = useState<string | null>(null);
  const contextText = contextDraft ?? options.context ?? '';

  // Blur never fires when the panel unmounts (drawer closed while the field is focused), so the
  // cleanup saves a pending draft. The ref holds the latest values for the cleanup to read.
  const pending = useRef({ id: provider.id, draft: contextDraft, saved: options.context });
  pending.current = { id: provider.id, draft: contextDraft, saved: options.context };
  useEffect(
    () => () => {
      const { id, draft, saved } = pending.current;
      if (draft === null || draft === (saved ?? '')) return;
      const current = getCustomProviders().find((p) => p.id === id);
      if (!current) return;
      updateCustomProvider(id, { deeplOptions: { ...sanitizeDeeplOptions(current.deeplOptions), context: draft } });
    },
    []
  );

  const save = (patch: Partial<DeeplOptions>) => {
    updateCustomProvider(provider.id, { deeplOptions: { ...options, ...patch } });
    refresh();
  };

  const segmented = <V extends string | undefined>(
    id: string,
    label: string,
    choices: Array<{ value: V; label: string }>,
    current: V,
    onPick: (value: V) => void
  ) => (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
        {label}
      </span>
      <div id={id} role="radiogroup" aria-labelledby={`${id}-label`} className="flex gap-1">
        {choices.map((c) => {
          const selected = c.value === current;
          return (
            <button
              key={String(c.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onPick(c.value)}
              className={`flex-1 px-2 py-1.5 rounded-lg border text-[11px] cursor-pointer transition ${
                selected
                  ? 'bg-[#1EB996]/15 border-[#1EB996]/50 text-[#1EB996] font-semibold'
                  : 'bg-white dark:bg-[#1B212E] border-slate-300 dark:border-[#2E384D] text-slate-900 dark:text-slate-100'
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const preserve = !!options.preserveFormatting;

  return (
    <div id="active-deepl-options" className="flex flex-col gap-2 px-1" onClick={(e) => e.stopPropagation()}>
      {deeplSupportsFormality(targetLang) && segmented(
        'active-deepl-formality',
        t('deepl_formality'),
        [
          { value: undefined as DeeplOptions['formality'], label: t('deepl_default') },
          { value: 'more' as const, label: t('deepl_formality_more') },
          { value: 'less' as const, label: t('deepl_formality_less') },
        ],
        options.formality,
        (formality) => save({ formality })
      )}
      {segmented(
        'active-deepl-model-type',
        t('deepl_model_type'),
        [
          { value: undefined as DeeplOptions['modelType'], label: t('deepl_default') },
          { value: 'latency_optimized' as const, label: t('deepl_model_fast') },
          { value: 'quality_optimized' as const, label: t('deepl_model_quality') },
        ],
        options.modelType,
        (modelType) => save({ modelType })
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="active-deepl-context" className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
          {t('deepl_context')}
        </label>
        <textarea
          id="active-deepl-context"
          rows={2}
          maxLength={DEEPL_CONTEXT_MAX_LENGTH}
          value={contextText}
          onChange={(e) => setContextDraft(e.target.value)}
          onBlur={() => {
            if (contextDraft === null) return;
            save({ context: contextDraft });
            setContextDraft(null);
          }}
          className="px-2 py-1.5 rounded-lg bg-white dark:bg-[#1B212E] border border-slate-300 dark:border-[#2E384D] text-[11px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1EB996]/30 focus:border-[#1EB996] w-full resize-none"
        />
      </div>
      <button
        id="active-deepl-preserve-formatting"
        type="button"
        role="switch"
        aria-checked={preserve}
        onClick={() => save({ preserveFormatting: !preserve })}
        className="flex items-center justify-between gap-3 text-start cursor-pointer"
      >
        <span className="text-[11px] text-slate-600 dark:text-slate-300">{t('deepl_preserve_formatting')}</span>
        <span
          className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${preserve ? 'bg-[var(--accent-primary)]' : 'bg-slate-300 dark:bg-[#2A3446]'}`}
        >
          <span
            className={`absolute top-0.5 start-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${preserve ? 'translate-x-4 rtl:-translate-x-4' : ''}`}
          />
        </span>
      </button>
      {segmented(
        'active-deepl-split-sentences',
        t('deepl_split_sentences'),
        [
          { value: undefined as DeeplOptions['splitSentences'], label: t('deepl_default') },
          { value: '0' as const, label: t('deepl_split_off') },
          { value: 'nonewlines' as const, label: t('deepl_split_punctuation') },
        ],
        options.splitSentences,
        (splitSentences) => save({ splitSentences })
      )}
    </div>
  );
};
