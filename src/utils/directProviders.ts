// Direct client-side calls to third-party translation APIs.
// Uses nativeFetch (CapacitorHttp) on native Android/iOS to bypass browser CORS completely,
// allowing the APK to translate directly without requiring an intermediate backend proxy server.

import {
  SYSTEM_INSTRUCTION,
  fetchGoogleGtxRaw,
  normalizeForComparison,
  providerHttpError,
  stripMetadataWrappers,
} from '../shared/translateCore';
import { nativeFetch } from './nativeHttp';

export const DIRECT_PROVIDER_TYPES = [
  'yandex',
  'lara',
  'deepl',
  'openai',
  'google_cloud',
  'microsoft',
  'libretranslate',
] as const;

export type DirectProviderType = (typeof DIRECT_PROVIDER_TYPES)[number];

export interface DirectProviderResult {
  translatedText: string;
  detectedType: string;
}

export interface DirectProviderTestResult {
  success: boolean;
  matched: boolean;
  testSource?: string;
  googleTranslation?: string;
  providerTranslation?: string;
  detectedType?: string;
  error?: string;
}

// The Lara SDK is Node-oriented; load it only when a Lara key is actually used.
async function loadLara() {
  return import('@translated/lara');
}

/** Client-side guard for the user-typed LibreTranslate URL: https only, no credentials, no IP/localhost/private hosts. */
export function assertSafeLibreBase(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('LibreTranslate: رابط غير صالح / Invalid server URL.');
  }
  const h = u.hostname.toLowerCase();
  const isIp = /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[');
  const privateName = h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.');
  if (u.protocol !== 'https:' || u.username || u.password || isIp || privateName) {
    throw new Error('LibreTranslate: يُسمح فقط برابط https لنطاق عام / Only public https domains are allowed.');
  }
  return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
}

const LARA_CONNECTION_TIMEOUT_MS = 12000;

function parseLaraCredentials(raw: string): { id?: string; secret?: string; singleToken?: string } {
  const cleaned = raw.trim();

  // 1. JSON object format: {"id":"...", "secret":"..."}
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned) as Record<string, string>;
      const id = parsed.id || parsed.accessKeyId || parsed.access_key_id || parsed.LARA_ACCESS_KEY_ID;
      const secret =
        parsed.secret || parsed.accessKeySecret || parsed.access_key_secret || parsed.LARA_ACCESS_KEY_SECRET;
      if (id && secret) {
        return { id: String(id).trim(), secret: String(secret).trim() };
      }
    } catch {
      // Fall through to other formats
    }
  }

  // 2. Environment variable paste format: LARA_ACCESS_KEY_ID=... LARA_ACCESS_KEY_SECRET=...
  const envIdMatch = cleaned.match(/LARA_ACCESS_KEY_ID\s*=\s*["']?([^\s"']+)["']?/i);
  const envSecretMatch = cleaned.match(/LARA_ACCESS_KEY_SECRET\s*=\s*["']?([^\s"']+)["']?/i);
  if (envIdMatch?.[1] && envSecretMatch?.[1]) {
    return { id: envIdMatch[1].trim(), secret: envSecretMatch[1].trim() };
  }

  // 3. Delimited format: id:secret, id|secret, id,secret, or "id secret" (DeepL ":fx" keys excluded)
  if (!cleaned.endsWith(':fx')) {
    for (const sep of [':', '|', ',']) {
      const idx = cleaned.indexOf(sep);
      if (idx > 0 && idx < cleaned.length - 1) {
        const id = cleaned.slice(0, idx).trim();
        const secret = cleaned.slice(idx + 1).trim();
        if (id && secret) {
          return { id, secret };
        }
      }
    }
    const parts = cleaned.split(/\s+/);
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { id: parts[0].trim(), secret: parts[1].trim() };
    }
  }

  return { singleToken: cleaned };
}

function libreTarget(targetLang: string): string {
  const lower = targetLang.toLowerCase();
  if (lower === 'zh-rtw' || lower === 'zh-tw') return 'zt';
  return lower.split('-')[0];
}

function laraTargetFor(targetLang: string): string {
  const lower = targetLang.toLowerCase();
  if (lower === 'zh-rcn') return 'zh-CN';
  if (lower === 'zh-rtw') return 'zh-TW';
  if (lower === 'pt-rbr') return 'pt-BR';
  return lower.split('-')[0];
}

