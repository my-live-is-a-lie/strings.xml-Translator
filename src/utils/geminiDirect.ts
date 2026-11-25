import { debugIgnored } from './debug';
// Calls the Gemini API straight from the browser with the user's own key.
// The key goes from this browser to Google only; it never passes through this app's server.
import type { ProviderTestResult } from './translator';
import { SYSTEM_INSTRUCTION, fetchWithTimeout } from '../shared/translateCore';
import { validatePlaceholders } from './placeholderCheck';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
// Google retires models for new keys from time to time ("no longer available to new users"), so no single
// name is trusted: the alias that always points at the current Flash model goes first, then pinned names,
// and as a last resort the list of models the key can actually use is asked for.
export const GEMINI_MODEL_CANDIDATES = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash'];
// High-demand spikes make a healthy model answer in 20s+ sometimes; the per-attempt timeout must
// outlast that or every candidate times out one after another and verification always fails.
const GEMINI_TIMEOUT_MS = 30000;
// Candidates run hedged, not sequentially: the first model starts alone, and every HEDGE_DELAY_MS
// another candidate joins in parallel. A hanging or overloaded model no longer serializes the wait
// (before, 3 candidates x 30s timeout meant up to 90s+ before an answer that now takes the time of
// the fastest model), and the extra calls only happen while no model has answered yet.
const HEDGE_DELAY_MS = 4000;

let workingModel: string | null = null;

/**
 * True when the key looks like an AI Studio Gemini key (classic `AIza...` or the newer `AQ.`
 * format). Used so Auto-Detect can route such keys straight to the Gemini check: Google answers
 * CORS requests from any origin, so Gemini is the one provider that verifies without the server.
 */
export const looksLikeGeminiKey = (key: string): boolean => {
  const trimmed = key.trim();
  return trimmed.startsWith('AIza') || trimmed.startsWith('AQ.');
};

class GeminiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly modelUnavailable: boolean
  ) {
    super(message);
  }
}

/**
 * The model answered, but the answer broke the ICU structure of the source string.
 * The name is what `isRetryableError` looks at: resending the same prompt to the same model
 * with the same temperature just burns quota (and can trip a rate limit), so it is not retried.
 */
class GeminiStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructuralError';
  }
}

/** True when the API says this model can't be used (retired, unknown, or not for this key), not that the key is bad. */
export function isModelUnavailableMessage(status: number, message: string): boolean {
  if (status === 404) return true;
  return (
    (status === 400 || status === 403) &&
    /no longer available|not found|is not supported|not available to new users|deprecated/i.test(message)
  );
}

