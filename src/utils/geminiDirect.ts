import { debugIgnored } from './debug';
// Calls the Gemini API straight from the browser with the user's own key.
// The key goes from this browser to Google only; it never passes through this app's server.
import type { ProviderTestResult } from './translator';
import { SYSTEM_INSTRUCTION, fetchWithTimeout } from '../shared/translateCore';

export const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 15000;

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

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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
    throw new Error(message);
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
