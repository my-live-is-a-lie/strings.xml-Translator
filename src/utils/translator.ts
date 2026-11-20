import { debugIgnored } from './debug';
import { countLineBreaks } from './newlines';
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
import { fetchGoogleGtxRaw, fetchWithTimeout, providerHttpError } from '../shared/translateCore';
import { directCallProviderWithKey, directTestProviderApiKey } from './directProviders';
import { findClauseBodyOpens, hasMultilineIcuBlock, splitIcuBlocks, validatePlaceholders } from './placeholderCheck';

/** Every engine a suggestion can come from. 'glossary' and 'heuristic' are offline. */
export type TranslationEngine = 'glossary' | 'heuristic' | ProviderEngineType;

// Base URL of the translation server. Empty means same origin (the web app served by the server).
// In Android APK, CapacitorHttp bypasses CORS so providers can also be called directly without a server.
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || '').replace(/\/$/, '');

export function isNativeApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/** True when the translation server can be reached (same origin on the web, or VITE_API_BASE in the app). */
export function serverProvidersAvailable(): boolean {
  return API_BASE !== '' || !isNativeApp();
}

/** Native app: key providers are called straight from the device through CapacitorHttp (no CORS). */
export function directProvidersAvailable(): boolean {
  return isNativeApp();
}

const PROVIDERS_UNAVAILABLE =
  'مزودو المفاتيح يتطلبون خادم الترجمة، وهو غير متاح هنا. / API-key providers need the translation server, which is not reachable here.';

/** Logs a fallback in development only; production users simply get the next engine. */
function logFallback(engine: string, err: unknown): void {
  if (import.meta.env?.DEV) {
    console.warn(`[translator] ${engine} failed, trying next engine:`, err);
  }
}

/**
 * True when a failed request is worth retrying: a network failure, a timeout, or a
 * transient HTTP status (429 rate limit, 408 timeout, 5xx). Auth errors (401/403) and
 * bad requests (400) are permanent for this call and are never retried.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network failure ("Failed to fetch")
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
    // A structurally damaged reply is a deterministic answer to this prompt: retrying the
    // same request costs quota and time without a better chance of success.
    if (err.name === 'StructuralError') return false;
    const http = err.message.match(/HTTP (\d{3})/);
    if (http) {
      const status = Number(http[1]);
      return status === 408 || status === 429 || (status >= 500 && status < 600);
    }
  }
  return false;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Total attempts including the first one. Default 3 (one try + two retries). */
  maxAttempts?: number;
  /** Delay before the first retry; doubles after each attempt. Default 500ms. */
  baseDelayMs?: number;
}

/**
 * Runs `fn`, retrying it with exponential backoff when it fails with a retryable error
 * (see `isRetryableError`). Gives up after `maxAttempts` and rethrows the last error.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts || !isRetryableError(err)) throw err;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}

// Helper: Decode basic HTML entities that APIs sometimes return
function decodeHtmlEntities(str: string): string {
  // DOMParser builds an inert document: no scripts run and no resources load from provider output.
  const doc = new DOMParser().parseFromString(str, 'text/html');
  return doc.documentElement.textContent ?? '';
}

// Convert Western digits to Arabic-Indic digits (for matching if an MT engine transliterates numbers)
function toArabicIndicDigits(numStr: string): string {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return numStr.replace(/\d/g, (d) => map[Number(d)]);
}

interface ProtectedToken {
  rawToken: string; // Exact original syntax token, e.g. %1$d, \"%1$s\", @string/msg_threads
  /** True for an ICU clause body (`{He}` in a `select`): text ICU replaces, not syntax. */
  isClauseText?: boolean;
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
  // Offsets of ICU clause bodies, so `{He}` inside a `select` is known to be translatable
  // text while `{count}` is a placeholder. Without this the two are indistinguishable by
  // their text alone.
  const clauseBodyOpens = findClauseBodyOpens(segment);

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
      isClauseText: clauseBodyOpens.has(offset),
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

/**
 * True when re-inserting `rawToken` would duplicate structure the reply already carries.
 *
 * Shape tokens (`{name:type}`, `offset:`, `=0`, `#`, `%s`, `<b>`, `@string/...`) are pure
 * syntax: ICU never translates them, so if the reply has the same token it is already in
 * place and inserting another copy would break the block. Clause bodies (`{He}` inside a
 * `select`) are the opposite: ICU *replaces* them with the translation, so the absence of
 * the English text is the expected, correct outcome and must not trigger an insertion.
 */