/** Asks Google which models this key can call and returns Flash models, newest first. */
async function discoverFlashModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetchWithTimeout(
    `${API_ROOT}/models?pageSize=200`,
    { headers: { 'x-goog-api-key': apiKey.trim() } },
    GEMINI_TIMEOUT_MS,
    signal
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
  const version = (n: string) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
  return (data.models || [])
    .filter((m) => m.name && /flash/.test(m.name) && !/(lite|image|tts|live|audio|embedding|thinking|exp)/.test(m.name))
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => (m.name as string).replace(/^models\//, ''))
    .sort((a, b) => version(b) - version(a));
}

/**
 * Lists every text model the key can call, for the model picker: Flash models first (they are the
 * sensible translation choices), then the rest, each group newest first. Returns [] when the key
 * or the network fails, so the picker can fall back to its static list.
 */
export async function listGeminiModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(
      `${API_ROOT}/models?pageSize=200`,
      { headers: { 'x-goog-api-key': apiKey.trim() } },
      10000,
      signal
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    const version = (n: string) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
    const usable = (data.models || [])
      .filter((m) => m.name && (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => (m.name as string).replace(/^models\//, ''))
      .filter((n) => /^gemini-/.test(n) && !/(image|tts|live|audio|embedding|robotics|computer-use)/.test(n));
    const fresh = keepLatestGeneration(usable);
    const flash = fresh.filter((n) => /flash/.test(n));
    const rest = fresh.filter((n) => !/flash/.test(n));
    const byVersion = (a: string, b: string) => version(b) - version(a);
    return [...flash.sort(byVersion), ...rest.sort(byVersion)];
  } catch {
    return [];
  }
}

/**
 * The models endpoint lists every model the API ever served, including retired generations that
 * now answer 404 (e.g. gemini-2.5-flash) and tiers the caller's plan may not include. The plan
 * part cannot be read from the list, but the retired part follows the version number, so the
 * picker only offers the newest major generation the endpoint returned. Models without a version
 * (aliases like gemini-flash-latest) are dropped here: 'auto' already races them.
 */
export function keepLatestGeneration(models: string[]): string[] {
  const versioned = models.filter((n) => /^gemini-\d/.test(n));
  const maxMajor = versioned.reduce(
    (max, n) => Math.max(max, Number((/^gemini-(\d+)/.exec(n) || [])[1] || 0)),
    0
  );
  if (maxMajor === 0) return [];
  return versioned.filter((n) => Number((/^gemini-(\d+)/.exec(n) || [])[1] || 0) === maxMajor);
}

export type ModelAvailability = 'ok' | 'unavailable' | 'unknown';

/**
 * Answers whether this key can actually call this model, with the smallest possible generateContent
 * probe. 'unavailable' means the API said the model is retired, unknown, or not for this key
 * (isModelUnavailableMessage); 'unknown' covers rate limits, timeouts and server errors, where the
 * pick should still be saved because the translation failover recovers from a bad model.
 */
export async function probeGeminiModel(
  apiKey: string,
  model: string,
  signal?: AbortSignal
): Promise<ModelAvailability> {
  try {
    const res = await fetchWithTimeout(
      `${API_ROOT}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim(),
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 1, temperature: 0 },
        }),
      },
      15000,
      signal
    );
    if (res.ok) return 'ok';
    let message = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body?.error?.message || '';
    } catch (err) {
      debugIgnored('geminiDirect', err);
    }
    return isModelUnavailableMessage(res.status, message) ? 'unavailable' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Thinking levels each model accepts, from Google's thinking docs
 * (https://ai.google.dev/gemini-api/docs/thinking). The models endpoint only exposes whether a
 * model thinks at all (`thinking: boolean` on the Model resource); the per-model level list is
 * documentation, not API data, so it is a table here. First match wins, specific before generic.
 */
const THINKING_LEVEL_TABLE: Array<[RegExp, string[]]> = [
  [/^gemini-4-(neon|hydrogen)/, ['low', 'medium', 'high', 'xhigh']],
  [/^gemini-4-/, ['low', 'medium', 'high']],
  [/^gemini-3-pro/, ['low', 'high']],
  [/^gemini-3\.8-flash/, ['low', 'medium', 'high']],
  [/^gemini-3\.1-flash-lite-image/, ['minimal', 'high']],
  [/^gemini-3(\.\d+)?-flash-lite/, ['minimal', 'low', 'medium', 'high']],
  [/^gemini-3(\.(?!8)\d+)?-flash/, ['minimal', 'low', 'medium', 'high']],
  [/^gemini-3/, ['low', 'medium', 'high']],
  [/^gemini-2\.5/, ['low', 'medium', 'high']],
];
const DEFAULT_THINKING_LEVELS = ['low', 'medium', 'high'];

/** Levels the thinking picker may offer for this model. Unknown models get the safe middle set. */
export function geminiThinkingLevelsForModel(model: string | undefined): string[] {
  if (!model) return DEFAULT_THINKING_LEVELS;
  for (const [pattern, levels] of THINKING_LEVEL_TABLE) {
    if (pattern.test(model)) return levels;
  }
  return DEFAULT_THINKING_LEVELS;
}

/**
 * Maps the picker's thinking level onto the request shape the chosen model generation expects:
 * `thinkingLevel` for Gemini 3 and later, a numeric `thinkingBudget` for Gemini 2.5 (which has no
 * named levels: 0 disables thinking, so 'minimal' maps to it there). Returns undefined for 'auto'
 * or a level the model does not support, leaving the model's own default.
 */
export function geminiThinkingConfig(
  model: string,
  level: string | undefined
): { thinkingLevel?: string; thinkingBudget?: number } | undefined {
  if (!level || level === 'auto') return undefined;
  if (!geminiThinkingLevelsForModel(model).includes(level)) return undefined;
  const major = Number((/gemini-(\d+)/.exec(model) || [])[1] || 0);
  if (major >= 3) {
    return { thinkingLevel: level };
  }
  if (major === 2) {
    const budget: Record<string, number> = { minimal: 0, low: 1024, medium: 8192, high: 24576 };
    if (!(level in budget)) return undefined;
    return { thinkingBudget: budget[level] };
  }
  return undefined;
}

export async function geminiTranslateDirect(opts: {
  apiKey: string;
  sourceText: string;
  targetLang?: string;
  targetLocaleName?: string;
  pluralQuantity?: string;
  /** Aborts the call when the user cancels (distinct from the per-attempt timeout). */
  signal?: AbortSignal;
  /** Pinned model from the provider's settings; raced first when set, the other candidates still follow. */
  model?: string;
  /** Thinking strength from the provider's settings ('auto'/undefined keeps the model default). */
  thinkingLevel?: string;
}): Promise<string> {
  const { apiKey, sourceText, targetLang = 'ar', targetLocaleName, pluralQuantity, signal } = opts;
  const langLabel = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang;
  const pluralContext = pluralQuantity
    ? `\nThis value is the "${pluralQuantity}" CLDR plural form for ${langLabel}. Translate only this form; ` +
      'do not add, drop or renumber any ICU block or clause.'
    : '';
  const prompt = `Translate the following Android strings.xml value from English to ${langLabel}.${pluralContext}
Return ONLY the translated text without any metadata labels (never output "[ترجمة المصطلح: ...]") and preserve all placeholders (%s, %d, %1$s, %2$d, \\n, HTML tags) exactly as they appear; for an ICU MessageFormat block, protect only its syntax (variable names, format types, clause keywords, offset:, =0/=1 selectors, #, and the ' quote marks) and translate the human-readable text inside each clause.

Source string:
${sourceText}`;

  const callModel = async (model: string, sig?: AbortSignal): Promise<string> => {
    const generationConfig: Record<string, unknown> = { temperature: 0.1 };
    const thinking = geminiThinkingConfig(model, opts.thinkingLevel);
    if (thinking) generationConfig.thinkingConfig = thinking;
    const res = await fetchWithTimeout(
      `${API_ROOT}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim(),
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig,
        }),
      },
      GEMINI_TIMEOUT_MS,
      sig
    );

    // A model that does not know its thinking parameter answers 400; drop the setting and retry
    // once rather than failing a provider the user just configured.
    if (res.status === 400 && thinking) {
      let msg = '';
      try {
        const body = (await res.clone().json()) as { error?: { message?: string } };
        msg = body?.error?.message || '';
      } catch (err) {
        debugIgnored('geminiDirect', err);
      }
      if (/thinking/i.test(msg)) {
        generationConfig.thinkingConfig = undefined;
        delete generationConfig.thinkingConfig;
        const retry = await fetchWithTimeout(
          `${API_ROOT}/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey.trim(),
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig,
            }),
          },
          GEMINI_TIMEOUT_MS,
          sig
        );
        return handleModelResponse(retry);
      }
    }
    return handleModelResponse(res);
  };

  const handleModelResponse = async (res: Response): Promise<string> => {

    if (!res.ok) {
      let message =
        res.status === 401 || res.status === 403
          ? `Gemini: المفتاح غير صالح أو غير مفعّل / Invalid or disabled key (HTTP ${res.status})`
          : res.status === 429
            ? 'Gemini: تجاوزت حد الطلبات، حاول لاحقاً / Rate limit reached (HTTP 429)'
            : `Gemini: فشل الطلب / Request failed (HTTP ${res.status})`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) message = `Gemini: ${body.error.message}`;
      } catch (err) {
        debugIgnored('geminiDirect', err);
      }
      throw new GeminiHttpError(message, res.status, isModelUnavailableMessage(res.status, message));
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();
    if (!text) throw new Error('Gemini: استجابة فارغة / Empty translation response');

    // A single missing/extra brace, a translated clause keyword or a dropped `#` makes the
    // whole string unparseable at runtime (`String.format` throws). The prompt asks for the
    // structure to be preserved, but a model can still break it, so the reply is checked
    // structurally before it is accepted: a broken reply fails this model and the next one
    // is tried, instead of handing damaged ICU syntax to the user.
    const check = validatePlaceholders(sourceText, text, targetLang);
    if (!check.valid) {
      throw new GeminiStructureError(
        'Gemini: الردّ يخالف بنية ICU / The AI reply damaged the ICU MessageFormat structure'
      );
    }
    return text;
  };

  // A flaky model (overloaded 503, rate limit, timeout, network hiccup) must fail over to the
  // next candidate, not kill the whole call: during demand spikes the first alias can hang while
  // the next pinned model answers fine. The last such error is surfaced only if every model fails.
  const isTransientError = (err: unknown): boolean => {
    if (err instanceof GeminiHttpError) return err.status >= 500 || err.status === 429;
    if (err instanceof TypeError) return true; // network failure
    return err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
  };

  const tried = new Set<string>();
  let structureError: GeminiStructureError | null = null;
  let transientError: unknown = null;
  const attempt = async (model: string, sig?: AbortSignal): Promise<string | null> => {
    if (tried.has(model)) return null;
    tried.add(model);
    try {
      const out = await callModel(model, sig);
      workingModel = model;
      return out;
    } catch (err) {
      if (signal?.aborted) throw err; // the user cancelled: stop, don't fail over
      if (sig?.aborted) return null; // a sibling model won the race and aborted this one
      if (err instanceof GeminiHttpError && err.modelUnavailable) return null; // try the next model
      // A reply that breaks the ICU structure is worth retrying on another model too,
      // but the model itself works, so it stays the working model.
      if (err instanceof GeminiStructureError) {
        structureError = err;
        return null;
      }
      if (isTransientError(err)) {
        transientError = err;
        return null; // overloaded/slow model: try the next candidate
      }
      throw err;
    }
  };

  // Hedged race over untried models: first success wins and aborts the rest, a fatal error
  // (bad key) rejects immediately, and a model that fails fast brings the next one in early.
  // Resolves null when every model failed, leaving the recorded errors for the caller.
  const raceModels = (models: Array<string | null | undefined>): Promise<string | null> => {
    const fresh = models.filter((m): m is string => typeof m === 'string' && m.length > 0 && !tried.has(m));
    if (!fresh.length) return Promise.resolve(null);
    return new Promise<string | null>((resolve, reject) => {
      const inner = new AbortController();
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      let settled = false;
      let launched = 0;
      let pending = 0;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        signal?.removeEventListener('abort', onAbort);
        inner.abort();
        fn();
      };
      const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')));
      const launchNext = () => {
        if (settled || launched >= fresh.length) return;
        const model = fresh[launched++];
        pending++;
        attempt(model, inner.signal).then(
          (out) => {
            if (out !== null) finish(() => resolve(out));
            else {
              pending--;
              if (pending === 0 && launched >= fresh.length) finish(() => resolve(null));
              else launchNext(); // failed fast: bring the next candidate in without waiting
            }
          },
          (err) => finish(() => reject(err))
        );
      };
      signal?.addEventListener('abort', onAbort);
      launchNext();
      for (let i = 1; i < fresh.length; i++) {
        timers.push(setTimeout(launchNext, i * HEDGE_DELAY_MS));
      }
    });
  };

  const raced = await raceModels([opts.model, workingModel, ...GEMINI_MODEL_CANDIDATES]);
  if (raced !== null) return raced;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const discovered = await raceModels(await discoverFlashModels(apiKey, signal));
  if (discovered !== null) return discovered;
  workingModel = null;
  // Reachable only when every model failed; surface the structural problem when that was
  // the reason, since "no model available" would send the user to check a working key.
  if (structureError) throw structureError;
  // Every model failed transiently (demand spike, timeouts): say so instead of "no model available".
  if (transientError) throw transientError;
  throw new Error(
    'Gemini: لا يوجد نموذج متاح لهذا المفتاح حالياً / No Gemini model is available for this key. Check the key in Google AI Studio.'
  );
}

/** Verifies a Gemini key by translating one short word, entirely from the browser. */
export async function testGeminiKeyDirect(apiKey: string, signal?: AbortSignal): Promise<ProviderTestResult> {
  const testSource = 'Install';
  try {
    const providerTranslation = await geminiTranslateDirect({
      apiKey,
      sourceText: testSource,
      targetLang: 'ar',
      targetLocaleName: 'Arabic',
      signal,
    });
    return { success: true, matched: true, testSource, providerTranslation, detectedType: 'gemini' };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const network = err instanceof TypeError;
    return {
      success: false,
      matched: false,
      error: network
        ? `تعذّر الوصول إلى Gemini من هذا المتصفح (${raw}). تحقق من الاتصال أو من مانع الإعلانات. / Could not reach the Gemini API from this browser.`
        : raw,
    };
  }
}
