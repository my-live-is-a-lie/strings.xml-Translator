import { debugIgnored } from './debug';
// Calls the Gemini API straight from the browser with the user's own key.
// The key goes from this browser to Google only; it never passes through this app's server.
import type { ProviderTestResult } from './translator';
import { sourceLangName } from '../shared/sourceLang';
import { SYSTEM_INSTRUCTION, fetchWithTimeout } from '../shared/translateCore';
import { validatePlaceholders } from './placeholderCheck';
import {
  classifyGeminiKeyProblem,
  GeminiHttpError,
  isModelQuotaMessage,
  isModelUnavailableMessage,
  parseModelQuotaKind,
  type GeminiKeyProblem,
  type ModelQuotaKind,
} from '../shared/providerErrors';

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

/** Every candidate model is gone or retired for this key: the key answered, no model is usable. */
export class GeminiNoModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoModelError';
  }
}

/** The model that answered the most recent successful call; null after a full failure. */
export function getLastWorkingGeminiModel(): string | null {
  return workingModel;
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
      models?: Array<{
        name?: string;
        supportedGenerationMethods?: string[];
        thinking?: boolean;
        description?: string;
      }>;
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
        description: typeof m.description === 'string' ? m.description : '',
      }))
      .filter(
        (m) =>
          // Filter by what the API reports, not by name shape: any model the endpoint offers
          // generateContent on is a candidate, including new codename families (gemini-4-argon,
          // carbon, hydrogen, neon), specialty variants (customtools) and gemma. Whether one
          // actually answers for this key is decided by the lazy runtime probe, never by the list.
          // Specialties whose output is not plain text (speech, image, music, transcription,
          // agents, robotics) are excluded by the model's own description, with a name backstop
          // for the ones whose description stays silent (the API exposes no modality field).
          !/(tts|image|imagen|banana|lyria|music|transcribe|robotics|computer-use|antigravity|deep-research|embedding|native-audio|live|omni|veo)/i.test(
            m.name
          ) &&
          // The model resource's own description: exclude models documented as producing
          // non-text output. Input words ("accepts audio/images") must NOT match - every
          // multimodal text model takes those in.
          !/generates?\s+(images?|audio|speech|video|music)|text-to-speech|image generation|audio generation|music generation|transcription|text\s+to\s+image/i.test(
            m.description
          )
      )
      .map(({ name, thinking }) => ({ name, thinking }))
      // Newest first; within one version the general-purpose families outrank specialties.
      .sort(
        (a, b) =>
          version(b.name) - version(a.name) ||
          familyRank(a.name) - familyRank(b.name) ||
          a.name.localeCompare(b.name)
      );
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
   * True when every probe hit a model-scoped quota (per-model daily limit, e.g. limit 0 on the
   * free tier): the key is fine, this model is not on its tier or its daily quota is used up.
   * Callers warn but keep the pick; never cached (the daily quota resets).
   */
  modelQuota?: boolean;
  /** Set alongside modelQuota when the answer named its limit: not-on-plan vs daily-used. */
  quotaKind?: ModelQuotaKind;
  /**
   * True only when every probe got a definite API answer (success, a 400 about the thinking
   * parameter, or a 404 about the model). Transient failures (network, timeouts, 401/403, 429,
   * 5xx) make the result indefinite: callers must not cache it or let it mark anything.
   */
  definite: boolean;
  /**
   * Set by the after-add sweep: availability is known from a single bare attempt, but thinking
   * levels were never probed. Such entries group and order the picker but must NOT satisfy a
   * real probe request - picking the model still launches the lazy per-level probe.
   */
  levelsPending?: boolean;
}

export type GeminiSweepOutcome = 'ok' | 'unavailable' | 'model-quota' | 'key-quota' | 'inconclusive';
export interface GeminiSweepResult {
  outcome: GeminiSweepOutcome;
  quotaKind?: ModelQuotaKind;
}

/**
 * One bare generateContent attempt with a tight deadline, for the after-add model sweep. Only
 * definite answers classify: a 404-style answer marks the model unusable, a model-scoped quota
 * marks it plan-limited, a project/account quota is about the KEY (the caller stops the sweep),
 * and everything else - per-minute 429, 5xx, network, deadline - stays inconclusive so nothing
 * gets marked by a maybe.
 */
export async function sweepProbeGeminiModel(
  apiKey: string,
  model: string,
  timeoutMs = 2000
): Promise<GeminiSweepResult> {
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
      timeoutMs
    );
    if (res.ok) return { outcome: 'ok' };
    let message = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body?.error?.message || '';
    } catch (err) {
      debugIgnored('geminiDirect', err);
    }
    if (isModelUnavailableMessage(res.status, message)) return { outcome: 'unavailable' };
    if (isModelQuotaMessage(res.status, message))
      return { outcome: 'model-quota', quotaKind: parseModelQuotaKind(message) ?? 'limit-zero' };
    if (res.status === 429 && /per_?project|per_?account/i.test(message)) return { outcome: 'key-quota' };
    return { outcome: 'inconclusive' };
  } catch {
    return { outcome: 'inconclusive' };
  }
}

