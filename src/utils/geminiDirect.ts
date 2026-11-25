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

/** Definite key/account problems the user must hear about, distinct from a plain rate limit. */
export type GeminiKeyProblem = 'expired-key' | 'invalid-key' | 'quota-exhausted';

/**
 * Maps a Gemini error to a definite key problem: an expired key (403 saying so), 401 and other
 * key-related 403s (invalid or restricted), and a 429 about daily quota or billing (exhausted
 * credit). A plain 429 (per-minute rate limit) and model-specific 403s are NOT key problems.
 */
export function classifyGeminiKeyProblem(status: number, message: string): GeminiKeyProblem | null {
  if (isModelUnavailableMessage(status, message)) return null;
  if (status === 401) return 'invalid-key';
  if (status === 403 && /key|permission|leaked|referer|ip address|disabled|expired/i.test(message)) {
    return /expired|renew/i.test(message) ? 'expired-key' : 'invalid-key';
  }
  if (status === 429 && /per.?day|daily|billing|credit|account/i.test(message)) return 'quota-exhausted';
  return null;
}

export class GeminiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly modelUnavailable: boolean,
    readonly keyProblem: GeminiKeyProblem | null = null
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
 * One entry of the model picker. `thinking` is the Model resource's own flag
 * (https://ai.google.dev/api/models): whether the model reasons at all. Nothing about specific
 * versions is assumed here; what the endpoint returns is what the picker offers.
 */
export interface GeminiModelInfo {
  name: string;
  thinking: boolean;
}

/** Model family, used only to order the picker (Flash first): no filtering hangs off this. */
export function geminiModelFamily(name: string): 'flash' | 'flash-lite' | 'pro' | 'other' {
  if (/^gemini-\d+(?:\.\d+)?-flash-lite/.test(name)) return 'flash-lite';
  if (/^gemini-\d+(?:\.\d+)?-flash/.test(name)) return 'flash';
  if (/^gemini-\d+(?:\.\d+)?-pro/.test(name)) return 'pro';
  return 'other';
}

/**
 * Lists the text models the endpoint returns for this key, for the model picker. The only filters
 * are structural (the model must accept generateContent and not be an image/audio/embedding/etc
 * variant): retired or plan-restricted models can still appear here, because the endpoint does not
 * mark them; a picked model is verified with probeGeminiModel before it is saved. Ordered Flash
 * first, then Flash-Lite, Pro, and the rest, newest version first inside each family.
 */
export async function listGeminiModels(apiKey: string, signal?: AbortSignal): Promise<GeminiModelInfo[]> {
  try {
    const res = await fetchWithTimeout(
      `${API_ROOT}/models?pageSize=200`,
      { headers: { 'x-goog-api-key': apiKey.trim() } },
      10000,
      signal
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[]; thinking?: boolean }>;
    };
    const version = (n: string) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
    const familyRank = (n: string) => {
      const fam = geminiModelFamily(n);
      return fam === 'flash' ? 0 : fam === 'flash-lite' ? 1 : fam === 'pro' ? 2 : 3;
    };
    return (data.models || [])
      .filter((m) => m.name && (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({
        name: (m.name as string).replace(/^models\//, ''),
        thinking: m.thinking !== false,
      }))
      .filter(
        (m) =>
          /^gemini-/.test(m.name) &&
          !/(image|tts|live|audio|embedding|robotics|computer-use)/.test(m.name)
      )
      .sort((a, b) => familyRank(a.name) - familyRank(b.name) || version(b.name) - version(a.name));
  } catch {
    return [];
  }
}

export type ModelAvailability = 'ok' | 'unavailable' | 'unknown';

/**
 * The thinking level names the Gemini API defines (its thinkingLevel enum). Which of them a given
 * model accepts is NOT in the API, so it is discovered at runtime by probeGeminiModel instead of a
 * hardcoded per-model table.
 */
export const GEMINI_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export interface ModelProbeResult {
  availability: ModelAvailability;
  /** Levels the model accepted (plus inconclusive probes kept, so a transient error hides nothing). */
  levels: string[];
  /** Set when every probe reported the same definite key/account problem. */
  keyProblem?: GeminiKeyProblem | null;
  /**
   * True only when every probe got a definite API answer (success, a 400 about the thinking
   * parameter, or a 404 about the model). Transient failures (network, timeouts, 401/403, 429,
   * 5xx) make the result indefinite: callers must not cache it or let it mark anything.
   */
  definite: boolean;
}

type LevelProbe = 'ok' | 'level-unsupported' | 'model-unavailable' | GeminiKeyProblem | 'unknown';

/**
 * Probes a model with one tiny generateContent call per thinking level, in parallel: five calls,
 * one output token each. A 400 complaining about the thinking parameter marks the level
 * unsupported; a 404/"no longer available" marks the model itself unusable for this key
 * (isModelUnavailableMessage); rate limits, timeouts and server errors stay inconclusive so a
 * transient failure never hides a level or blocks a pick.
 */
export async function probeGeminiModel(
  apiKey: string,
  model: string,
  signal?: AbortSignal
): Promise<ModelProbeResult> {
  const probeLevel = async (level: string): Promise<LevelProbe> => {
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
            generationConfig: {
              maxOutputTokens: 1,
              temperature: 0,
              thinkingConfig: { thinkingLevel: level },
            },
          }),
        },
        10000,
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
      if (isModelUnavailableMessage(res.status, message)) return 'model-unavailable';
      const keyProblem = classifyGeminiKeyProblem(res.status, message);
      if (keyProblem) return keyProblem;
      if (res.status === 400 && /thinking/i.test(message)) return 'level-unsupported';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  };
  const results = await Promise.all(
    GEMINI_THINKING_LEVELS.map(async (level) => [level, await probeLevel(level)] as const)
  );
  // Key problems are definite about the key, not the model: they surface as keyProblem and keep
  // the result indefinite so nothing about the model gets cached.
  const isKeyProblem = (r: LevelProbe): r is GeminiKeyProblem =>
    r === 'expired-key' || r === 'invalid-key' || r === 'quota-exhausted';
  const keyProblem = results.every(([, r]) => isKeyProblem(r)) ? (results[0][1] as GeminiKeyProblem) : null;
  const definite = results.every(
    ([, r]) => r === 'ok' || r === 'level-unsupported' || r === 'model-unavailable'
  );
  if (results.every(([, r]) => r === 'model-unavailable')) {
    return { availability: 'unavailable', levels: [], keyProblem: null, definite: true };
  }
  const availability: ModelAvailability = results.some(([, r]) => r === 'ok' || r === 'level-unsupported')
    ? 'ok'
    : 'unknown';
  return {
    availability,
    levels: results.filter(([, r]) => r === 'ok' || r === 'unknown' || isKeyProblem(r)).map(([level]) => level),
    keyProblem,
    definite,
  };
}

