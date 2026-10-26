// Robust translation engine for Android strings with offline glossary, format token protection, and machine translation
import { ANDROID_LOCALIZATION_DICTIONARY, CASE_INSENSITIVE_GLOSSARY, ARABIC_PLURAL_GLOSSARY } from './glossary';
import { ResourceItem, SingleStringItem, PluralStringItem, ArrayStringItem } from '../types';
import { normalizePluralsForLanguage } from './xmlParser';
import {
  getStoredItem,
  setStoredItem,
  removeStoredItem,
  getSecret,
  setSecret,
  deleteSecret,
  isSecretVaultReady,
  scheduleStoredWrite,
} from './storage';
import { geminiTranslateDirect } from './geminiDirect';
import { fetchGoogleGtxRaw, fetchWithTimeout } from '../shared/translateCore';

/** Every engine a suggestion can come from. 'glossary' and 'heuristic' are offline. */
export type TranslationEngine = 'glossary' | 'heuristic' | ProviderEngineType;

/** Logs a fallback in development only; production users simply get the next engine. */
function logFallback(engine: string, err: unknown): void {
  if (import.meta.env?.DEV) {
    console.warn(`[translator] ${engine} failed, trying next engine:`, err);
  }
}

// Helper: Decode basic HTML entities that APIs sometimes return
function decodeHtmlEntities(str: string): string {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

// Convert Western digits to Arabic-Indic digits (for matching if an MT engine transliterates numbers)
function toArabicIndicDigits(numStr: string): string {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return numStr.replace(/\d/g, (d) => map[Number(d)]);
}

interface ProtectedToken {
  rawToken: string; // Exact original syntax token, e.g. %1$d, \"%1$s\", @string/msg_threads
  surrogateId: string; // e.g. 987100
  surrogateText: string; // What we put into the text sent to API
  position: 'start' | 'end' | 'before_punct' | 'middle';
  trailingPunct?: string;
}

// Protect Android syntax tokens in a single line/segment before sending to API
function protectSegmentSyntax(segment: string): {
  cleanText: string;
  tokens: ProtectedToken[];
  usesEscapedDoubleQuotes: boolean;
} {
  const usesEscapedDoubleQuotes = segment.includes('\\"');
  const tokens: ProtectedToken[] = [];

  // Match:
  // 1. Escaped-quote wrapped format specifiers: \"%1$s\", \'%s\'
  // 2. Parenthesized format specifiers: (%d), (%1$s)
  // 3. Compound format specifiers like %1$d/%2$d
  // 4. Standard Android printf format specifiers: %1$s, %2$d, %s, %d, %1$.1f, %.2f, %%
  // 5. Android @string/... or @plurals/... resource references
  // 6. ICU placeholders {0}, {count} and inline HTML tags <b>, </b>, etc.
  const syntaxRegex =
    /(\\"%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]\\"|\\'%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]\\'|%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]\/%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]|%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]|@(?:string|plurals|array)\/[a-zA-Z0-9_]+|\{[a-zA-Z0-9_-]+\}|<\/?[a-zA-Z][^>]*>)/gi;

  const trimmedSeg = segment.trim();

  let cleaned = segment.replace(syntaxRegex, (match, _g1, offset) => {
    const idx = tokens.length;
    const surrogateId = `98710${idx}`;
    const isQuoted =
      (match.startsWith('\\"') && match.endsWith('\\"')) ||
      (match.startsWith("\\'") && match.endsWith("\\'"));
    const surrogateText = isQuoted ? `"${surrogateId}"` : surrogateId;

    const beforeText = segment.slice(0, offset).trim();
    const afterText = segment.slice(offset + match.length).trim();

    let position: ProtectedToken['position'] = 'middle';
    let trailingPunct: string | undefined;

    if (!beforeText) {
      position = 'start';
    } else if (!afterText) {
      position = 'end';
    } else if (/^[?.!؟،,:;)]+$/.test(afterText)) {
      position = 'before_punct';
      trailingPunct = afterText;
    }

    tokens.push({
      rawToken: match,
      surrogateId,
      surrogateText,
      position,
      trailingPunct,
    });

    return surrogateText;
  });

  // Unescape remaining \' and \" for cleaner natural-language API input (we re-apply \" if source used it)
  cleaned = cleaned.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\?/g, '?');

  // Avoid unused variable warning
  void trimmedSeg;

  return { cleanText: cleaned, tokens, usesEscapedDoubleQuotes };
}

