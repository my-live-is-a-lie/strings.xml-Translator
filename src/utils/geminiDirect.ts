import { debugIgnored } from './debug';
// Calls the Gemini API straight from the browser with the user's own key.
// The key goes from this browser to Google only; it never passes through this app's server.
import type { ProviderTestResult } from './translator';
import { SYSTEM_INSTRUCTION, fetchWithTimeout } from '../shared/translateCore';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
// Google retires models for new keys from time to time ("no longer available to new users"), so no single
// name is trusted: the alias that always points at the current Flash model goes first, then pinned names,
// and as a last resort the list of models the key can actually use is asked for.
export const GEMINI_MODEL_CANDIDATES = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash'];
const GEMINI_TIMEOUT_MS = 15000;

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

/** True when the API says this model can't be used (retired, unknown, or not for this key), not that the key is bad. */
export function isModelUnavailableMessage(status: number, message: string): boolean {
  if (status === 404) return true;
  return (
    (status === 400 || status === 403) &&
    /no longer available|not found|is not supported|not available to new users|deprecated/i.test(message)
  );
}

/** Asks Google which models this key can call and returns Flash models, newest first. */
async function discoverFlashModels(apiKey: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    `${API_ROOT}/models?pageSize=200`,
    { headers: { 'x-goog-api-key': apiKey.trim() } },
    GEMINI_TIMEOUT_MS
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
}): Promise<string> {
  const { apiKey, sourceText, targetLang = 'ar', targetLocaleName, pluralQuantity } = opts;
  const langLabel = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang;
  const pluralContext = pluralQuantity
    ? `\nPlural quantity category: "${pluralQuantity}" (CLDR plural form for ${langLabel}).`
    : '';
  const prompt = `Translate the following Android strings.xml value from English to ${langLabel}.${pluralContext}
Return ONLY the translated text without any metadata labels (never output "[ترجمة المصطلح: ...]") and preserve all placeholders (%s, %d, %1$s, %2$d, \\n, HTML tags) exactly as they appear.

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
    GEMINI_TIMEOUT_MS
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
  return text;
  };

  const tried = new Set<string>();
  const attempt = async (model: string): Promise<string | null> => {
    if (tried.has(model)) return null;
    tried.add(model);
    try {
      const out = await callModel(model);
      workingModel = model;
      return out;
    } catch (err) {
      if (err instanceof GeminiHttpError && err.modelUnavailable) return null; // try the next model
      throw err;
    }
  };

  for (const model of [workingModel, ...GEMINI_MODEL_CANDIDATES]) {
    if (!model) continue;
    const out = await attempt(model);
    if (out !== null) return out;
  }
  for (const model of await discoverFlashModels(apiKey)) {
    const out = await attempt(model);
    if (out !== null) return out;
  }
  workingModel = null;
  throw new Error(
    'Gemini: لا يوجد نموذج متاح لهذا المفتاح حالياً / No Gemini model is available for this key. Check the key in Google AI Studio.'
  );
}

/** Verifies a Gemini key by translating one short word, entirely from the browser. */
export async function testGeminiKeyDirect(apiKey: string): Promise<ProviderTestResult> {
  const testSource = 'Install';
  try {
    const providerTranslation = await geminiTranslateDirect({
      apiKey,
      sourceText: testSource,
      targetLang: 'ar',
      targetLocaleName: 'Arabic',
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