/**
 * Maps the picker's thinking level onto the request. The level names are the API's enum, sent as
 * thinkingLevel for every model; a model that rejects the parameter answers 400 and callModel
 * retries once without it, so no per-model request shapes live here. Returns undefined for 'auto'
 * or an unknown level, leaving the model's own default.
 */
export function geminiThinkingConfig(level: string | undefined): { thinkingLevel?: string } | undefined {
  if (!level || level === 'auto') return undefined;
  if (!(GEMINI_THINKING_LEVELS as readonly string[]).includes(level)) return undefined;
  return { thinkingLevel: level };
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
    const thinking = geminiThinkingConfig(opts.thinkingLevel);
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
      let apiMessage = '';
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        apiMessage = body?.error?.message || '';
        if (apiMessage) message = `Gemini: ${apiMessage}`;
      } catch (err) {
        debugIgnored('geminiDirect', err);
      }
      // A definite key problem gets one clear Arabic-first line, whatever Google's wording was:
      // verification and suggestions both surface this message as-is.
      const classified = classifyGeminiKeyProblem(res.status, apiMessage);
      if (classified === 'expired-key') {
        message =
          'Gemini: انتهت صلاحية المفتاح، جدّده من Google AI Studio / The API key expired - renew it in Google AI Studio';
      } else if (classified === 'invalid-key') {
        message =
          'Gemini: المفتاح غير صالح أو غير مفعّل / The API key is invalid or disabled';
      } else if (classified === 'quota-exhausted') {
        message =
          'Gemini: انتهت حصة أو رصيد هذا المفتاح / This key\'s quota or credit is exhausted';
      }
      throw new GeminiHttpError(
        message,
        res.status,
        isModelUnavailableMessage(res.status, apiMessage || message),
        classified
      );
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
  let keyProblemError: GeminiHttpError | null = null;
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
      // A definite key problem (invalid/expired key, exhausted quota) is remembered so the caller
      // can surface it even when the failover hides it behind other models' failures.
      if (err instanceof GeminiHttpError && err.keyProblem && !keyProblemError) keyProblemError = err;
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
  // Every model failed. A definite key problem outranks every other explanation: the user must
  // fix the key or the quota, not hunt for a model.
  if (keyProblemError) throw keyProblemError;
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
