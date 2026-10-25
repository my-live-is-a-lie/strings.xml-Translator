// Calls the Gemini API straight from the browser with the user's own key.
// The key goes from this browser to Google only; it never passes through this app's server.
// (Same wording as SYSTEM_INSTRUCTION in server.ts, which other providers still use.)
import type { ProviderTestResult } from './translator';

export const GEMINI_MODEL = 'gemini-2.5-flash';

const GEMINI_SYSTEM_INSTRUCTION = `You are an expert Android strings.xml localization engine.
Follow these strict rules for every translation:
1. Return ONLY the final translated string text. Do NOT include any metadata labels, prefixes, explanations, notes, or bracketed tags such as "[ترجمة المصطلح: ...]", "[ترجمة: ...]", "[Translation: ...]", or markdown code fences.
2. Strictly preserve all original formatting and Android syntax tokens in their exact form:
   - Printf format specifiers (e.g., %s, %d, %1$s, %2$d, %1$.1f, %%)
   - Escape sequences (e.g., \\n, \\\\n, \\t, \\', \\")
   - Inline HTML/XML tags (e.g., <b>, </b>, <i>, <u>, <xliff:g>)
   - Resource references (e.g., @string/..., @plurals/...) and ICU placeholders (e.g., {0}, {count})
3. Use natural, concise mobile UI terminology appropriate for Android applications (for example, translate "Install" to "تثبيت" in Arabic).
4. Preserve leading or trailing whitespace and outer quotes only if they exist in the source string.`;

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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: GEMINI_SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 },
      }),
    }
  );

  if (!res.ok) {
    let message = `Gemini API HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // keep the generic message
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
  if (!text) throw new Error('Gemini API returned an empty translation response');
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
        ? `Could not reach the Gemini API from this browser (${raw}). Check your connection or content blockers.`
        : raw,
    };
  }
}
