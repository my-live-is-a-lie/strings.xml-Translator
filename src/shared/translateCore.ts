// Code shared by the browser and the Express server: prompt, fetch with timeout, Google GTX helper,
// metadata cleanup and comparison helpers. Keep this file free of browser-only and Node-only APIs.

export const SYSTEM_INSTRUCTION = `You are an expert Android strings.xml localization engine.
Follow these strict rules for every translation:
1. Return ONLY the final translated string text. Do NOT include any metadata labels, prefixes, explanations, notes, or bracketed tags such as "[ترجمة المصطلح: ...]", "[ترجمة: ...]", "[Translation: ...]", or markdown code fences.
2. Strictly preserve all original formatting and Android syntax tokens in their exact form:
   - Printf format specifiers (e.g., %s, %d, %1$s, %2$d, %1$.1f, %%)
   - Escape sequences (e.g., \\n, \\\\n, \\t, \\', \\")
   - Inline HTML/XML tags (e.g., <b>, </b>, <i>, <u>, <xliff:g>)
   - Resource references (e.g., @string/..., @plurals/...) and simple ICU placeholders (e.g., {0}, {count})
3. For ICU MessageFormat blocks, preserve the ENTIRE structure and translate ONLY the human-readable text inside each clause:
   - Keep the variable name, the format type (plural, select, selectordinal, number, date, time) and every structure token unchanged: never translate plural, select, selectordinal, offset:, the category names (zero, one, two, few, many, other), an explicit =0/=1 selector, or the # that ICU replaces with the formatted number inside a plural/selectordinal clause.
   - Every clause keyword must be followed by its own { } body, and the message stays a single line: {gender, select, male {He} other {They}} is valid, {gender, select, male He other They} is not. Never leave a clause keyword followed by bare text.
   - Keep every clause, including the mandatory other clause; do not remove, merge or reorder clauses, and never change a variable's format type (e.g., {amount, number} must stay number, never become date).
   - For plural and selectordinal blocks, adapt the category set to the target language: Arabic needs zero, one, two, few, many and other, while Japanese needs only other — adding a category the target language requires is allowed and expected (copy the nearest existing form as a placeholder if you must). Never remove other, never change an offset: value or an explicit =0/=1 selector, and never add, remove or change select keys.
   - A quoted literal '...' is text, and its quote marks are part of the ICU syntax: keep every ' exactly as it appears and translate only the words inside the quotes (''Hello!'' keeps both quotes and only "Hello!" is translated; '{count} new' keeps both quotes and translates "new"). If what is inside the quotes is itself syntax, keep it unchanged (e.g., '{username}' must stay '{username}').
   - Example: {count, plural, one {# message} other {# messages}} — translate only "message" and "messages"; keep the braces, {count, plural, one, other and # exactly as they are.
   - Example: {gender, select, male {He} female {She} other {They}} — translate only He, She and They.
   - Never wrap the whole message in quotes, brackets or a code fence, and never add or drop spaces around the braces.
4. Use natural, concise mobile UI terminology appropriate for Android applications (for example, translate "Install" to "تثبيت" in Arabic).
5. Preserve leading or trailing whitespace and outer quotes only if they exist in the source string.`;

/** fetch() with a hard timeout so a slow provider can never freeze a translation.
 *  An optional caller signal (e.g. a Cancel button) is combined with the timeout. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10000,
  signal?: AbortSignal
): Promise<Response> {
  const combined = signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal: combined });
}

/** Maps an HTTP status from a provider to a message the user can act on (Arabic first). */
export function providerHttpError(providerName: string, status: number): Error {
  if (status === 401 || status === 403) {
    return new Error(
      `${providerName}: المفتاح غير صالح أو لا يملك الصلاحية المطلوبة / Invalid key or missing permission (HTTP ${status})`
    );
  }
  if (status === 429) {
    return new Error(`${providerName}: تجاوزت حد الطلبات، حاول لاحقاً / Rate limit reached, try again later (HTTP 429)`);
  }
  return new Error(`${providerName}: فشل الطلب / Request failed (HTTP ${status})`);
}

export function stripMetadataWrappers(text: string, sourceText: string): string {
  let cleaned = text.trim();

  // Strip common metadata labels like [ترجمة المصطلح: ...] or [Translation: ...]
  const metadataRegex = /^\[?\s*(?:ترجمة المصطلح|ترجمة النص|ترجمة|Translation|Translated text)\s*[:：-]\s*(.*?)\s*\]?$/i;
  const match = cleaned.match(metadataRegex);
  if (match && match[1]) {
    cleaned = match[1].trim();
  }

  // Strip accidental markdown code fences
  if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // If the AI wrapped the whole output in [...] when the source was not wrapped in [...]
  if (
    cleaned.startsWith('[') &&
    cleaned.endsWith(']') &&
    !sourceText.trim().startsWith('[') &&
    !sourceText.trim().endsWith(']')
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

export function normalizeForComparison(str: string): string {
  return str
    .trim()
    .toLowerCase()
    // Remove Arabic diacritics (tashkeel) and tatweel
    .replace(/[ً-ٰٟـ]/g, '')
    // Normalize Arabic Alef variants
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize Taa Marbuta to Haa
    .replace(/ة/g, 'ه')
    // Normalize Alef Maksura to Yaa
    .replace(/ى/g, 'ي')
    // Remove punctuation
    .replace(/[.,!?;:؟،"«»'()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Google's public GTX endpoint. It is unofficial and undocumented: it may stop working at any time. */
export function googleGtxLanguage(targetLang: string): string {
  const lower = targetLang.toLowerCase();
  if (lower === 'zh-rcn') return 'zh-CN';
  if (lower === 'zh-rtw') return 'zh-TW';
  if (lower === 'pt-rbr') return 'pt-BR';
  return lower.split('-')[0];
}

/** Returns the raw translated text from Google GTX (concatenated chunks). Throws on failure. */
export async function fetchGoogleGtxRaw(text: string, targetLang: string, timeoutMs = 5000): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(
    googleGtxLanguage(targetLang)
  )}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res.ok) {
    throw new Error(`Google Translate HTTP ${res.status}`);
  }
  const data: unknown = await res.json();
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return (data[0] as unknown[])
      .map((chunk) => (Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : ''))
      .join('');
  }
  throw new Error('Invalid Google Translate response');
}