// Restore protected syntax tokens into the translated segment and guarantee none are missing
function restoreSegmentSyntax(
  translated: string,
  tokens: ProtectedToken[],
  usesEscapedDoubleQuotes: boolean
): string {
  let result = translated;

  tokens.forEach((tk, idx) => {
    const arabicId = toArabicIndicDigits(tk.surrogateId);
    const isQuotedToken =
      (tk.rawToken.startsWith('\\"') && tk.rawToken.endsWith('\\"')) ||
      (tk.rawToken.startsWith("\\'") && tk.rawToken.endsWith("\\'"));

    if (isQuotedToken) {
      // Replace quoted surrogate variations: "987100", «987100», \"987100\", or bare 987100
      const quotedPattern = new RegExp(
        `(?:\\\\?["'«»“”]\\s*)?(?:${tk.surrogateId}|${arabicId}|\\[\\s*#\\s*${idx}\\s*#\\s*\\])(?:\\s*\\\\?["'«»“”])?`,
        'g'
      );
      result = result.replace(quotedPattern, tk.rawToken);
    } else {
      const barePattern = new RegExp(
        `(?:${tk.surrogateId}|${arabicId}|\\[\\s*#\\s*${idx}\\s*#\\s*\\])`,
        'g'
      );
      result = result.replace(barePattern, tk.rawToken);
    }

    // Guarantee: If the translation engine stripped the surrogate token, insert rawToken in its structural position
    if (!result.includes(tk.rawToken)) {
      const trimmedRes = result.trim();
      if (tk.position === 'start') {
        result = `${tk.rawToken} ${trimmedRes}`;
      } else if (tk.position === 'end') {
        result = `${trimmedRes} ${tk.rawToken}`;
      } else if (tk.position === 'before_punct') {
        const punctMatch = trimmedRes.match(/([?.!؟،,:;)]+)$/);
        if (punctMatch) {
          const base = trimmedRes.slice(0, trimmedRes.length - punctMatch[1].length).trimEnd();
          result = `${base} ${tk.rawToken}${punctMatch[1]}`;
        } else {
          result = `${trimmedRes} ${tk.rawToken}`;
        }
      } else {
        result = `${trimmedRes} ${tk.rawToken}`;
      }
    }
  });

  // If the original segment escaped double quotes (\"), ensure any unescaped double quotes in the translation are also escaped as \"
  if (usesEscapedDoubleQuotes) {
    result = result.replace(/(?<!\\)"/g, '\\"');
  }

  return result;
}

export type ProviderEngineType =
  | 'google'
  | 'gemini'
  | 'mymemory'
  | 'yandex'
  | 'lara'
  | 'deepl'
  | 'openai'
  | 'google_cloud'
  | 'microsoft';

export interface TranslationProviderConfig {
  id: string;
  name: string;
  type: ProviderEngineType;
  apiKey?: string;
  /** Yandex Cloud folder ID; needed with an IAM token (personal account), not with a service-account API key. */
  folderId?: string;
  isBuiltIn?: boolean;
  verifiedAt?: number;
}

const CUSTOM_PROVIDERS_STORAGE_KEY = 'custom_translation_providers_v1';
const ACTIVE_PROVIDER_STORAGE_KEY = 'active_translation_provider_id_v1';
const AUTO_TRANSLATE_STORAGE_KEY = 'auto_translate_untranslated_v1';

