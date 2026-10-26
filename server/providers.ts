// Server-side calls to third-party translation APIs using the key the user supplied for a single request.
// Keys are never logged or stored here.
import { AccessKey, AuthToken, Translator as LaraTranslator } from '@translated/lara';
import {
  SYSTEM_INSTRUCTION,
  fetchGoogleGtxRaw,
  fetchWithTimeout,
  normalizeForComparison,
  providerHttpError,
  stripMetadataWrappers,
} from '../src/shared/translateCore';

export const PROVIDER_TYPES = [
  'yandex',
  'lara',
  'deepl',
  'openai',
  'google_cloud',
  'microsoft',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface ProviderResult {
  translatedText: string;
  detectedType: string;
}

const LARA_CONNECTION_TIMEOUT_MS = 10000;

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
      // Fall through to the other formats
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

function laraTargetFor(targetLang: string): string {
  const lower = targetLang.toLowerCase();
  if (lower === 'zh-rcn') return 'zh-CN';
  if (lower === 'zh-rtw') return 'zh-TW';
  if (lower === 'pt-rbr') return 'pt-BR';
  return lower.split('-')[0];
}

/**
 * Translates `sourceText` (English) with the given provider using the caller's key.
 * Throws a user-readable error when the provider cannot be used.
 */
export async function callProviderWithKey(
  providerType: string,
  apiKey: string,
  sourceText: string,
  targetLang: string,
  targetLocaleName?: string,
  pluralQuantity?: string,
  folderId?: string
): Promise<ProviderResult> {
  const baseLang = targetLang.split('-')[0].toLowerCase();
  const trimmedKey = apiKey.trim();
  const trimmedFolderId = folderId?.trim() || '';

  const tryYandex = async (): Promise<string> => {
    // Yandex Cloud Translate v2 (Api-Key or IAM token). The deprecated v1.5 endpoint, which put the key
    // in the URL where it could be written to logs, has been removed.
    const authHeader = trimmedKey.startsWith('t1.') ? `Bearer ${trimmedKey}` : `Api-Key ${trimmedKey}`;
    const cloudRes = await fetchWithTimeout('https://translate.api.cloud.yandex.net/translate/v2/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        sourceLanguageCode: 'en',
        targetLanguageCode: baseLang,
        texts: [sourceText],
        // Required with an IAM token (personal Yandex account); a service-account API key already knows its folder.
        ...(trimmedFolderId ? { folderId: trimmedFolderId } : {}),
      }),
    });
    if (cloudRes.ok) {
      const data = (await cloudRes.json()) as { translations?: Array<{ text?: string }> };
      const text = data.translations?.[0]?.text;
      if (text) return stripMetadataWrappers(text, sourceText);
    }

    // Fallback: YandexGPT completion endpoint (only tried when the translate endpoint did not answer).
    const aiRes = await fetchWithTimeout('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        ...(trimmedFolderId ? { 'x-folder-id': trimmedFolderId } : {}),
      },
      body: JSON.stringify({
        modelUri: `gpt://${trimmedFolderId || 'b1g'}/yandexgpt-lite/latest`,
        completionOptions: { stream: false, temperature: 0.1, maxTokens: '200' },
        messages: [
          { role: 'system', text: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            text: `Translate from English to ${targetLocaleName || baseLang}. Return ONLY the translated text:\n${sourceText}`,
          },
        ],
      }),
    });
    if (aiRes.ok) {
      const yData = (await aiRes.json()) as {
        result?: { alternatives?: Array<{ message?: { text?: string } }> };
      };
      const yText = yData.result?.alternatives?.[0]?.message?.text;
      if (yText) return stripMetadataWrappers(yText, sourceText);
    }

    throw new Error(
      trimmedFolderId
        ? 'Yandex: فشل التحقق من المفتاح أو معرّف المجلد / Authentication failed: check the key/IAM token and folder ID.'
        : 'Yandex: فشل التحقق من المفتاح. مع حساب شخصي (IAM token) يلزم معرّف المجلد / Authentication failed; an IAM token needs a folder ID.'
    );
  };

  const tryDeepL = async (): Promise<string> => {
    const host = trimmedKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const deeplTarget =
      targetLang.toLowerCase() === 'pt-rbr' ? 'PT-BR' : targetLang.toLowerCase() === 'zh-rcn' ? 'ZH-HANS' : baseLang.toUpperCase();
    const res = await fetchWithTimeout(`https://${host}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${trimmedKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: [sourceText], source_lang: 'EN', target_lang: deeplTarget }),
    });
    if (!res.ok) throw providerHttpError('DeepL', res.status);
    const data = (await res.json()) as { translations?: Array<{ text?: string }> };
    const text = data.translations?.[0]?.text;
    if (!text) throw new Error('DeepL: استجابة فارغة / Empty translation response');
    return stripMetadataWrappers(text, sourceText);
  };

  const tryOpenAI = async (): Promise<string> => {
    const langLabel = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang;
    const pluralContext = pluralQuantity ? ` (CLDR plural form: ${pluralQuantity})` : '';
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${trimmedKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            content: `Translate the following Android strings.xml value from English to ${langLabel}${pluralContext}. Return ONLY the translated text:\n${sourceText}`,
          },
        ],
      }),
    });
    if (!res.ok) throw providerHttpError('OpenAI', res.status);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI: استجابة فارغة / Empty response');
    return stripMetadataWrappers(content, sourceText);
  };

  const tryGoogleCloudKey = async (): Promise<string> => {
    const res = await fetchWithTimeout(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(trimmedKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: sourceText, source: 'en', target: baseLang, format: 'text' }),
      }
    );
    if (!res.ok) throw providerHttpError('Google Cloud Translation', res.status);
    const data = (await res.json()) as { data?: { translations?: Array<{ translatedText?: string }> } };
    const t = data.data?.translations?.[0]?.translatedText;
    if (!t) throw new Error('Google Cloud Translation: استجابة فارغة / Empty response');
    return stripMetadataWrappers(t, sourceText);
  };

  const tryMicrosoft = async (): Promise<string> => {
    const res = await fetchWithTimeout(
      `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=${encodeURIComponent(baseLang)}`,
      {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': trimmedKey, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ Text: sourceText }]),
      }
    );
    if (!res.ok) throw providerHttpError('Microsoft Translator', res.status);
    const data = (await res.json()) as Array<{ translations?: Array<{ text?: string }> }>;
    const text = data?.[0]?.translations?.[0]?.text;
    if (!text) throw new Error('Microsoft Translator: استجابة فارغة / Empty response');
    return stripMetadataWrappers(text, sourceText);
  };

  const tryLara = async (): Promise<string> => {
    const laraTarget = laraTargetFor(targetLang);
    const creds = parseLaraCredentials(trimmedKey);

    // 1. Official Lara SDK with AccessKey (ID + Secret)
    if (creds.id && creds.secret) {
      const lara = new LaraTranslator(new AccessKey(creds.id, creds.secret), {
        connectionTimeoutMs: LARA_CONNECTION_TIMEOUT_MS,
      });
      try {
        const result = await lara.translate(sourceText, 'en', laraTarget, { timeoutInMillis: LARA_CONNECTION_TIMEOUT_MS });
        if (result && typeof result.translation === 'string' && result.translation.trim()) {
          return stripMetadataWrappers(result.translation, sourceText);
        }
      } catch (err) {
        if (laraTarget !== baseLang) {
          const fallback = await lara.translate(sourceText, 'en', baseLang, { timeoutInMillis: LARA_CONNECTION_TIMEOUT_MS });
          if (fallback && typeof fallback.translation === 'string' && fallback.translation.trim()) {
            return stripMetadataWrappers(fallback.translation, sourceText);
          }
        }
        throw err;
      }
    }

    // 2. Official Lara SDK with AuthToken (single token / JWT)
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
        // Fall through to the REST header probes
      }

      // 3. Direct REST call with the token in one of the accepted header formats
      const headerVariants: Array<Record<string, string>> = [
        { Authorization: `Bearer ${creds.singleToken}` },
        { 'x-api-key': creds.singleToken },
        { Authorization: `Lara:${creds.singleToken}` },
      ];
      for (const authHeader of headerVariants) {
        try {
          const restRes = await fetchWithTimeout('https://api.laratranslate.com/v2/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ q: sourceText, source: 'en', target: laraTarget }),
          });
          if (!restRes.ok) continue;
          const lines = (await restRes.text())
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(lines[i]) as {
                translation?: string;
                data?: { translation?: string };
                content?: { translation?: string };
              };
              const tr = parsed.translation || parsed.data?.translation || parsed.content?.translation;
              if (tr && typeof tr === 'string') return stripMetadataWrappers(tr, sourceText);
            } catch {
              // Not JSON; try the previous line
            }
          }
        } catch {
          // Try the next header format
        }
      }
    }

    throw new Error(
      'Lara Translate: فشل التحقق من المفتاح. أدخل Access Key ID و Secret / Authentication failed: provide the Access Key ID and Secret.'
    );
  };

  const runners: Record<ProviderType, { type: string; fn: () => Promise<string> }> = {
    yandex: { type: 'yandex', fn: tryYandex },
    lara: { type: 'lara', fn: tryLara },
    deepl: { type: 'deepl', fn: tryDeepL },
    openai: { type: 'openai', fn: tryOpenAI },
    google_cloud: { type: 'google_cloud', fn: tryGoogleCloudKey },
    microsoft: { type: 'microsoft', fn: tryMicrosoft },
  };

  if ((PROVIDER_TYPES as readonly string[]).includes(providerType)) {
    const runner = runners[providerType as ProviderType];
    return { translatedText: await runner.fn(), detectedType: runner.type };
  }

  // Auto-detect: order the probes by the key's shape, then run them in parallel.
  // The first success in priority order wins, so the total time is bounded by the slowest probe, not the sum.
  let order: ProviderType[] = [...PROVIDER_TYPES];
  if (trimmedKey.startsWith('AIza')) order = ['google_cloud', ...order.filter((t) => t !== 'google_cloud')];
  else if (trimmedKey.startsWith('sk-')) order = ['openai', ...order.filter((t) => t !== 'openai')];
  else if (trimmedKey.endsWith(':fx')) order = ['deepl', ...order.filter((t) => t !== 'deepl')];
  else if (trimmedKey.startsWith('AQVN') || trimmedKey.startsWith('trnsl.') || trimmedKey.startsWith('t1.'))
    order = ['yandex', ...order.filter((t) => t !== 'yandex')];
  else if ((trimmedKey.includes(':') && !trimmedKey.endsWith(':fx')) || trimmedKey.toLowerCase().includes('lara'))
    order = ['lara', ...order.filter((t) => t !== 'lara')];

  const probes = order.map((t) => runners[t]);
  const settled = await Promise.allSettled(probes.map((p) => p.fn()));
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled' && outcome.value) {
      return { translatedText: outcome.value, detectedType: probes[i].type };
    }
  }
  throw new Error('API key could not be verified with any supported translation provider. / تعذّر التحقق من المفتاح مع أي مزود مدعوم.');
}

/**
 * Reference translation from Google (unofficial GTX endpoint) used by the key test.
 * Returns null when Google is unreachable so the caller can fall back to accepted equivalents.
 */
export async function getReferenceTranslation(sourceText: string, targetLang: string): Promise<string | null> {
  try {
    const raw = await fetchGoogleGtxRaw(sourceText, targetLang);
    return stripMetadataWrappers(raw, sourceText) || null;
  } catch {
    return null;
  }
}

/** True when a provider's output matches the reference (or an accepted equivalent) after normalization. */
export function outputMatchesReference(providerOutput: string, reference: string | null, accepted: string[]): boolean {
  const normProvider = normalizeForComparison(providerOutput);
  if (!normProvider) return false;
  const candidates = new Set([...accepted.map(normalizeForComparison)]);
  if (reference) {
    const normRef = normalizeForComparison(reference);
    if (normProvider === normRef || normProvider.includes(normRef) || normRef.includes(normProvider)) return true;
  }
  return candidates.has(normProvider);
}

/**
 * Translates several English texts in as few requests as the provider allows.
 * Yandex, DeepL, Microsoft and Google Cloud accept arrays; other providers are called once per text.
 * Returns one entry per input (null where that text could not be translated).
 */
export async function translateBatch(
  providerType: string,
  apiKey: string,
  texts: string[],
  targetLang: string,
  folderId?: string
): Promise<Array<string | null>> {
  const trimmedKey = apiKey.trim();
  const baseLang = targetLang.split('-')[0].toLowerCase();
  const deeplTarget =
    targetLang.toLowerCase() === 'pt-rbr' ? 'PT-BR' : targetLang.toLowerCase() === 'zh-rcn' ? 'ZH-HANS' : baseLang.toUpperCase();

  if (providerType === 'deepl') {
    const host = trimmedKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const res = await fetchWithTimeout(`https://${host}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${trimmedKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts, source_lang: 'EN', target_lang: deeplTarget }),
    }, 30000);
    if (!res.ok) throw providerHttpError('DeepL', res.status);
    const data = (await res.json()) as { translations?: Array<{ text?: string }> };
    return texts.map((_, i) => data.translations?.[i]?.text ?? null);
  }

  if (providerType === 'yandex' && (trimmedKey.startsWith('t1.') || !trimmedKey.includes(':'))) {
    const res = await fetchWithTimeout('https://translate.api.cloud.yandex.net/translate/v2/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: trimmedKey.startsWith('t1.') ? `Bearer ${trimmedKey}` : `Api-Key ${trimmedKey}`,
      },
      body: JSON.stringify({
        sourceLanguageCode: 'en',
        targetLanguageCode: baseLang,
        texts,
        ...(folderId ? { folderId } : {}),
      }),
    }, 30000);
    if (res.ok) {
      const data = (await res.json()) as { translations?: Array<{ text?: string }> };
      return texts.map((_, i) => data.translations?.[i]?.text ?? null);
    }
    // Fall through to per-text calls, which also try the YandexGPT fallback
  }

  if (providerType === 'microsoft') {
    const res = await fetchWithTimeout(
      `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=${encodeURIComponent(baseLang)}`,
      {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': trimmedKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(texts.map((Text) => ({ Text }))),
      },
      30000
    );
    if (!res.ok) throw providerHttpError('Microsoft Translator', res.status);
    const data = (await res.json()) as Array<{ translations?: Array<{ text?: string }> }>;
    return texts.map((_, i) => data?.[i]?.translations?.[0]?.text ?? null);
  }

  if (providerType === 'google_cloud') {
    const res = await fetchWithTimeout(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(trimmedKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: texts, source: 'en', target: baseLang, format: 'text' }),
      },
      30000
    );
    if (!res.ok) throw providerHttpError('Google Cloud Translation', res.status);
    const data = (await res.json()) as { data?: { translations?: Array<{ translatedText?: string }> } };
    return texts.map((_, i) => data.data?.translations?.[i]?.translatedText ?? null);
  }

  // Providers without batch endpoints (or Yandex keys that need the fallback): per-text calls, 4 at a time
  const results: Array<string | null> = new Array(texts.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < texts.length) {
      const idx = next++;
      try {
        results[idx] = (await callProviderWithKey(providerType, apiKey, texts[idx], targetLang, undefined, undefined, folderId))
          .translatedText;
      } catch {
        results[idx] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  return results;
}