type LevelProbe =
  | 'ok'
  | 'level-unsupported'
  | 'model-unavailable'
  | 'model-quota'
  | GeminiKeyProblem
  | 'unknown';

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
  let seenQuotaKind: ModelQuotaKind | undefined;
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
      if (isModelQuotaMessage(res.status, message)) {
        seenQuotaKind = seenQuotaKind ?? parseModelQuotaKind(message);
        return 'model-quota';
      }
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
  // A model-scoped quota on every probe (per-model daily limit, e.g. limit 0 on the free tier)
  // says this model is not on the key's tier right now - the key itself is fine. Keep the pick
  // possible (availability 'unknown') but flag it so the UI warns, and never cache it: the daily
  // quota resets and a per-minute spike looks identical except for the metric name.
  if (results.every(([, r]) => r === 'model-quota')) {
    return {
      availability: 'unknown',
      levels: results.map(([level]) => level),
      keyProblem: null,
      definite: false,
      modelQuota: true,
      quotaKind: seenQuotaKind ?? 'limit-zero',
    };
  }
  const availability: ModelAvailability = results.some(([, r]) => r === 'ok' || r === 'level-unsupported')
    ? 'ok'
    : 'unknown';
  return {
    availability,
    levels: results
      .filter(([, r]) => r === 'ok' || r === 'unknown' || r === 'model-quota' || isKeyProblem(r))
      .map(([level]) => level),
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
  /** Source language of the project (base ISO code); English when omitted. */
  sourceLang?: string;
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
  /**
   * Candidate models to race after the pinned one; defaults to the built-in list. Verification
   * passes the full discovered list so one quota-limited or retired model never fails a key.
   */
  candidateModels?: string[];
  /**
   * Called the moment a model fails with a definite API answer (gone, or a model-scoped quota),
   * before the failover moves on. Transient failures never trigger it.
   */
  onModelDefiniteFailure?: (model: string, kind: 'unavailable' | 'model-quota', quotaKind?: ModelQuotaKind) => void;
  /** The call succeeded: the winning model (pinned or failover) that produced the translation. */
  onModelSuccess?: (model: string) => void;
  /**
   * The pinned model failed with a DEFINITE answer (gone, or a model-scoped quota) and a
   * failover model produced the translation instead: the caller should make the winner the
   * saved selection. Transient pinned failures never trigger this - the pick stands.
   */
  onModelFailover?: (model: string) => void;
}): Promise<string> {
  const { apiKey, sourceText, targetLang = 'ar', targetLocaleName, pluralQuantity, signal, sourceLang } = opts;
  const langLabel = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang;
  const pluralContext = pluralQuantity
    ? `\nThis value is the "${pluralQuantity}" CLDR plural form for ${langLabel}. Translate only this form; ` +
      'do not add, drop or renumber any ICU block or clause.'
    : '';
  const prompt = `Translate the following Android strings.xml value from ${sourceLangName(sourceLang)} to ${langLabel}.${pluralContext}
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
          'Gemini: انتهت صلاحية المفتاح / The API key expired';
      } else if (classified === 'invalid-key') {
        message =
          'Gemini: المفتاح غير صالح أو غير مفعّل / The API key is invalid or disabled';
      } else if (classified === 'quota-exhausted') {
        message =
          'Gemini: انتهت حصة أو رصيد هذا المفتاح / This key\'s quota or credit is exhausted';
      }
      // A model-scoped quota (per-model daily limit, e.g. limit 0 on the free tier) names the
      // model, not the key: say so, and never mark the provider card for it.
      const modelQuota = isModelQuotaMessage(res.status, apiMessage);
      if (modelQuota) {
        message =
          'Gemini: هذا النموذج غير متاح لخطتك / This model isn\'t available for your plan';
      }
      throw new GeminiHttpError(
        message,
        res.status,
        isModelUnavailableMessage(res.status, apiMessage || message),
        classified,
        modelQuota,
        modelQuota ? parseModelQuotaKind(apiMessage || message) : undefined
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
  let pinnedDefiniteFailed = false;
  let structureError: GeminiStructureError | null = null;
  let transientError: unknown = null;
  let keyProblemError: GeminiHttpError | null = null;
  let modelQuotaError: GeminiHttpError | null = null;
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
      if (err instanceof GeminiHttpError && err.modelQuota && !modelQuotaError) modelQuotaError = err;
      // A definite answer about the model the USER picked (gone, or its quota not on the plan)
      // is reported so the picker can move it to the unavailable group. Failover and discovery
      // candidates are only tried so the call can succeed: their answers keep them out of this
      // race but never mark them - the user did not choose them, and a background sweep must not
      // fill the unavailable group with models they never tried.
      if (
        err instanceof GeminiHttpError &&
        (err.modelUnavailable || err.modelQuota) &&
        model === opts.model
      ) {
        pinnedDefiniteFailed = true;
        try {
          opts.onModelDefiniteFailure?.(model, err.modelQuota ? 'model-quota' : 'unavailable', err.quotaKind);
        } catch (cbErr) {
          debugIgnored('geminiDirect', cbErr);
        }
      }
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

  const noteWinner = () => {
    if (!workingModel) return;
    try {
      opts.onModelSuccess?.(workingModel);
      if (opts.model && workingModel !== opts.model && pinnedDefiniteFailed) {
        opts.onModelFailover?.(workingModel);
      }
    } catch (cbErr) {
      debugIgnored('geminiDirect', cbErr);
    }
  };
  const raced = await raceModels([
    opts.model,
    workingModel,
    ...(opts.candidateModels?.length ? opts.candidateModels : GEMINI_MODEL_CANDIDATES),
  ]);
  if (raced !== null) {
    noteWinner();
    return raced;
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // Failover discovery: every text model the endpoint lists for this key (the picker's filter),
  // not only Flash - a plan can have Pro quota left when Flash is exhausted, or the reverse.
  const discoveredNames = opts.candidateModels?.length
    ? [] // the caller already raced the full list
    : (await listGeminiModels(apiKey, signal)).map((m) => m.name);
  const discovered = await raceModels(discoveredNames);
  if (discovered !== null) {
    noteWinner();
    return discovered;
  }
  workingModel = null;
  // Every model failed. A definite key problem outranks every other explanation: the user must
  // fix the key or the quota, not hunt for a model.
  if (keyProblemError) throw keyProblemError;
  // A model-scoped quota on every model is more actionable than a generic transient failure:
  // the key works, this model/tier does not. It never marks the provider card (no keyProblem).
  if (modelQuotaError && !structureError) throw modelQuotaError;
  // Reachable only when every model failed; surface the structural problem when that was
  // the reason, since "no model available" would send the user to check a working key.
  if (structureError) throw structureError;
  // Every model failed transiently (demand spike, timeouts): say so instead of "no model available".
  if (transientError) throw transientError;
  throw new GeminiNoModelError(
    'Gemini: لا يوجد نموذج متاح لهذا المفتاح حالياً / No Gemini model is available for this key. Check the key in Google AI Studio.'
  );
}

/** Verifies a Gemini key by translating one short word, entirely from the browser. */
export async function testGeminiKeyDirect(apiKey: string, signal?: AbortSignal): Promise<ProviderTestResult> {
  const testSource = 'Install';
  // Verification tests the KEY, not one model: every discovered text model is a candidate, so a
  // model that is quota-limited or retired on this plan never fails a working key.
  let candidateModels: string[] | undefined;
  try {
    const listed = await listGeminiModels(apiKey, signal);
    if (listed.length) candidateModels = listed.map((m) => m.name);
  } catch (err) {
    debugIgnored('geminiDirect', err);
  }
  try {
    const providerTranslation = await geminiTranslateDirect({
      apiKey,
      sourceText: testSource,
      targetLang: 'ar',
      targetLocaleName: 'Arabic',
      candidateModels,
      signal,
    });
    return {
      success: true,
      matched: true,
      testSource,
      providerTranslation,
      detectedType: 'gemini',
      workingModel: getLastWorkingGeminiModel() ?? undefined,
    };
  } catch (err) {
    // A model-scoped quota on every model still proves the key authenticated: Google enforces
    // quota per key, so an invalid key would have been rejected before any quota answer.
    if (err instanceof GeminiHttpError && err.modelQuota) {
      return { success: true, matched: true, detectedType: 'gemini', modelsQuotaLimited: true };
    }
    // Same logic for models that are gone (404) or that answered with a broken structure:
    // the API answered, so the key works; no usable translation came back.
    if (err instanceof GeminiNoModelError) {
      return { success: true, matched: true, detectedType: 'gemini', noWorkingModel: true };
    }
    if (err instanceof GeminiStructureError) {
      return { success: true, matched: true, detectedType: 'gemini', translationUnverified: true };
    }
    const errorKind: ProviderTestResult['errorKind'] =
      err instanceof GeminiHttpError && err.keyProblem
        ? err.keyProblem
        : err instanceof TypeError ||
            (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError'))
          ? 'unreachable'
          : err instanceof GeminiHttpError && err.status >= 500
            ? 'provider-error'
            : 'unknown';
    return {
      success: false,
      matched: false,
      errorKind,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