export function getAutoTranslateEnabled(): boolean {
  try {
    return getStoredItem(AUTO_TRANSLATE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAutoTranslateEnabled(enabled: boolean): void {
  try {
    setStoredItem(AUTO_TRANSLATE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.error('Failed to save auto-translate setting:', e);
  }
}

export const BUILTIN_TRANSLATION_PROVIDERS: TranslationProviderConfig[] = [
  {
    id: 'google',
    name: 'Google Translate',
    type: 'google',
    isBuiltIn: true,
  },
  {
    id: 'mymemory',
    name: 'MyMemory TM',
    type: 'mymemory',
    isBuiltIn: true,
  },
];

export function getCustomProviders(): TranslationProviderConfig[] {
  try {
    const raw = getStoredItem(CUSTOM_PROVIDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is TranslationProviderConfig =>
          p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.type === 'string'
      )
      .map((p) => ({ ...p, apiKey: getSecret(p.id) ?? p.apiKey }));
  } catch {
    return [];
  }
}

/**
 * Saves providers. When the encrypted vault is ready the API keys go to the vault and are removed from
 * the plain JSON. Otherwise (no secure context) the keys stay in the JSON as before.
 */
export function saveCustomProviders(providers: TranslationProviderConfig[]): void {
  try {
    const vault = isSecretVaultReady();
    const toStore = providers.map((p) => {
      if (!vault) return p;
      if (p.apiKey) setSecret(p.id, p.apiKey);
      else deleteSecret(p.id);
      return { ...p, apiKey: undefined };
    });
    setStoredItem(CUSTOM_PROVIDERS_STORAGE_KEY, JSON.stringify(toStore));
  } catch (e) {
    console.error('Failed to save custom providers:', e);
  }
}

/** Moves API keys saved in plain text by older versions into the encrypted vault. Call after initStorage. */
export function migrateCustomProviderKeys(): void {
  if (!isSecretVaultReady()) return;
  try {
    const raw = getStoredItem(CUSTOM_PROVIDERS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<{ apiKey?: unknown }>;
    if (Array.isArray(parsed) && parsed.some((p) => typeof p?.apiKey === 'string' && p.apiKey)) {
      saveCustomProviders(getCustomProviders());
    }
  } catch (e) {
    console.error('Failed to migrate provider keys:', e);
  }
}

// Legacy: Gemini used to be a built-in provider whose key lived in its own storage slot.
// It is now a regular custom provider (type 'gemini') added from "Add API key".
// Any key saved the old way is migrated once into a custom provider.
const LEGACY_GEMINI_KEY_STORAGE = 'user_gemini_api_key_v1';

function migrateLegacyGeminiKey(): void {
  try {
    const legacyKey = (getStoredItem(LEGACY_GEMINI_KEY_STORAGE) || '').trim();
    if (!legacyKey) return;

    const current = getCustomProviders();
    let migrated = current.find(
      (p) => p.type === 'gemini' && (p.apiKey || '').trim() === legacyKey
    );
    if (!migrated) {
      migrated = {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: 'Gemini AI',
        type: 'gemini',
        apiKey: legacyKey,
        isBuiltIn: false,
        verifiedAt: Date.now(),
      };
      saveCustomProviders([...current, migrated]);
    }

    // If Gemini was the selected provider, keep it selected under its new id
    if (getStoredItem(ACTIVE_PROVIDER_STORAGE_KEY) === 'gemini') {
      setStoredItem(ACTIVE_PROVIDER_STORAGE_KEY, migrated.id);
    }
    removeStoredItem(LEGACY_GEMINI_KEY_STORAGE);
  } catch (e) {
    console.error('Failed to migrate legacy Gemini API key:', e);
  }
}

export function getAllTranslationProviders(): TranslationProviderConfig[] {
  migrateLegacyGeminiKey();
  return [...BUILTIN_TRANSLATION_PROVIDERS, ...getCustomProviders()];
}

export function getActiveProviderId(): string {
  try {
    const saved = getStoredItem(ACTIVE_PROVIDER_STORAGE_KEY);
    const all = getAllTranslationProviders();
    if (saved && all.some((p) => p.id === saved)) {
      return saved;
    }
  } catch {
    // Ignore storage read errors
  }
  // Google Translate works out-of-the-box
  return 'google';
}

export function setActiveProviderId(id: string): void {
  try {
    setStoredItem(ACTIVE_PROVIDER_STORAGE_KEY, id);
  } catch (e) {
    console.error('Failed to save active provider ID:', e);
  }
}

export function getActiveProvider(): TranslationProviderConfig {
  const id = getActiveProviderId();
  const all = getAllTranslationProviders();
  return all.find((p) => p.id === id) || BUILTIN_TRANSLATION_PROVIDERS[0];
}

export function addCustomProvider(input: {
  name: string;
  type: ProviderEngineType;
  apiKey: string;
  folderId?: string;
}): TranslationProviderConfig {
  const current = getCustomProviders();
  const newProvider: TranslationProviderConfig = {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    type: input.type,
    apiKey: input.apiKey.trim(),
    folderId: input.folderId?.trim() || undefined,
    isBuiltIn: false,
    verifiedAt: Date.now(),
  };
  const updated = [...current, newProvider];
  saveCustomProviders(updated);
  setActiveProviderId(newProvider.id);
  return newProvider;
}

export function updateCustomProvider(
  id: string,
  updates: {
    name?: string;
    type?: ProviderEngineType;
    apiKey?: string;
    folderId?: string;
  }
): TranslationProviderConfig | null {
  const current = getCustomProviders();
  const idx = current.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const existing = current[idx];
  const updatedProvider: TranslationProviderConfig = {
    ...existing,
    name: updates.name !== undefined ? updates.name.trim() || existing.name : existing.name,
    type: updates.type !== undefined ? updates.type : existing.type,
    apiKey: updates.apiKey !== undefined ? updates.apiKey.trim() : existing.apiKey,
    folderId:
      updates.folderId !== undefined ? updates.folderId.trim() || undefined : existing.folderId,
    verifiedAt: Date.now(),
  };

  const updatedList = [...current];
  updatedList[idx] = updatedProvider;
  saveCustomProviders(updatedList);
  return updatedProvider;
}

export function removeCustomProvider(id: string): void {
  const current = getCustomProviders();
  const updated = current.filter((p) => p.id !== id);
  saveCustomProviders(updated);
  deleteSecret(id);
  if (getActiveProviderId() === id) {
    setActiveProviderId('google');
  }
}

export interface ProviderTestResult {
  success: boolean;
  matched: boolean;
  testSource?: string;
  googleTranslation?: string;
  providerTranslation?: string;
  detectedType?: ProviderEngineType;
  error?: string;
}

export async function testProviderApiKey(
  providerType: string,
  apiKey: string,
  folderId?: string
): Promise<ProviderTestResult> {
  try {
    const res = await fetchWithTimeout(
      '/api/providers/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerType, apiKey: apiKey.trim(), folderId: folderId?.trim() || undefined }),
      },
      30000
    );
    const data = (await res.json()) as ProviderTestResult;
    return data;
  } catch (err) {
    return {
      success: false,
      matched: false,
      error: err instanceof Error ? err.message : 'Network error while testing API key',
    };
  }
}

/**
 * Strip any metadata wrappers or labels such as "[ترجمة المصطلح: ...]" or "[Translation: ...]"
 * while preserving legitimate brackets that were part of the original source text.
 */
export function stripMetadataLabels(text: string, sourceText: string): string {
  let cleaned = text.trim();

  // Remove prefixes/wrappers like "[ترجمة المصطلح: ...]", "ترجمة المصطلح: ...", "[Translation: ...]"
  const labelPattern = /^\[?\s*(?:ترجمة المصطلح|ترجمة النص|ترجمة|Translation|Translated text)\s*[:：-]\s*(.*?)\s*\]?$/i;
  const labelMatch = cleaned.match(labelPattern);
  if (labelMatch && labelMatch[1]) {
    cleaned = labelMatch[1].trim();
  }

  // Strip accidental markdown code fences
  if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Strip outer [...] if source did not have outer [...]
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

/**
 * Translate a single segment (without newline separators) via glossary, the selected Translation Provider
 * (Custom API Key Provider such as Gemini AI, Google Translate, or MyMemory),
 * while preserving 100% of Android syntax tokens (%s, %d, %1$s, etc.).
 */
type SuggestionResult = { text: string; source: TranslationEngine };

// ---------- Translation cache ----------
// Repeated strings (and re-opening a project) do not send the same request again. Keys include a hash
// of the provider key, so changing a key starts a fresh cache for that provider. Heuristic fallbacks are
// never cached, so they are retried later.
const TRANSLATION_CACHE_KEY = 'translation_cache_v1';
const TRANSLATION_CACHE_LIMIT = 5000;
let translationCache: Map<string, SuggestionResult> | null = null;

function getTranslationCache(): Map<string, SuggestionResult> {
  if (!translationCache) {
    translationCache = new Map();
    try {
      const raw = getStoredItem(TRANSLATION_CACHE_KEY);
      if (raw) {
        for (const [k, v] of JSON.parse(raw) as Array<[string, SuggestionResult]>) translationCache.set(k, v);
      }
    } catch {
      // A corrupt cache is simply discarded
    }
  }
  return translationCache;
}

function hashString(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function cacheKeyFor(segment: string, directLang: string, pluralQuantity: string | undefined): string {
  const provider = getActiveProvider();
  const providerSignature = `${provider.id}:${provider.type}:${hashString(provider.apiKey || '')}:${provider.folderId || ''}`;
  return [providerSignature, directLang, pluralQuantity || '', segment].join('\u0001');
}

function cachedSegmentLookup(key: string): SuggestionResult | undefined {
  const cache = getTranslationCache();
  const hit = cache.get(key);
  if (hit) {
    // Move to the end so the least recently used entries are evicted first
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSegmentResult(key: string, result: SuggestionResult): void {
  if (result.source === 'heuristic') return;
  const cache = getTranslationCache();
  cache.delete(key);
  cache.set(key, result);
  if (cache.size > TRANSLATION_CACHE_LIMIT) {
    cache.delete(cache.keys().next().value as string);
  }
  scheduleStoredWrite(TRANSLATION_CACHE_KEY, () => JSON.stringify([...cache.entries()]), 1500);
}

const ENGINE_LABELS: Record<string, string> = {
  google: 'Google',
  gemini: 'Gemini',
  mymemory: 'MyMemory',
  yandex: 'Yandex',
  lara: 'Lara',
  deepl: 'DeepL',
  openai: 'OpenAI',
  google_cloud: 'Google Cloud',
  microsoft: 'Microsoft',
  glossary: 'Glossary',
  heuristic: 'Heuristic',
};

/** Human-readable name of the engine that produced a suggestion. */
export function engineLabel(engine: string | undefined): string {
  if (!engine) return '';
  return ENGINE_LABELS[engine] ?? engine;
}

/** Clears saved suggestions (for example after the user changes the translation provider). */
export function clearTranslationCache(): void {
  translationCache = new Map();
  scheduleStoredWrite(TRANSLATION_CACHE_KEY, () => '[]', 0);
}

async function translateSingleSegment(
  segment: string,
  baseLang: string,
  directLang: string,
  targetLocaleName?: string,
  pluralQuantity?: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
): Promise<SuggestionResult> {
  const key = cacheKeyFor(segment, directLang, pluralQuantity);
  const cached = cachedSegmentLookup(key);
  if (cached) return cached;
  const result = await translateSingleSegmentUncached(segment, baseLang, directLang, targetLocaleName, pluralQuantity);
  cacheSegmentResult(key, result);
  return result;
}

async function translateSingleSegmentUncached(
  segment: string,
  baseLang: string,
  directLang: string,
  targetLocaleName?: string,
  pluralQuantity?: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
): Promise<SuggestionResult> {
  const leadingMatch = segment.match(/^[ \t]+/);
  const trailingMatch = segment.match(/[ \t]+$/);
  const leadingSpace = leadingMatch ? leadingMatch[0] : '';
  const trailingSpace = trailingMatch ? trailingMatch[0] : '';

  const trimmed = segment.trim();
  if (!trimmed) {
    return { text: segment, source: 'glossary' };
  }

  // If the segment is purely an Android resource reference (e.g. @string/limit_data_usage_none_description)
  // or purely a format token (e.g. %1$s), return it untouched
  if (/^(@(?:string|plurals|array)\/[a-zA-Z0-9_]+|%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%])$/.test(trimmed)) {
    return { text: segment, source: 'glossary' };
  }

  // Check if entire segment is wrapped in unescaped quotes "..." (like "Loading requested content")
  const hasOuterUnescapedQuotes =
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"') &&
    !trimmed.startsWith('\\"');
  const coreText = hasOuterUnescapedQuotes ? trimmed.slice(1, -1) : trimmed;

  const wrapResult = (translatedCore: string) => {
    const withQuotes = hasOuterUnescapedQuotes
      ? `"${translatedCore.replace(/^\\?"|\\?"$/g, '')}"`
      : translatedCore;
    return `${leadingSpace}${withQuotes}${trailingSpace}`;
  };

  const activeProvider = getActiveProvider();

  // 0. Check Arabic plural 6-form glossary if pluralQuantity is provided
  if (baseLang === 'ar' && pluralQuantity && ARABIC_PLURAL_GLOSSARY[coreText]) {
    const pluralMatch = ARABIC_PLURAL_GLOSSARY[coreText][pluralQuantity];
    if (pluralMatch) {
      return { text: wrapResult(pluralMatch), source: 'glossary' };
    }
  }

  // 1. Instant check in Android UI Glossary (exact or case-insensitive) when using built-in providers
  const glossaryItem =
    ANDROID_LOCALIZATION_DICTIONARY[coreText] ||
    CASE_INSENSITIVE_GLOSSARY[coreText.toLowerCase()];
  if (glossaryItem && activeProvider.isBuiltIn) {
    const match = glossaryItem[directLang] || glossaryItem[baseLang];
    if (match) {
      return { text: wrapResult(match), source: 'glossary' };
    }
  }

  const { cleanText, tokens, usesEscapedDoubleQuotes } = protectSegmentSyntax(coreText);

  // Helper to reject polluted crowdsourced TM entries (e.g. "[ترجمة المصطلح: Install]")
  const isPollutedTranslation = (candidate: string): boolean => {
    const c = candidate.trim();
    if (!c) return true;
    if (
      c.includes('ترجمة المصطلح') ||
      c.includes('INVALID TARGET LANGUAGE') ||
      c.includes('MYMEMORY WARNING')
    ) {
      return true;
    }
    // Reject if wrapped in [...] when original source had no brackets
    if (
      c.startsWith('[') &&
      c.endsWith(']') &&
      !coreText.startsWith('[') &&
      !coreText.endsWith(']')
    ) {
      return true;
    }
    return false;
  };

  // Helper for custom API key providers (Yandex, DeepL, OpenAI, ...). Always needs the user's key.
  const tryCustomProvider = async (): Promise<string | null> => {
    if (!activeProvider.apiKey) {
      return null;
    }
    try {
      const pRes = await fetchWithTimeout(
        '/api/providers/translate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerType: activeProvider.type,
            apiKey: activeProvider.apiKey,
            folderId: activeProvider.folderId,
            sourceText: coreText,
            targetLang: directLang,
            targetLocaleName,
            pluralQuantity,
          }),
        },
        25000
      );
      if (pRes.ok) {
        const pData = (await pRes.json()) as { translatedText?: string };
        if (pData && typeof pData.translatedText === 'string' && pData.translatedText.trim()) {
          const cleaned = stripMetadataLabels(pData.translatedText, coreText);
          if (cleaned && !isPollutedTranslation(cleaned)) {
            return restoreSegmentSyntax(cleaned, tokens, usesEscapedDoubleQuotes);
          }
        }
      }
    } catch (err) {
      logFallback('custom provider', err);
    }
    return null;
  };

  // Gemini AI (added as an API key provider): called straight from this browser with the user's own key (never via our server).
  const tryGeminiDirect = async (): Promise<string | null> => {
    // Only the selected Gemini provider's key is used, and only for Gemini. Other keys never go to Google.
    const userGeminiKey = activeProvider.type === 'gemini' ? activeProvider.apiKey : undefined;
    if (!userGeminiKey) return null;

    try {
      const translated = await geminiTranslateDirect({
        apiKey: userGeminiKey,
        sourceText: coreText,
        targetLang: directLang,
        targetLocaleName,
        pluralQuantity,
      });
      const cleanedAi = stripMetadataLabels(translated, coreText);
      if (cleanedAi && !isPollutedTranslation(cleanedAi)) {
        return restoreSegmentSyntax(cleanedAi, tokens, usesEscapedDoubleQuotes);
      }
    } catch (err) {
      logFallback('gemini', err);
    }
    return null;
  };

  // Helper for Google Translate GTX neural endpoint (unofficial; shared with the server)
  const tryGoogleGtx = async (): Promise<string | null> => {
    try {
      const combined = await fetchGoogleGtxRaw(cleanText, directLang, 5000);
      const decoded = stripMetadataLabels(decodeHtmlEntities(combined), coreText);
      if (decoded && !isPollutedTranslation(decoded)) {
        return restoreSegmentSyntax(decoded, tokens, usesEscapedDoubleQuotes);
      }
    } catch (err) {
      logFallback('google', err);
    }
    return null;
  };

  // Helper for MyMemory API
  const tryMyMemory = async (): Promise<string | null> => {
    try {
      const langPair = `en|${baseLang}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=${langPair}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data && data.responseData && data.responseData.translatedText) {
          let rawResult = stripMetadataLabels(decodeHtmlEntities(data.responseData.translatedText), coreText);

          const hasAllTokens = (textToCheck: string) =>
            tokens.every(
              (tk) =>
                textToCheck.includes(tk.surrogateId) ||
                textToCheck.includes(toArabicIndicDigits(tk.surrogateId)) ||
                textToCheck.includes(tk.rawToken)
            );

          if (
            (isPollutedTranslation(rawResult) || (tokens.length > 0 && !hasAllTokens(rawResult))) &&
            Array.isArray(data.matches)
          ) {
            const betterMatch = data.matches.find((m: { translation?: string }) => {
              if (!m || typeof m.translation !== 'string') return false;
              const decoded = stripMetadataLabels(decodeHtmlEntities(m.translation), coreText);
              if (isPollutedTranslation(decoded)) return false;
              return tokens.length === 0 || hasAllTokens(decoded);
            });
            if (betterMatch && betterMatch.translation) {
              rawResult = stripMetadataLabels(decodeHtmlEntities(betterMatch.translation), coreText);
            }
          }

          if (!isPollutedTranslation(rawResult)) {
            const finalResult = restoreSegmentSyntax(rawResult, tokens, usesEscapedDoubleQuotes);
            if (finalResult) {
              return finalResult;
            }
          }
        }
      }
    } catch (error) {
      console.warn('Machine translation fetch failed, using fallback:', error);
    }
    return null;
  };

  // Engine chain for the selected provider. The primary engine runs first. Only if it fails do the
  // fallbacks run, in parallel, and the highest-priority success wins. Gemini is used only when it is the
  // selected provider, so other providers' suggestions never call it.
  type Strategy = { engine: TranslationEngine; run: () => Promise<string | null> };
  let strategies: Strategy[];
  if (!activeProvider.isBuiltIn) {
    strategies =
      activeProvider.type === 'gemini'
        ? [{ engine: 'gemini', run: tryGeminiDirect }, { engine: 'google', run: tryGoogleGtx }, { engine: 'mymemory', run: tryMyMemory }]
        : [
            { engine: activeProvider.type, run: tryCustomProvider },
            { engine: 'google', run: tryGoogleGtx },
            { engine: 'mymemory', run: tryMyMemory },
          ];
  } else if (activeProvider.type === 'mymemory') {
    strategies = [{ engine: 'mymemory', run: tryMyMemory }, { engine: 'google', run: tryGoogleGtx }];
  } else {
    strategies = [{ engine: 'google', run: tryGoogleGtx }, { engine: 'mymemory', run: tryMyMemory }];
  }

  const primary = strategies[0];
  const primaryResult = await primary.run().catch(() => null);
  if (primaryResult) {
    return { text: wrapResult(primaryResult), source: primary.engine };
  }
  const fallbacks = await Promise.all(
    strategies.slice(1).map(async (strategy) => ({
      engine: strategy.engine,
      text: await strategy.run().catch(() => null),
    }))
  );
  const winner = fallbacks.find((f): f is { engine: TranslationEngine; text: string } => Boolean(f.text));
  if (winner) {
    return { text: wrapResult(winner.text), source: winner.engine };
  }

  // Fallback check in glossary if custom provider failed offline
  if (glossaryItem) {
    const match = glossaryItem[directLang] || glossaryItem[baseLang];
    if (match) {
      return { text: wrapResult(match), source: 'glossary' };
    }
  }

  // 4. Fallback Heuristic
  return { text: segment, source: 'heuristic' };
}

/**
 * Main translation function that resolves with the highest quality translation available
 * while preserving 100% of Android syntax (%1$s, %1$d, \n, \\n, multiline \n, quotes, etc.)
 */
export async function suggestTranslation(
  sourceText: string,
  targetLang: string,
  targetLocaleName?: string,
  pluralQuantity?: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
): Promise<SuggestionResult> {
  if (!sourceText || !sourceText.trim()) {
    return { text: '', source: 'glossary' };
  }

  const baseLang = targetLang.split('-')[0].toLowerCase();
  const directLang = targetLang.toLowerCase();

  // Split by Android newline / tab syntax separators so \n, \\n, and multiline \n are 100% untouched
  const separatorRegex = /(\r?\n\\n\r?\n\\n|\r?\n\\n|\\\\n|\\n\\n|\\n|\r?\n|\\t)/g;
  const parts = sourceText.split(separatorRegex);

  if (parts.length === 1) {
    return translateSingleSegment(sourceText, baseLang, directLang, targetLocaleName, pluralQuantity);
  }

  let overallSource: TranslationEngine = 'glossary';
  const translatedParts = await Promise.all(
    parts.map(async (part) => {
      if (!part) return part;
      if (separatorRegex.test(part)) {
        separatorRegex.lastIndex = 0;
        return part; // Keep exact \n / \\n / multiline separator untouched
      }
      separatorRegex.lastIndex = 0;
      const res = await translateSingleSegment(part, baseLang, directLang, targetLocaleName, pluralQuantity);
      if (res.source !== 'glossary' && res.source !== 'heuristic') overallSource = res.source;
      return res.text;
    })
  );

  return {
    text: translatedParts.join(''),
    source: overallSource,
  };
}

/**
 * Bulk translates a list of ResourceItems using suggestTranslation with controlled concurrency
 * and live progress reporting.
 */
export async function bulkTranslateItems(
  itemsToTranslate: ResourceItem[],
  targetLang: string,
  targetLocaleName?: string,
  onProgress?: (completed: number, total: number) => void
): Promise<ResourceItem[]> {
  const total = itemsToTranslate.length;
  if (total === 0) return [];

  const normalizedInput = normalizePluralsForLanguage(itemsToTranslate, targetLang);
  const results: ResourceItem[] = new Array(total);
  let completed = 0;

  const translateOneItem = async (item: ResourceItem): Promise<ResourceItem> => {
    if (item.type === 'string') {
      const single = item as SingleStringItem;
      const res = await suggestTranslation(single.source, targetLang, targetLocaleName);
      const targetText = res?.text || single.target;
      const hasTranslation = Boolean(targetText.trim());
      return {
        ...single,
        target: targetText,
        status: hasTranslation ? 'translated' : 'untranslated',
        translationSource: hasTranslation ? 'ai' : undefined,
        translationEngine: hasTranslation ? res?.source : undefined,
      };
    }

    if (item.type === 'plural') {
      const plural = item as PluralStringItem;
      let engineUsed: TranslationEngine | undefined;
      const updatedQuantities = await Promise.all(
        plural.items.map(async (pi) => {
          const res = await suggestTranslation(pi.source, targetLang, targetLocaleName, pi.quantity);
          engineUsed = engineUsed ?? res?.source;
          return {
            ...pi,
            target: res?.text || pi.target,
          };
        })
      );
      const anyFilled = updatedQuantities.some((pi) => pi.target.trim().length > 0);
      return {
        ...plural,
        items: updatedQuantities,
        status: anyFilled ? 'translated' : 'untranslated',
        translationSource: anyFilled ? 'ai' : undefined,
        translationEngine: anyFilled ? engineUsed : undefined,
      };
    }

    if (item.type === 'array') {
      const arr = item as ArrayStringItem;
      let engineUsed: TranslationEngine | undefined;
      const updatedElements = await Promise.all(
        arr.items.map(async (ai) => {
          const res = await suggestTranslation(ai.source, targetLang, targetLocaleName);
          engineUsed = engineUsed ?? res?.source;
          return {
            ...ai,
            target: res?.text || ai.target,
          };
        })
      );
      const anyFilled = updatedElements.some((ai) => ai.target.trim().length > 0);
      return {
        ...arr,
        items: updatedElements,
        status: anyFilled ? 'translated' : 'untranslated',
        translationSource: anyFilled ? 'ai' : undefined,
        translationEngine: anyFilled ? engineUsed : undefined,
      };
    }

    return item;
  };

  // Run with concurrency of 3 to avoid rate limits while remaining fast
  const CONCURRENCY = 3;
  let nextIdx = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
    while (nextIdx < total) {
      const currentIdx = nextIdx++;
      results[currentIdx] = await translateOneItem(normalizedInput[currentIdx]);
      completed++;
      onProgress?.(completed, total);
    }
  });

  await Promise.all(workers);
  return results;
}
