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

let workingModel: string | null = null;

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

export async function geminiTranslateDirect(opts: {
  apiKey: string;
  sourceText: string;
  targetLang?: string;
  targetLocaleName?: string;
  pluralQuantity?: string;
  /** Aborts the call when the user cancels (distinct from the per-attempt timeout). */
  signal?: AbortSignal;
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

  const callModel = async (model: string): Promise<string> => {
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
          generationConfig: { temperature: 0.1 },
        }),
      },
      GEMINI_TIMEOUT_MS,
      signal
    );

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
  const attempt = async (model: string): Promise<string | null> => {
    if (tried.has(model)) return null;
    tried.add(model);
    try {
      const out = await callModel(model);
      workingModel = model;
      return out;
    } catch (err) {
      if (signal?.aborted) throw err; // the user cancelled: stop, don't fail over
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

  for (const model of [workingModel, ...GEMINI_MODEL_CANDIDATES]) {
    if (!model) continue;
    const out = await attempt(model);
    if (out !== null) return out;
  }
  for (const model of await discoverFlashModels(apiKey, signal)) {
    const out = await attempt(model);
    if (out !== null) return out;
  }
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