/**
 * Executes a direct translation request to the provider's API.
 * Uses CapacitorHttp on native devices to bypass CORS.
 */
export async function directCallProviderWithKey(
  providerType: string,
  apiKey: string,
  sourceText: string,
  targetLang: string,
  targetLocaleName?: string,
  pluralQuantity?: string,
  folderId?: string
): Promise<DirectProviderResult> {
  const baseLang = targetLang.split('-')[0].toLowerCase();
  const trimmedKey = apiKey.trim();
  const trimmedFolderId = folderId?.trim() || '';

  const tryYandex = async (): Promise<string> => {
    const authHeader = trimmedKey.startsWith('t1.') ? `Bearer ${trimmedKey}` : `Api-Key ${trimmedKey}`;
    const cloudRes = await nativeFetch<{ translations?: Array<{ text?: string }> }>(
      'https://translate.api.cloud.yandex.net/translate/v2/translate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        data: {
          sourceLanguageCode: 'en',
          targetLanguageCode: baseLang,
          texts: [sourceText],
          ...(trimmedFolderId ? { folderId: trimmedFolderId } : {}),
        },
      }
    );
    if (cloudRes.ok && cloudRes.data?.translations?.[0]?.text) {
      return stripMetadataWrappers(cloudRes.data.translations[0].text, sourceText);
    }

    // Fallback: YandexGPT
    const aiRes = await nativeFetch<{
      result?: { alternatives?: Array<{ message?: { text?: string } }> };
    }>('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        ...(trimmedFolderId ? { 'x-folder-id': trimmedFolderId } : {}),
      },
      data: {
        modelUri: `gpt://${trimmedFolderId || 'b1g'}/yandexgpt-lite/latest`,
        completionOptions: { stream: false, temperature: 0.1, maxTokens: '200' },
        messages: [
          { role: 'system', text: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            text: `Translate from English to ${targetLocaleName || baseLang}. Return ONLY the translated text:\n${sourceText}`,
          },
        ],
      },
    });
    if (aiRes.ok && aiRes.data?.result?.alternatives?.[0]?.message?.text) {
      return stripMetadataWrappers(aiRes.data.result.alternatives[0].message.text, sourceText);
    }

    throw new Error('Yandex: فشل التحقق من المفتاح / Authentication failed: check key and folder ID.');
  };

  const tryDeepL = async (): Promise<string> => {
    const host = trimmedKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const deeplTarget =
      targetLang.toLowerCase() === 'pt-rbr'
        ? 'PT-BR'
        : targetLang.toLowerCase() === 'zh-rcn'
        ? 'ZH-HANS'
        : baseLang.toUpperCase();

    const res = await nativeFetch<{ translations?: Array<{ text?: string }> }>(
      `https://${host}/v2/translate`,
      {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${trimmedKey}`, 'Content-Type': 'application/json' },
        data: { text: [sourceText], source_lang: 'EN', target_lang: deeplTarget },
      }
    );
    if (!res.ok) throw providerHttpError('DeepL', res.status);
    const text = res.data?.translations?.[0]?.text;
    if (!text) throw new Error('DeepL: استجابة فارغة / Empty translation response');
    return stripMetadataWrappers(text, sourceText);
  };

  const tryOpenAI = async (): Promise<string> => {
    const langLabel = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang;
    const pluralContext = pluralQuantity ? ` (CLDR plural form: ${pluralQuantity})` : '';

    const res = await nativeFetch<{ choices?: Array<{ message?: { content?: string } }> }>(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${trimmedKey}`, 'Content-Type': 'application/json' },
        data: {
          model: 'gpt-4o-mini',
          temperature: 0.1,
          messages: [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            {
              role: 'user',
              content: `Translate the following Android strings.xml value from English to ${langLabel}${pluralContext}. Return ONLY the translated text:\n${sourceText}`,
            },
          ],
        },
      }
    );
    if (!res.ok) throw providerHttpError('OpenAI', res.status);
    const content = res.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI: استجابة فارغة / Empty response');
    return stripMetadataWrappers(content, sourceText);
  };

  const tryGoogleCloudKey = async (): Promise<string> => {
    const res = await nativeFetch<{ data?: { translations?: Array<{ translatedText?: string }> } }>(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(trimmedKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: { q: sourceText, source: 'en', target: baseLang, format: 'text' },
      }
    );
    if (!res.ok) throw providerHttpError('Google Cloud Translation', res.status);
    const t = res.data?.data?.translations?.[0]?.translatedText;
    if (!t) throw new Error('Google Cloud Translation: استجابة فارغة / Empty response');
    return stripMetadataWrappers(t, sourceText);
  };

  const tryMicrosoft = async (): Promise<string> => {
    const res = await nativeFetch<Array<{ translations?: Array<{ text?: string }> }>>(
      `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=${encodeURIComponent(baseLang)}`,
      {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': trimmedKey, 'Content-Type': 'application/json' },
        data: [{ Text: sourceText }],
      }
    );
    if (!res.ok) throw providerHttpError('Microsoft Translator', res.status);
    const text = res.data?.[0]?.translations?.[0]?.text;
    if (!text) throw new Error('Microsoft Translator: استجابة فارغة / Empty response');
    return stripMetadataWrappers(text, sourceText);
  };

  const tryLara = async (): Promise<string> => {
    const { AccessKey, AuthToken, Translator: LaraTranslator } = await loadLara();
    const laraTarget = laraTargetFor(targetLang);
    const creds = parseLaraCredentials(trimmedKey);

    // 1. Official Lara SDK with AccessKey (ID + Secret)
    if (creds.id && creds.secret) {
      try {
        const lara = new LaraTranslator(new AccessKey(creds.id, creds.secret), {
          connectionTimeoutMs: LARA_CONNECTION_TIMEOUT_MS,
        });
        const result = await lara.translate(sourceText, 'en', laraTarget, { timeoutInMillis: LARA_CONNECTION_TIMEOUT_MS });
        if (result && typeof result.translation === 'string' && result.translation.trim()) {
          return stripMetadataWrappers(result.translation, sourceText);
        }
      } catch {
        if (laraTarget !== baseLang) {
          try {
            const lara = new LaraTranslator(new AccessKey(creds.id, creds.secret), {
              connectionTimeoutMs: LARA_CONNECTION_TIMEOUT_MS,
            });
            const fallback = await lara.translate(sourceText, 'en', baseLang, { timeoutInMillis: LARA_CONNECTION_TIMEOUT_MS });
            if (fallback && typeof fallback.translation === 'string' && fallback.translation.trim()) {
              return stripMetadataWrappers(fallback.translation, sourceText);
            }
          } catch {
            // Fall through to REST attempts
          }
        }
      }
    }

    // 2. Official Lara SDK with AuthToken
    if (creds.singleToken) {
      try {
        const tokenClient = new LaraTranslator(new AuthToken(creds.singleToken, ''), {
          connectionTimeoutMs: LARA_CONNECTION_TIMEOUT_MS,
        });
        const result = await tokenClient.translate(sourceText, 'en', laraTarget, { timeoutInMillis: LARA_CONNECTION_TIMEOUT_MS });
        if (result && typeof result.translation === 'string' && result.translation.trim()) {
          return stripMetadataWrappers(result.translation, sourceText);
        }
      } catch {
        // Fall through to direct REST probes
      }

      // 3. Direct REST call via nativeFetch
      const headerVariants: Array<Record<string, string>> = [
        { Authorization: `Bearer ${creds.singleToken}` },
        { 'x-api-key': creds.singleToken },
        { Authorization: `Lara:${creds.singleToken}` },
      ];
      interface LaraRestResponse {
        translation?: string;
        data?: { translation?: string };
        content?: { translation?: string };
      }
      for (const authHeader of headerVariants) {
        try {
          const restRes = await nativeFetch<LaraRestResponse>('https://api.laratranslate.com/v2/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            data: { q: sourceText, source: 'en', target: laraTarget },
          });
          if (!restRes.ok) continue;

          let tr: string | undefined;
          if (restRes.data && typeof restRes.data === 'object') {
            tr = restRes.data.translation || restRes.data.data?.translation || restRes.data.content?.translation;
          }
          if (!tr && typeof restRes.text === 'string') {
            const lines = restRes.text.split('\n').map((l) => l.trim()).filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
              try {
                const parsed = JSON.parse(lines[i]);
                tr = parsed.translation || parsed.data?.translation || parsed.content?.translation;
                if (tr) break;
              } catch {
                // not JSON line
              }
            }
          }
          if (tr && typeof tr === 'string') return stripMetadataWrappers(tr, sourceText);
        } catch {
          // try next header
        }
      }
    }

    throw new Error(
      'Lara Translate: فشل التحقق من المفتاح. أدخل Access Key ID و Secret / Authentication failed: check credentials.'
    );
  };

  const tryLibre = async (): Promise<string> => {
    let base = trimmedFolderId ? trimmedFolderId.replace(/\/$/, '') : 'https://libretranslate.com';
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = `https://${base}`;
    }
    base = assertSafeLibreBase(base);
    const res = await nativeFetch<{ translatedText?: string }>(`${base}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: {
        q: sourceText,
        source: 'en',
        target: libreTarget(targetLang),
        format: 'text',
        ...(trimmedKey && trimmedKey !== 'none' ? { api_key: trimmedKey } : {}),
      },
    });
    if (!res.ok) throw providerHttpError('LibreTranslate', res.status);
    const text = res.data?.translatedText;
    if (!text) throw new Error('LibreTranslate: ردّ غير متوقع / Unexpected response.');
    return stripMetadataWrappers(text, sourceText);
  };

  const runners: Record<DirectProviderType, { type: string; fn: () => Promise<string> }> = {
    yandex: { type: 'yandex', fn: tryYandex },
    lara: { type: 'lara', fn: tryLara },
    deepl: { type: 'deepl', fn: tryDeepL },
    openai: { type: 'openai', fn: tryOpenAI },
    google_cloud: { type: 'google_cloud', fn: tryGoogleCloudKey },
    microsoft: { type: 'microsoft', fn: tryMicrosoft },
    libretranslate: { type: 'libretranslate', fn: tryLibre },
  };

  if ((DIRECT_PROVIDER_TYPES as readonly string[]).includes(providerType)) {
    const runner = runners[providerType as DirectProviderType];
    return { translatedText: await runner.fn(), detectedType: runner.type };
  }

  // Auto-detect based on key pattern
  let order: DirectProviderType[] = [...DIRECT_PROVIDER_TYPES.filter((t) => t !== 'libretranslate')];
  if (trimmedKey.startsWith('AIza')) order = ['google_cloud', ...order.filter((t) => t !== 'google_cloud')];
  else if (trimmedKey.startsWith('sk-')) order = ['openai', ...order.filter((t) => t !== 'openai')];
  else if (trimmedKey.endsWith(':fx')) order = ['deepl', ...order.filter((t) => t !== 'deepl')];
  else if (trimmedKey.startsWith('AQVN') || trimmedKey.startsWith('trnsl.') || trimmedKey.startsWith('t1.'))
    order = ['yandex', ...order.filter((t) => t !== 'yandex')];
  else if ((trimmedKey.includes(':') && !trimmedKey.endsWith(':fx')) || trimmedKey.toLowerCase().includes('lara'))
    order = ['lara', ...order.filter((t) => t !== 'lara')];

  for (const t of order) {
    try {
      const text = await runners[t].fn();
      if (text) return { translatedText: text, detectedType: t };
    } catch {
      // try next
    }
  }

  throw new Error('API key could not be verified with any supported translation provider.');
}

/**
 * Tests an API key directly on the client / native device.
 */
export async function directTestProviderApiKey(
  providerType: string,
  apiKey: string,
  folderId?: string
): Promise<DirectProviderTestResult> {
  const testPhrase = 'Save';
  const targetLang = 'ar';
  const acceptedAnswers = ['حفظ', 'احفظ', 'تخزين', 'حفظ الملف'];

  try {
    const res = await directCallProviderWithKey(
      providerType,
      apiKey,
      testPhrase,
      targetLang,
      'Arabic',
      undefined,
      folderId
    );

    let reference: string | null = null;
    try {
      reference = await fetchGoogleGtxRaw(testPhrase, targetLang, 4000);
    } catch {
      // Reference optional
    }

    const normOut = normalizeForComparison(res.translatedText);
    const normRef = reference ? normalizeForComparison(reference) : null;
    const matchesAccepted = acceptedAnswers.some((a) => normalizeForComparison(a) === normOut);
    const matchesRef = normRef ? normOut === normRef || normOut.includes(normRef) || normRef.includes(normOut) : false;

    return {
      success: true,
      matched: matchesAccepted || matchesRef || normOut.length > 0,
      testSource: testPhrase,
      googleTranslation: reference || acceptedAnswers[0],
      providerTranslation: res.translatedText,
      detectedType: res.detectedType,
    };
  } catch (err) {
    return {
      success: false,
      matched: false,
      error: err instanceof Error ? err.message : 'Unknown authentication error',
    };
  }
}