function reinsertedTokenWouldDuplicate(result: string, rawToken: string): boolean {
  const inner = rawToken.startsWith('{') && rawToken.endsWith('}') ? rawToken.slice(1, -1) : '';
  // `{name}` (plain placeholder) and `{name, type}` (ICU argument) are syntax;
  // `{He}` / `{Some words}` are clause text.
  if (inner && /^[A-Za-z0-9_-]+$/.test(inner)) return result.includes(rawToken);
  if (inner.includes(',')) return result.includes(rawToken);
  if (/^\{\s*(?:offset:|=\d)/.test(rawToken)) return result.includes(rawToken);
  if (rawToken === '#' || rawToken.startsWith('%') || rawToken.startsWith('<') || rawToken.startsWith('@')) {
    return result.includes(rawToken);
  }
  // Quoted printf specifiers ("\%1$s\", \'%s\') are syntax too, not clause text: they start
  // with a quote, so the checks above miss them, but dropping one would silently lose the
  // specifier (the old guarantee re-inserted them).
  if (rawToken.includes('%')) return result.includes(rawToken);
  // Anything else is translatable clause text: never re-insert it.
  return true;
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
    // A token whose *meaning* survived must not be re-inserted: an ICU clause such as `{He}`
    // is translatable text, so when the reply already carries that text inside a clause
    // (`male {أعجبه}`) there is nothing to restore. Comparing only the raw string would append
    // the English `{He}` a second time, which ICU then reads as a stray placeholder.
    // Clause text is what ICU replaces, so a translation that no longer contains the
    // English words inside the clause is the expected result, never a lost token.
    if (!tk.isClauseText && !result.includes(tk.rawToken) && !reinsertedTokenWouldDuplicate(result, tk.rawToken)) {
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
  | 'microsoft'
  | 'libretranslate';

export interface TranslationProviderConfig {
  id: string;
  name: string;
  type: ProviderEngineType;
  apiKey?: string;
  /** Yandex Cloud folder ID (needed with an IAM token). For LibreTranslate this field holds the instance URL. */
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

// Parsed provider list, reused while the stored JSON is unchanged (lookups happen for every segment).
let providersParseCache: { raw: string; list: TranslationProviderConfig[] } | null = null;

export function getCustomProviders(): TranslationProviderConfig[] {
  try {
    const raw = getStoredItem(CUSTOM_PROVIDERS_STORAGE_KEY);
    if (!raw) return [];
    if (!providersParseCache || providersParseCache.raw !== raw) {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed.filter(
            (p): p is TranslationProviderConfig =>
              p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.type === 'string'
          )
        : [];
      providersParseCache = { raw, list };
    }
    // Keys come from the vault, which can change without the JSON changing, so they are applied on each call
    return providersParseCache.list.map((p) => ({ ...p, apiKey: getSecret(p.id) ?? p.apiKey }));
  } catch (err) {
    logFallback('providers', err);
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

// Set while a bulk translation runs with a provider picked just for that run (the saved choice is untouched)
let providerOverrideId: string | null = null;

/** Runs `fn` with `providerId` used for every translation, then restores the previous provider. */
export async function withTranslationProvider<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
  const previous = providerOverrideId;
  providerOverrideId = providerId;
  try {
    return await fn();
  } finally {
    providerOverrideId = previous;
  }
}

export function getActiveProviderId(): string {
  if (providerOverrideId && getAllTranslationProviders().some((p) => p.id === providerOverrideId)) {
    return providerOverrideId;
  }
  try {
    const saved = getStoredItem(ACTIVE_PROVIDER_STORAGE_KEY);
    const all = getAllTranslationProviders();
    if (saved && all.some((p) => p.id === saved)) {
      return saved;
    }
  } catch (err) {
    debugIgnored('translator', err);
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
  const trimmedKey = apiKey.trim();
  const trimmedFolder = folderId?.trim() || undefined;

  // 1. Server first (same origin on the web, or VITE_API_BASE in the app)
  if (serverProvidersAvailable()) {
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/api/providers/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerType, apiKey: trimmedKey, folderId: trimmedFolder }),
        },
        30000
      );
      if (res.ok) {
        return (await res.json()) as ProviderTestResult;
      }
    } catch (serverErr) {
      logFallback('server provider test', serverErr);
    }
  }

  // 2. Direct client test, native app only (CapacitorHttp bypasses CORS)
  if (!directProvidersAvailable()) {
    return { success: false, matched: false, error: PROVIDERS_UNAVAILABLE };
  }
  try {
    const directRes = await directTestProviderApiKey(providerType, trimmedKey, trimmedFolder);
    return directRes as ProviderTestResult;
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
type SuggestionResult = {
  text: string;
  source: TranslationEngine;
  /**
   * Set on the suggestion whose engine reply was rejected for breaking an ICU block.
   * It rides on the result instead of a module-level variable: the editor reads
   * several suggestions per action (`Promise.all` for plural and array items) and a
   * background prediction can be in flight, so a shared flag made one suggestion's
   * rejection describe another suggestion — the alert was wrong in both directions.
   */
  icuRejected?: boolean;
};

// ---------- Translation cache ----------
// Repeated strings (and re-opening a project) do not send the same request again. Keys include a hash
// of the provider key, so changing a key starts a fresh cache for that provider. Heuristic fallbacks are
// never cached, so they are retried later.
//
// The version is bumped by any change to what a cached entry looks like. A cache filled by an older
// build keeps serving its entries (nothing validates the line breaks of a cached suggestion), so an
// entry saved before a fix would keep the old, wrong output for good: a user who upgraded and pressed
// "Suggest" on the same string would still get the broken suggestion. Version 2 is the first one whose
// suggestions keep the outer line breaks of a multiline segment.
const TRANSLATION_CACHE_VERSION = 2;
const TRANSLATION_CACHE_KEY = `translation_cache_v${TRANSLATION_CACHE_VERSION}`;
const TRANSLATION_CACHE_LIMIT = 5000;
let translationCache: Map<string, SuggestionResult> | null = null;

/**
 * Older builds wrote their entries under a previous key. This build never reads them, and they can
 * be tens of kilobytes, so they are removed. It runs on first use of the cache in a session, not in
 * `clearTranslationCache` (nothing in the app calls that one).
 */
let olderTranslationCachesRemoved = false;
function removeOlderTranslationCaches(): void {
  if (olderTranslationCachesRemoved) return;
  olderTranslationCachesRemoved = true;
  for (let version = 1; version < TRANSLATION_CACHE_VERSION; version++) {
    try {
      removeStoredItem(`translation_cache_v${version}`);
    } catch (err) {
      debugIgnored('translator', err);
    }
  }
}

function getTranslationCache(): Map<string, SuggestionResult> {
  removeOlderTranslationCaches();
  if (!translationCache) {
    translationCache = new Map();
    try {
      const raw = getStoredItem(TRANSLATION_CACHE_KEY);
      if (raw) {
        for (const [k, v] of JSON.parse(raw) as Array<[string, SuggestionResult]>) translationCache.set(k, v);
      }
    } catch (err) {
      debugIgnored('translator', err);
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

/** Outer whitespace of a segment and of a reply. `\s` already covers U+00A0 and U+FEFF. */
const OUTER_WHITESPACE_LEADING = /^\s+/;
const OUTER_WHITESPACE_TRAILING = /\s+$/;
/** A byte-order mark inside a translated core is invisible in the editor and breaks the exported XML. */
const INTERIOR_BOM = /\ufeff/g;

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
  libretranslate: 'LibreTranslate',
  glossary: 'Glossary',
  heuristic: 'Heuristic',
};

// The free Google engine uses an unofficial endpoint that can stop working without notice. After a few failures
// in a row the UI is told so it can suggest an official or self-hosted provider.
const GTX_FAILURE_THRESHOLD = 3;
let gtxConsecutiveFailures = 0;

/**
 * True when a suggestion was thrown away because it would have damaged an ICU block.
 *
 * Prefer reading `res.icuRejected` off the result: this helper still answers for the
 * caller that has no result in hand (the array/plural branches of the editor), but it
 * is hand-maintained state, so it can only describe the last call to `suggestTranslation`.
 * Pass the result to get the answer for that specific suggestion.
 */
export function suggestionRejectedForIcu(res?: SuggestionResult | null): boolean {
  if (res) return res.icuRejected === true;
  return lastSuggestionRejectedForIcu;
}

/** Mirrors the flag of the most recent `suggestTranslation` call, for callers without a result. */
let lastSuggestionRejectedForIcu = false;

/**
 * True when a suggestion is worth filling into the editor: a real translation, not the
 * unchanged source text handed back when every engine failed or broke an ICU block.
 * The editor uses this in all three Suggest branches so a rejected suggestion leaves the
 * box — and the item's status — exactly as they were, instead of showing English as
 * "translated".
 */
export function isFillableSuggestion(res: SuggestionResult | undefined | null): res is SuggestionResult {
  return Boolean(res && res.text && res.source !== 'heuristic');
}
export const GTX_STATUS_EVENT = 'gtx-status-change';

function noteGtxResult(ok: boolean): void {
  const wasUnavailable = gtxConsecutiveFailures >= GTX_FAILURE_THRESHOLD;
  gtxConsecutiveFailures = ok ? 0 : gtxConsecutiveFailures + 1;
  const isUnavailable = gtxConsecutiveFailures >= GTX_FAILURE_THRESHOLD;
  if (wasUnavailable !== isUnavailable && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(GTX_STATUS_EVENT));
  }
}

export function gtxLooksUnavailable(): boolean {
  return gtxConsecutiveFailures >= GTX_FAILURE_THRESHOLD;
}

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

/**
 * Some engines answer a source's no-break space (U+00A0, e.g. between a number and its unit) with an
 * ordinary space. The source's separators are put back, but only when the reply has exactly as many
 * words: with a different count the position of each separator is a guess, so the reply is kept as
 * it came.
 */
function restoreInteriorNbsp(source: string, reply: string): string {
  if (!source.includes('\u00a0') || reply.includes('\u00a0')) return reply;
  const srcTokens = source.split(/(\u00a0| )/);
  const srcWords = srcTokens.filter((_, i) => i % 2 === 0);
  const srcSeps = srcTokens.filter((_, i) => i % 2 === 1);
  const replyWords = reply.split(' ');
  if (replyWords.length !== srcWords.length || replyWords.some((w) => w === '')) return reply;
  return replyWords.reduce((acc, w, i) => (i === 0 ? w : acc + srcSeps[i - 1] + w), '');
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

/** True when a clause body holds human-readable words worth translating, as opposed
 * to pure syntax (`{count}`, `%s`, `#`, an HTML tag, a quoted literal like `'#'`). */
function hasTranslatableText(body: string): boolean {
  const stripped = body
    .replace(/\{[^{}]*\}/g, '')
    .replace(/%(?:\d+\$)?[+# 0,-]*\d*(?:\.\d+)?[bcdefgopsx%]/gi, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/#/g, '')
    .replace(/\\n|\\t/g, ' ');
  return /[\p{L}\p{N}]/u.test(stripped);
}

/**
 * Phase 3: translates a string that contains ICU MessageFormat blocks piece by piece,
 * for engines that cannot be instructed.
 *
 * A machine-translation engine translates the block's keywords (`select` → `حدد`),
 * so a whole-block reply is always rejected by the structural check; the AI providers
 * never reach this, because their whole-string reply (they see the original text)
 * already succeeds. Here the structure — variable name, format type, clause keywords,
 * `offset:`, `=0`/`=1` selectors, `#` — is copied from the source verbatim, and only
 * the surrounding text and each clause body are translated, each on its own through
 * the normal engine chain. A body whose translation is unusable (or would lose a `#`)
 * keeps its source text instead of failing the whole string. The assembled result is
 * checked structurally before it is returned, so a damaged block can never slip through.
 * Returns null when nothing could be translated.
 */
async function translateIcuPerClause(
  coreText: string,
  baseLang: string,
  directLang: string,
  targetLocaleName?: string,
  pluralQuantity?: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
): Promise<{ text: string; source: TranslationEngine } | null> {
  const parts = splitIcuBlocks(coreText);
  if (!parts) return null;
  let overallSource: TranslationEngine = 'glossary';
  let translatedAny = false;
  /**
   * Set when text OUTSIDE a block kept its source language. A clause body that fails is kept
   * on purpose (the block is still valid ICU and the user can fix one short phrase), but text
   * outside a block is the sentence the user actually reads: assembling a half-English string
   * and returning it as a `google` result made the bulk path save it with status 'translated',
   * which hid it from the "Untranslated" filter while it still read English. That is not a
   * translation, so the attempt fails and the normal fallback takes over.
   */
  let surroundingLeftUntranslated = false;
  const out: string[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      if (!part.text.trim()) {
        out.push(part.text);
        continue;
      }
      const res = await translateSingleSegment(part.text, baseLang, directLang, targetLocaleName, pluralQuantity);
      const translated = res.source !== 'heuristic' && Boolean(res.text.trim()) && res.text !== part.text;
      if (translated) {
        if (res.source !== 'glossary') overallSource = res.source;
        translatedAny = true;
        out.push(res.text);
      } else {
        // Punctuation-only runs ("!", "…", " — ") legitimately come back unchanged.
        if (hasTranslatableText(part.text)) surroundingLeftUntranslated = true;
        out.push(part.text);
      }
      continue;
    }
    // Block: rebuild from the source, translating each clause body on its own.
    const bodies = part.bodies ?? [];
    let rebuilt = '';
    let cursor = 0;
    for (const body of bodies) {
      const bodyText = part.text.slice(body.start, body.end);
      rebuilt += part.text.slice(cursor, body.start);
      let replacement = bodyText;
      if (hasTranslatableText(bodyText)) {
        const res = await translateSingleSegment(bodyText, baseLang, directLang, targetLocaleName, pluralQuantity);
        const hashCount = (s: string) => (s.match(/#/g) || []).length;
        if (
          res.source !== 'heuristic' &&
          res.text &&
          res.text !== bodyText &&
          hashCount(res.text) === hashCount(bodyText)
        ) {
          replacement = res.text;
          if (res.source !== 'glossary') overallSource = res.source;
          translatedAny = true;
        }
      }
      rebuilt += replacement;
      cursor = body.end;
    }
    rebuilt += part.text.slice(cursor);
    out.push(rebuilt);
  }
  if (!translatedAny || surroundingLeftUntranslated) return null;
  const assembled = out.join('');
  if (!validatePlaceholders(coreText, assembled, directLang).valid) return null;
  return { text: assembled, source: overallSource };
}

async function translateSingleSegmentUncached(
  segment: string,
  baseLang: string,
  directLang: string,
  targetLocaleName?: string,
  pluralQuantity?: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
): Promise<SuggestionResult> {
  // The outer whitespace is captured and put back by wrapResult, so a translation keeps
  // the segment's exact surroundings. It must include line breaks, not just spaces and
  // tabs: trim() strips them, and a multiline segment (a pretty-printed ICU block) would
  // otherwise come back short on line breaks — the app's own suggestion then failed the
  // line-break save gate (source 6 breaks, suggestion 4).
  const leadingMatch = segment.match(OUTER_WHITESPACE_LEADING);
  const trailingMatch = segment.match(OUTER_WHITESPACE_TRAILING);
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

  /**
   * An engine may answer with its own outer whitespace (a trailing newline, a BOM from a streaming
   * API, a no-break space). The suggestion keeps the SOURCE's surroundings, not the engine's, so the
   * reply is trimmed here. A BOM in the middle is dropped too: it is invisible in the editor and
   * breaks the exported XML.
   *
   * This is a separate step from `wrapResult` by design: `wrapResult` runs only after
   * `breaksIcuStructure` has judged the raw reply. Trimming inside `wrapResult` meant the ICU gate
   * judged a padded candidate while the suggestion returned the trimmed one — two different strings,
   * and the one that was actually saved had never been checked. Post-processing now happens before
   * every engine gate, so the text that is judged is the text that is returned.
   */
  const postProcess = (translatedCore: string): string => {
    let out = translatedCore
      .replace(OUTER_WHITESPACE_LEADING, '')
      .replace(OUTER_WHITESPACE_TRAILING, '')
      .replace(INTERIOR_BOM, '');
    // A single-line source has no line breaks to keep, but an engine sometimes writes one inside its
    // reply ("Hello world" comes back as two lines). The app's own line-break check would then refuse
    // the save. The words are kept and the stray break becomes a space. Both forms that
    // countLineBreaks counts are covered: a real newline and an escaped backslash-n.
    if (countLineBreaks(coreText) === 0) {
      out = out.replace(/\s*(?:\r?\n|\\n)\s*/g, ' ');
    }
    return restoreInteriorNbsp(coreText, out);
  };

  const wrapResult = (translatedCore: string) => {
    const core = hasOuterUnescapedQuotes
      ? translatedCore.replace(/^\\?"|\\?"$/g, '')
      : translatedCore;
    const withQuotes = hasOuterUnescapedQuotes ? `"${core}"` : core;
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

  /**
   * Rejects a reply that would break the ICU block structure (a dropped `other`, a lost
   * brace, a translated clause keyword). The AI providers check this inside their own
   * callers; the plain machine-translation engines rewrite braces freely, so the check has
   * to happen here for every engine. Only strings that actually contain an ICU block are
   * checked, so the common path pays nothing.
   */
  // A reply that breaks the block was seen for THIS segment. It travels out on the
  // result (see `SuggestionResult.icuRejected`), never through a shared variable.
  let icuRejectedHere = false;

  const breaksIcuStructure = (candidate: string): boolean => {
    if (!coreText.includes('{')) return false;
    if (validatePlaceholders(coreText, candidate, directLang).valid) return false;
    // Remembered on the result so the editor can explain why no suggestion was offered.
    icuRejectedHere = true;
    return true;
  };

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

  // Helper for custom API key providers (Yandex, DeepL, OpenAI, Lara, ...). Always needs the user's key.
  const tryCustomProvider = async (): Promise<string | null> => {
    if (!activeProvider.apiKey) {
      return null;
    }
    // Narrowed once here so the retry closures below keep a string-typed key.
    const providerApiKey = activeProvider.apiKey;
    // Gemini has its own dedicated direct caller
    if (activeProvider.type === 'gemini') {
      return tryGeminiDirect();
    }

    // 1. Server first when reachable
    if (serverProvidersAvailable()) {
      try {
        const pRes = await withRetry(() =>
          fetchWithTimeout(
            `${API_BASE}/api/providers/translate`,
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
          )
        );
        if (!pRes.ok) throw providerHttpError('server provider', pRes.status);
        const pData = (await pRes.json()) as { translatedText?: string };
        if (pData && typeof pData.translatedText === 'string' && pData.translatedText.trim()) {
          const cleaned = stripMetadataLabels(pData.translatedText, coreText);
          if (cleaned && !isPollutedTranslation(cleaned)) {
            const restored = postProcess(restoreSegmentSyntax(cleaned, tokens, usesEscapedDoubleQuotes));
            if (!breaksIcuStructure(restored)) return restored;
          }
        }
      } catch (err) {
        logFallback('server provider', err);
      }
    }

    // 2. Direct client translation, native app only (CapacitorHttp bypasses CORS)
    if (!directProvidersAvailable()) return null;
    try {
      const directResult = await withRetry(() =>
        directCallProviderWithKey(
          activeProvider.type,
          providerApiKey,
          coreText,
          directLang,
          targetLocaleName,
          pluralQuantity,
          activeProvider.folderId
        )
      );
      if (directResult && directResult.translatedText) {
        const cleaned = stripMetadataLabels(directResult.translatedText, coreText);
        if (cleaned && !isPollutedTranslation(cleaned)) {
          const restored = postProcess(restoreSegmentSyntax(cleaned, tokens, usesEscapedDoubleQuotes));
          if (!breaksIcuStructure(restored)) return restored;
        }
      }
    } catch (err) {
      logFallback('direct provider', err);
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
        const restored = postProcess(restoreSegmentSyntax(cleanedAi, tokens, usesEscapedDoubleQuotes));
        if (!breaksIcuStructure(restored)) return restored;
      }
    } catch (err) {
      logFallback('gemini', err);
    }
    return null;
  };

  // Helper for Google Translate GTX neural endpoint (unofficial; shared with the server)
  const tryGoogleGtx = async (): Promise<string | null> => {
    try {
      const combined = await withRetry(() => fetchGoogleGtxRaw(cleanText, directLang, 5000));
      const decoded = stripMetadataLabels(decodeHtmlEntities(combined), coreText);
      if (decoded && !isPollutedTranslation(decoded)) {
        const restored = postProcess(restoreSegmentSyntax(decoded, tokens, usesEscapedDoubleQuotes));
        if (!breaksIcuStructure(restored)) {
          noteGtxResult(true);
          return restored;
        }
      }
    } catch (err) {
      logFallback('google', err);
    }
    noteGtxResult(false);
    return null;
  };

  // Helper for MyMemory API
  const tryMyMemory = async (): Promise<string | null> => {
    try {
      const langPair = `en|${baseLang}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=${langPair}`;

      // One fresh timeout per attempt: a retried fetch must not reuse an already-aborted signal.
      const fetchOnce = async (): Promise<Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) throw providerHttpError('MyMemory', response.status);
          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      };

      const response = await withRetry(fetchOnce);
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
          const finalResult = postProcess(restoreSegmentSyntax(rawResult, tokens, usesEscapedDoubleQuotes));
          if (finalResult && !breaksIcuStructure(finalResult)) {
            return finalResult;
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

  // A reply from these strategies already passed `breaksIcuStructure`: whatever an
  // earlier engine broke, this suggestion is good, so it carries no rejection.
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

  // 3b. Phase 3: translate an ICU block piece by piece. The machine-translation
  // engines translate the block's keywords, so a whole-block reply is always
  // rejected by the structural check above; translating the surrounding text and
  // each clause body on their own keeps the structure from the source instead.
  // AI providers never reach this: their whole-string reply already succeeds.
  if (coreText.includes('{')) {
    const perClause = await translateIcuPerClause(coreText, baseLang, directLang, targetLocaleName, pluralQuantity);
    if (perClause) return { text: wrapResult(perClause.text), source: perClause.source };
  }

  // 4. Fallback Heuristic. Nothing usable came back, so the rejection (if any) is the
  // reason no suggestion is offered, and it describes this segment only.
  return { text: segment, source: 'heuristic', icuRejected: icuRejectedHere };
}

/**
 * Main translation function that resolves with the highest quality translation available
 * while preserving 100% of Android syntax (%1$s, %1$d, \n, \\n, multiline \n, quotes, etc.)
 */
/**
 * Records a finished suggestion as the "last call" the editor can query without a result,
 * and hands the same value back unchanged. The rejection lives on the result itself, so a
 * parallel suggestion (a plural item's other quantities, the background word prediction)
 * can no longer overwrite the answer for this one.
 */
function finishSuggestion(res: SuggestionResult): SuggestionResult {
  lastSuggestionRejectedForIcu = res.icuRejected === true;
  return res;
}

export async function suggestTranslation(
  sourceText: string,
  targetLang: string,
  targetLocaleName?: string,
  pluralQuantity?: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
): Promise<SuggestionResult> {
  // Both the shared last-call flag and each result's own flag describe this suggestion.
  lastSuggestionRejectedForIcu = false;
  if (!sourceText || !sourceText.trim()) {
    return { text: '', source: 'glossary' };
  }

  const baseLang = targetLang.split('-')[0].toLowerCase();
  const directLang = targetLang.toLowerCase();

  // Split by Android newline / tab syntax separators so \n, \\n, and multiline \n are 100% untouched
  const separatorRegex = /(\r?\n\\n\r?\n\\n|\r?\n\\n|\\\\n|\\n\\n|\\n|\r?\n|\\t)/g;
  const parts = sourceText.split(separatorRegex);

  if (parts.length === 1) {
    return finishSuggestion(
      await translateSingleSegment(sourceText, baseLang, directLang, targetLocaleName, pluralQuantity)
    );
  }

  // An ICU block that spans a line break cannot be split: each piece would be an unbalanced
  // fragment, invisible to the structural check, so a reply that dropped a clause would be
  // accepted. Such a string is translated whole and checked whole.
  if (hasMultilineIcuBlock(sourceText)) {
    return finishSuggestion(
      await translateSingleSegment(sourceText, baseLang, directLang, targetLocaleName, pluralQuantity)
    );
  }

  let overallSource: TranslationEngine = 'glossary';
  let anyPartRejected = false;
  const translatedParts = await Promise.all(
    parts.map(async (part) => {
      if (!part) return part;
      if (separatorRegex.test(part)) {
        separatorRegex.lastIndex = 0;
        return part; // Keep exact \n / \\n / multiline separator untouched
      }
      separatorRegex.lastIndex = 0;
      const res = await translateSingleSegment(part, baseLang, directLang, targetLocaleName, pluralQuantity);
      if (res.icuRejected) anyPartRejected = true;
      if (res.source !== 'glossary' && res.source !== 'heuristic') overallSource = res.source;
      return res.text;
    })
  );

  const joined = translatedParts.join('');

  // Safety net for a block that only became unbalanced after the split: verify the
  // assembled text as a whole, and if the pieces damaged the block, retry without
  // splitting. A damaged block is never returned.
  if (sourceText.includes('{') && !validatePlaceholders(sourceText, joined, directLang).valid) {
    return finishSuggestion(
      await translateSingleSegment(sourceText, baseLang, directLang, targetLocaleName, pluralQuantity)
    );
  }

  return finishSuggestion({ text: joined, source: overallSource, icuRejected: anyPartRejected });
}

// ---------- Batch prewarm for API-key providers ----------
// Plain strings (no format tokens, markup, quotes or line breaks) are sent in batches of up to 50, so a
// large file costs a few requests instead of one per string. Results go into the same cache the per-string
// path reads, so nothing else changes. Anything not batch-safe keeps the normal path.
const BATCH_SIZE = 50;
const BATCH_UNSAFE = /[%\\<>@[\]{}"\n\r]/;
const POLLUTED_BATCH_RESULT = /ترجمة المصطلح|INVALID TARGET|MYMEMORY|[[]/;

export async function prewarmProviderBatch(
  sources: string[],
  targetLang: string,
  targetLocaleName?: string
): Promise<void> {
  const provider = getActiveProvider();
  if (provider.isBuiltIn || provider.type === 'gemini' || !provider.apiKey || !serverProvidersAvailable()) return;

  const directLang = targetLang.toLowerCase();
  const pending: string[] = [];
  for (const src of new Set(sources)) {
    if (typeof src !== 'string' || !src || src.length > 5000 || src.trim() !== src || BATCH_UNSAFE.test(src)) continue;
    if (cachedSegmentLookup(cacheKeyFor(src, directLang, undefined))) continue;
    pending.push(src);
  }

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const chunk = pending.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/api/providers/translate-batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerType: provider.type,
            apiKey: provider.apiKey,
            folderId: provider.folderId,
            targetLang: directLang,
            targetLocaleName,
            texts: chunk,
          }),
        },
        60000
      );
      if (!res.ok) return; // Remaining strings use the per-string path, which reports errors individually
      const data = (await res.json()) as { translations?: Array<string | null> };
      chunk.forEach((src, idx) => {
        const raw = data.translations?.[idx];
        if (!raw) return;
        const cleaned = stripMetadataLabels(raw, src).trim();
        if (!cleaned || POLLUTED_BATCH_RESULT.test(cleaned)) return;
        cacheSegmentResult(cacheKeyFor(src, directLang, undefined), { text: cleaned, source: provider.type });
      });
    } catch (err) {
      logFallback('batch', err);
      return;
    }
  }
}

/**
 * Bulk translates a list of ResourceItems using suggestTranslation with controlled concurrency
 * and live progress reporting. A single item that fails (bad data, an unexpected provider
 * error) never aborts the batch: it keeps its original text and status, `onItemError` is
 * called for it, and the remaining items are still translated and returned.
 */
export async function bulkTranslateItems(
  itemsToTranslate: ResourceItem[],
  targetLang: string,
  targetLocaleName?: string,
  onProgress?: (completed: number, total: number) => void,
  onItemError?: (item: ResourceItem, error: unknown) => void
): Promise<ResourceItem[]> {
  const total = itemsToTranslate.length;
  if (total === 0) return [];

  const normalizedInput = normalizePluralsForLanguage(itemsToTranslate, targetLang);

  // One batch request per 50 plain strings before the per-item pass (no effect for built-in providers)
  const batchSources: string[] = [];
  for (const it of normalizedInput) {
    if (it.type === 'string') batchSources.push((it as SingleStringItem).source);
    else if (it.type === 'array') for (const ai of (it as ArrayStringItem).items) batchSources.push(ai.source);
  }
  await prewarmProviderBatch(batchSources, targetLang, targetLocaleName);

  const results: ResourceItem[] = new Array(total);
  let completed = 0;

  const translateOneItem = async (item: ResourceItem): Promise<ResourceItem> => {
    if (item.type === 'string') {
      const single = item as SingleStringItem;
      const res = await suggestTranslation(single.source, targetLang, targetLocaleName);
      // `heuristic` = no engine produced a usable reply and the source came back untouched.
      // Keeping it as the target would put English text in a translated file, so the string
      // keeps its previous target (usually empty) and stays in the "Untranslated" filter.
      const rejectedForIcu = res?.source === 'heuristic';
      const targetText = rejectedForIcu ? single.target : res?.text || single.target;
      // When the engines are rejected, the user's own text is kept and still counts as
      // translated; only a string that would have been filled with the English source is
      // left untranslated.
      const hasTranslation = rejectedForIcu
        ? Boolean(targetText.trim())
        : Boolean(targetText.trim()) && res?.source !== undefined;
      return {
        ...single,
        target: targetText,
        status: hasTranslation ? 'translated' : 'untranslated',
        // On rejection the kept text is the user's own, so its previous source and engine
        // stay — recording 'heuristic' as the engine of text no engine produced would be
        // a lie in the other direction.
        translationSource: hasTranslation ? (rejectedForIcu ? single.translationSource : 'ai') : undefined,
        translationEngine: hasTranslation ? (rejectedForIcu ? single.translationEngine : res?.source) : undefined,
      };
    }

    if (item.type === 'plural') {
      const plural = item as PluralStringItem;
      let engineUsed: TranslationEngine | undefined;
      const updatedQuantities = await Promise.all(
        plural.items.map(async (pi) => {
          try {
            const res = await suggestTranslation(pi.source, targetLang, targetLocaleName, pi.quantity);
            engineUsed = engineUsed ?? res?.source;
            return {
              ...pi,
              // A rejected quantity keeps its previous target; the English source must not
              // land in the field (same rule as the string path above).
              target: res?.source === 'heuristic' ? pi.target : res?.text || pi.target,
            };
          } catch (err) {
            // One bad quantity keeps its original text; the other quantities still translate.
            logFallback('bulk-plural-item', err);
            onItemError?.(plural, err);
            return pi;
          }
        })
      );
      // A glossary translation is a real translation; only 'heuristic' means nothing usable
      // came back. Targets must also be non-empty, so an empty quantity is not "translated".
      const anyTranslated =
        updatedQuantities.some((pi) => pi.target.trim().length > 0) &&
        engineUsed !== undefined &&
        engineUsed !== 'heuristic';
      return {
        ...plural,
        items: updatedQuantities,
        status: anyTranslated ? 'translated' : 'untranslated',
        translationSource: anyTranslated ? 'ai' : undefined,
        translationEngine: anyTranslated ? engineUsed : undefined,
      };
    }

    if (item.type === 'array') {
      const arr = item as ArrayStringItem;
      let engineUsed: TranslationEngine | undefined;
      const updatedElements = await Promise.all(
        arr.items.map(async (ai) => {
          try {
            const res = await suggestTranslation(ai.source, targetLang, targetLocaleName);
            engineUsed = engineUsed ?? res?.source;
            return {
              ...ai,
              // A rejected element keeps its previous target; the English source must not
              // land in the field (same rule as the string path above).
              target: res?.source === 'heuristic' ? ai.target : res?.text || ai.target,
            };
          } catch (err) {
            // One bad element keeps its original text; the other elements still translate.
            logFallback('bulk-array-item', err);
            onItemError?.(arr, err);
            return ai;
          }
        })
      );
      // Same rule as the plural path: a glossary translation counts, 'heuristic' does not,
      // and empty elements are not "translated".
      const anyTranslated =
        updatedElements.some((ai) => ai.target.trim().length > 0) &&
        engineUsed !== undefined &&
        engineUsed !== 'heuristic';
      return {
        ...arr,
        items: updatedElements,
        status: anyTranslated ? 'translated' : 'untranslated',
        translationSource: anyTranslated ? 'ai' : undefined,
        translationEngine: anyTranslated ? engineUsed : undefined,
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
      const item = normalizedInput[currentIdx];
      try {
        results[currentIdx] = await translateOneItem(item);
      } catch (err) {
        // One bad item must never abort the batch or discard the items already done:
        // it keeps its original text and status, and the batch continues.
        logFallback('bulk-item', err);
        onItemError?.(item, err);
        results[currentIdx] = item;
      }
      completed++;
      onProgress?.(completed, total);
    }
  });

  await Promise.all(workers);
  return results;
}
