/**
 * DeepL translate options chosen on the provider card. Shared by the browser and the server so both
 * send exactly the same request fields. An unset option is never sent: DeepL then uses its own default.
 */
export type DeeplFormality = 'more' | 'less';
export type DeeplModelType = 'latency_optimized' | 'quality_optimized';
export type DeeplSplitSentences = '0' | 'nonewlines';

export interface DeeplOptions {
  formality?: DeeplFormality;
  modelType?: DeeplModelType;
  context?: string;
  preserveFormatting?: boolean;
  splitSentences?: DeeplSplitSentences;
}

export const DEEPL_CONTEXT_MAX_LENGTH = 1000;

/** Accepts untrusted input (saved settings or a request body) and keeps only valid values. */
export function sanitizeDeeplOptions(raw: unknown): DeeplOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: DeeplOptions = {};
  if (r.formality === 'more' || r.formality === 'less') out.formality = r.formality;
  if (r.modelType === 'latency_optimized' || r.modelType === 'quality_optimized') out.modelType = r.modelType;
  if (typeof r.context === 'string' && r.context.trim()) out.context = r.context.trim().slice(0, DEEPL_CONTEXT_MAX_LENGTH);
  if (r.preserveFormatting === true) out.preserveFormatting = true;
  if (r.splitSentences === '0' || r.splitSentences === 'nonewlines') out.splitSentences = r.splitSentences;
  return Object.keys(out).length ? out : undefined;
}

/**
 * The extra fields for DeepL's /v2/translate body.
 * Formality uses the prefer_* values: a target language without formality support then falls back
 * to the default instead of failing the whole request.
 */
export function deeplRequestFields(options?: DeeplOptions): Record<string, string | boolean> {
  const o = sanitizeDeeplOptions(options);
  if (!o) return {};
  return {
    ...(o.formality ? { formality: o.formality === 'more' ? 'prefer_more' : 'prefer_less' } : {}),
    ...(o.modelType ? { model_type: o.modelType } : {}),
    ...(o.context ? { context: o.context } : {}),
    ...(o.preserveFormatting ? { preserve_formatting: true } : {}),
    ...(o.splitSentences ? { split_sentences: o.splitSentences } : {}),
  };
}

/**
 * Target languages (base codes) DeepL accepts the formality option for. Taken from DeepL's
 * GET /v3/languages?resource=translate_text (feature "formality"): DE, ES, FR, IT, JA, NL, PL, PT, RU.
 * Any other target (Arabic included) is rejected by DeepL when formality is sent as plain more/less.
 */
const FORMALITY_BASE_LANGS = new Set(['de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru']);

/** Whether DeepL supports formality for an app target language code (e.g. 'de', 'pt-rBR'). */
export function deeplSupportsFormality(targetLang: string): boolean {
  return FORMALITY_BASE_LANGS.has(targetLang.split('-')[0].toLowerCase());
}
