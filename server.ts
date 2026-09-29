import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { AccessKey, AuthToken, Translator as LaraTranslator } from '@translated/lara';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const SYSTEM_INSTRUCTION = `You are an expert Android strings.xml localization engine.
Follow these strict rules for every translation:
1. Return ONLY the final translated string text. Do NOT include any metadata labels, prefixes, explanations, notes, or bracketed tags such as "[ترجمة المصطلح: ...]", "[ترجمة: ...]", "[Translation: ...]", or markdown code fences.
2. Strictly preserve all original formatting and Android syntax tokens in their exact form:
   - Printf format specifiers (e.g., %s, %d, %1$s, %2$d, %1$.1f, %%)
   - Escape sequences (e.g., \\n, \\\\n, \\t, \\', \\")
   - Inline HTML/XML tags (e.g., <b>, </b>, <i>, <u>, <xliff:g>)
   - Resource references (e.g., @string/..., @plurals/...) and ICU placeholders (e.g., {0}, {count})
3. Use natural, concise mobile UI terminology appropriate for Android applications (for example, translate "Install" to "تثبيت" in Arabic).
4. Preserve leading or trailing whitespace and outer quotes only if they exist in the source string.`;

function stripMetadataWrappers(text: string, sourceText: string): string {
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

function normalizeForComparison(str: string): string {
  return str
    .trim()
    .toLowerCase()
    // Remove Arabic diacritics (tashkeel) and tatweel
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
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

async function fetchGoogleTranslate(text: string, targetLang: string): Promise<string> {
  const baseLang = targetLang.split('-')[0].toLowerCase();
  const googleLang =
    targetLang.toLowerCase() === 'zh-rcn'
      ? 'zh-CN'
      : targetLang.toLowerCase() === 'zh-rtw'
        ? 'zh-TW'
        : targetLang.toLowerCase() === 'pt-rbr'
          ? 'pt-BR'
          : baseLang;

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(
    googleLang
  )}&dt=t&q=${encodeURIComponent(text)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Translate HTTP ${res.status}`);
  }
  const data = await res.json();
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const combined = data[0]
      .map((chunk: unknown) => (Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : ''))
      .join('');
    return stripMetadataWrappers(combined, text);
  }
  throw new Error('Invalid Google Translate response');
}

async function callProviderWithKey(
  providerType: string,
  apiKey: string,
  sourceText: string,
  targetLang: string,
  targetLocaleName?: string,
  pluralQuantity?: string
): Promise<{ translatedText: string; detectedType: string }> {
  const baseLang = targetLang.split('-')[0].toLowerCase();
  const trimmedKey = apiKey.trim();

  const tryYandex = async (): Promise<string> => {
    // 1. Try Yandex Cloud Translate v2 API (supports Api-Key or IAM Bearer token)
    const cloudRes = await fetch('https://translate.api.cloud.yandex.net/translate/v2/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: trimmedKey.startsWith('t1.') ? `Bearer ${trimmedKey}` : `Api-Key ${trimmedKey}`,
      },
      body: JSON.stringify({
        sourceLanguageCode: 'en',
        targetLanguageCode: baseLang,
        texts: [sourceText],
      }),
    });

    if (cloudRes.ok) {
      const data = (await cloudRes.json()) as { translations?: Array<{ text?: string }> };
      const text = data.translations?.[0]?.text;
      if (text) return stripMetadataWrappers(text, sourceText);
    }

    // 2. Try Yandex Translate v1.5 API
    const v1Url = `https://translate.yandex.net/api/v1.5/tr.json/translate?key=${encodeURIComponent(
      trimmedKey
    )}&text=${encodeURIComponent(sourceText)}&lang=en-${encodeURIComponent(baseLang)}`;
    const v1Res = await fetch(v1Url);
    if (v1Res.ok) {
      const v1Data = (await v1Res.json()) as { text?: string[] };
      if (Array.isArray(v1Data.text) && v1Data.text[0]) {
        return stripMetadataWrappers(v1Data.text[0], sourceText);
      }
    }

    // 3. Try YandexGPT / OpenAI-compatible Yandex AI endpoint
    const yandexAiRes = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Api-Key ${trimmedKey}`,
      },
      body: JSON.stringify({
        modelUri: 'gpt://b1g/yandexgpt-lite/latest',
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

    if (yandexAiRes.ok) {
      const yData = (await yandexAiRes.json()) as {
        result?: { alternatives?: Array<{ message?: { text?: string } }> };
      };
      const yText = yData.result?.alternatives?.[0]?.message?.text;
      if (yText) return stripMetadataWrappers(yText, sourceText);
    }

    throw new Error('Yandex API key authentication failed');
  };

  const tryDeepL = async (): Promise<string> => {
    const isFree = trimmedKey.endsWith(':fx');
    const host = isFree ? 'api-free.deepl.com' : 'api.deepl.com';
    const deeplTarget =
      targetLang.toLowerCase() === 'pt-rbr'
        ? 'PT-BR'
        : targetLang.toLowerCase() === 'zh-rcn'
          ? 'ZH-HANS'
          : baseLang.toUpperCase();

    const res = await fetch(`https://${host}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${trimmedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [sourceText],
        source_lang: 'EN',
        target_lang: deeplTarget,
      }),
    });

    if (!res.ok) {
      throw new Error(`DeepL API HTTP ${res.status}`);
    }
    const data = (await res.json()) as { translations?: Array<{ text?: string }> };
    const text = data.translations?.[0]?.text;
    if (!text) throw new Error('Empty DeepL translation');
    return stripMetadataWrappers(text, sourceText);
  };

  const tryOpenAI = async (): Promise<string> => {
    const langLabel = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang;
    const pluralContext = pluralQuantity ? ` (CLDR plural form: ${pluralQuantity})` : '';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        'Content-Type': 'application/json',
      },
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

    if (!res.ok) {
      throw new Error(`OpenAI API HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty OpenAI response');
    return stripMetadataWrappers(content, sourceText);
  };

  const tryGoogleOrGeminiKey = async (): Promise<string> => {
    // 1. Try Gemini API with user-supplied key
    try {
      const customAi = new GoogleGenAI({
        apiKey: trimmedKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
      const langLabel = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang;
      const response = await customAi.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Translate the following Android strings.xml value from English to ${langLabel}. Return ONLY the translated text:\n${sourceText}`,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      if (response.text) {
        return stripMetadataWrappers(response.text, sourceText);
      }
    } catch {
      // Fall through to Google Cloud Translation v2 API
    }

    // 2. Try Google Cloud Translation v2 REST API
    const gUrl = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(trimmedKey)}`;
    const gRes = await fetch(gUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: sourceText,
        source: 'en',
        target: baseLang,
        format: 'text',
      }),
    });
    if (gRes.ok) {
      const gData = (await gRes.json()) as {
        data?: { translations?: Array<{ translatedText?: string }> };
      };
      const t = gData.data?.translations?.[0]?.translatedText;
      if (t) return stripMetadataWrappers(t, sourceText);
    }
    throw new Error('Google / Gemini API key authentication failed');
  };

  const tryMicrosoft = async (): Promise<string> => {
    const msUrl = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=${encodeURIComponent(
      baseLang
    )}`;
    const msRes = await fetch(msUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': trimmedKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: sourceText }]),
    });
    if (!msRes.ok) {
      throw new Error(`Microsoft Translator HTTP ${msRes.status}`);
    }
    const msData = (await msRes.json()) as Array<{
      translations?: Array<{ text?: string }>;
    }>;
    const text = msData?.[0]?.translations?.[0]?.text;
    if (!text) throw new Error('Empty Microsoft Translator response');
    return stripMetadataWrappers(text, sourceText);
  };

  const parseLaraCredentials = (
    raw: string
  ): { id?: string; secret?: string; singleToken?: string } => {
    const cleaned = raw.trim();

    // 1. JSON object format: {"id":"...", "secret":"..."}
    if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
      try {
        const parsed = JSON.parse(cleaned) as Record<string, string>;
        const id =
          parsed.id ||
          parsed.accessKeyId ||
          parsed.access_key_id ||
          parsed.LARA_ACCESS_KEY_ID;
        const secret =
          parsed.secret ||
          parsed.accessKeySecret ||
          parsed.access_key_secret ||
          parsed.LARA_ACCESS_KEY_SECRET;
        if (id && secret) {
          return { id: String(id).trim(), secret: String(secret).trim() };
        }
      } catch {
        // Fall through
      }
    }

    // 2. Environment variable paste format: LARA_ACCESS_KEY_ID=... LARA_ACCESS_KEY_SECRET=...
    const envIdMatch = cleaned.match(/LARA_ACCESS_KEY_ID\s*=\s*["']?([^\s"']+)["']?/i);
    const envSecretMatch = cleaned.match(/LARA_ACCESS_KEY_SECRET\s*=\s*["']?([^\s"']+)["']?/i);
    if (envIdMatch?.[1] && envSecretMatch?.[1]) {
      return { id: envIdMatch[1].trim(), secret: envSecretMatch[1].trim() };
    }

    // 3. Delimited format: id:secret, id|secret, id,secret, or id secret (excluding DeepL :fx)
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
  };

  const tryLara = async (): Promise<string> => {
    const laraTarget =
      targetLang.toLowerCase() === 'zh-rcn'
        ? 'zh-CN'
        : targetLang.toLowerCase() === 'zh-rtw'
          ? 'zh-TW'
          : targetLang.toLowerCase() === 'pt-rbr'
            ? 'pt-BR'
            : baseLang;

    const creds = parseLaraCredentials(trimmedKey);

    // 1. Official Lara SDK with AccessKey (ID + Secret)
    if (creds.id && creds.secret) {
      const lara = new LaraTranslator(new AccessKey(creds.id, creds.secret), {
        connectionTimeoutMs: 10000,
      });
      try {
        const result = await lara.translate(sourceText, 'en', laraTarget, {
          timeoutInMillis: 10000,
        });
        if (result && typeof result.translation === 'string' && result.translation.trim()) {
          return stripMetadataWrappers(result.translation, sourceText);
        }
      } catch (err) {
        if (laraTarget !== baseLang) {
          const fallbackRes = await lara.translate(sourceText, 'en', baseLang, {
            timeoutInMillis: 10000,
          });
          if (
            fallbackRes &&
            typeof fallbackRes.translation === 'string' &&
            fallbackRes.translation.trim()
          ) {
            return stripMetadataWrappers(fallbackRes.translation, sourceText);
          }
        }
        throw err;
      }
    }

    // 2. Official Lara SDK with AuthToken (single token / JWT)
    if (creds.singleToken) {
      try {
        const laraTokenClient = new LaraTranslator(new AuthToken(creds.singleToken, ''), {
          connectionTimeoutMs: 10000,
        });
        const result = await laraTokenClient.translate(sourceText, 'en', laraTarget, {
          timeoutInMillis: 10000,
        });
        if (result && typeof result.translation === 'string' && result.translation.trim()) {
          return stripMetadataWrappers(result.translation, sourceText);
        }
      } catch {
        // Fall through to REST header probes
      }

      // 3. Direct REST call to Lara API with Bearer or x-api-key header
      for (const authHeader of [
        { Authorization: `Bearer ${creds.singleToken}` },
        { 'x-api-key': creds.singleToken },
        { Authorization: `Lara:${creds.singleToken}` },
      ]) {
        try {
          const restRes = await fetch('https://api.laratranslate.com/v2/translate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authHeader,
            },
            body: JSON.stringify({
              q: sourceText,
              source: 'en',
              target: laraTarget,
            }),
          });
          if (restRes.ok) {
            const textBody = await restRes.text();
            const lines = textBody
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
                const tr =
                  parsed.translation || parsed.data?.translation || parsed.content?.translation;
                if (tr && typeof tr === 'string') {
                  return stripMetadataWrappers(tr, sourceText);
                }
              } catch {
                // Ignore non-JSON line
              }
            }
          }
        } catch {
          // Continue
        }
      }
    }

    throw new Error(
      'Lara Translate authentication failed. Please provide valid Lara Access Key ID and Secret (or ID:Secret).'
    );
  };

  if (providerType === 'yandex') {
    return { translatedText: await tryYandex(), detectedType: 'yandex' };
  }
  if (providerType === 'lara') {
    return { translatedText: await tryLara(), detectedType: 'lara' };
  }
  if (providerType === 'deepl') {
    return { translatedText: await tryDeepL(), detectedType: 'deepl' };
  }
  if (providerType === 'openai') {
    return { translatedText: await tryOpenAI(), detectedType: 'openai' };
  }
  if (providerType === 'google_cloud' || providerType === 'gemini_custom') {
    return { translatedText: await tryGoogleOrGeminiKey(), detectedType: 'google_cloud' };
  }
  if (providerType === 'microsoft') {
    return { translatedText: await tryMicrosoft(), detectedType: 'microsoft' };
  }

  // Auto-detect provider from key format or sequential probing
  const probes: Array<{ type: string; fn: () => Promise<string> }> = [
    { type: 'lara', fn: tryLara },
    { type: 'yandex', fn: tryYandex },
    { type: 'deepl', fn: tryDeepL },
    { type: 'google_cloud', fn: tryGoogleOrGeminiKey },
    { type: 'openai', fn: tryOpenAI },
    { type: 'microsoft', fn: tryMicrosoft },
  ];

  // Prioritize based on key prefix heuristics
  if (trimmedKey.startsWith('sk-')) {
    probes.sort((a) => (a.type === 'openai' ? -1 : 1));
  } else if (trimmedKey.endsWith(':fx')) {
    probes.sort((a) => (a.type === 'deepl' ? -1 : 1));
  } else if (trimmedKey.startsWith('AIza')) {
    probes.sort((a) => (a.type === 'google_cloud' ? -1 : 1));
  } else if (trimmedKey.startsWith('AQVN') || trimmedKey.startsWith('trnsl.')) {
    probes.sort((a) => (a.type === 'yandex' ? -1 : 1));
  } else if (
    (trimmedKey.includes(':') && !trimmedKey.endsWith(':fx')) ||
    trimmedKey.toLowerCase().includes('lara')
  ) {
    probes.sort((a) => (a.type === 'lara' ? -1 : 1));
  }

  for (const probe of probes) {
    try {
      const translatedText = await probe.fn();
      if (translatedText) {
        return { translatedText, detectedType: probe.type };
      }
    } catch {
      // Continue trying next provider
    }
  }

  throw new Error('API key could not be verified with any supported translation provider.');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  // Test & verify a custom translation provider API key by comparing its output to Google Translate
  app.post('/api/providers/test', async (req, res) => {
    try {
      const { providerType = 'auto', apiKey = '' } = req.body as {
        providerType?: string;
        apiKey?: string;
      };

      if (!apiKey || !apiKey.trim()) {
        res.status(400).json({ error: 'API key is required.' });
        return;
      }

      // Small standard test word ("Install" -> Arabic "تثبيت")
      const testSource = 'Install';
      const testTargetLang = 'ar';

      // 1. Get reference translation from Google Translate
      let googleTranslation = 'تثبيت';
      try {
        const gRes = await fetchGoogleTranslate(testSource, testTargetLang);
        if (gRes && gRes.trim()) {
          googleTranslation = gRes.trim();
        }
      } catch {
        googleTranslation = 'تثبيت';
      }

      // 2. Call the candidate provider with the user's API key on the same test string
      const { translatedText: providerTranslation, detectedType } = await callProviderWithKey(
        providerType,
        apiKey,
        testSource,
        testTargetLang,
        'Arabic'
      );

      // 3. Compare normalized outputs against Google Translate reference (and accepted Arabic equivalents for "Install")
      const normGoogle = normalizeForComparison(googleTranslation);
      const normProvider = normalizeForComparison(providerTranslation);
      const acceptedEquivalents = new Set([
        normGoogle,
        normalizeForComparison('تثبيت'),
        normalizeForComparison('التثبيت'),
        normalizeForComparison('تنصيب'),
        normalizeForComparison('ثبت'),
      ]);

      const matched =
        Boolean(normProvider) &&
        (normProvider === normGoogle ||
          normProvider.includes(normGoogle) ||
          normGoogle.includes(normProvider) ||
          acceptedEquivalents.has(normProvider));

      if (!matched) {
        res.status(422).json({
          success: false,
          matched: false,
          testSource,
          googleTranslation,
          providerTranslation,
          detectedType,
          error: `Test translation "${providerTranslation}" did not match Google Translate reference "${googleTranslation}".`,
        });
        return;
      }

      res.json({
        success: true,
        matched: true,
        testSource,
        googleTranslation,
        providerTranslation,
        detectedType,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        matched: false,
        error:
          error instanceof Error
            ? error.message
            : 'API key test failed. Please check the key and provider type.',
      });
    }
  });

  // Translate using a custom or built-in provider
  app.post('/api/providers/translate', async (req, res) => {
    try {
      const {
        providerType,
        apiKey,
        sourceText,
        targetLang = 'ar',
        targetLocaleName,
        pluralQuantity,
      } = req.body as {
        providerType: string;
        apiKey?: string;
        sourceText: string;
        targetLang?: string;
        targetLocaleName?: string;
        pluralQuantity?: string;
      };

      if (!sourceText || !sourceText.trim()) {
        res.json({ translatedText: sourceText || '' });
        return;
      }

      // Built-in Yandex AI (via server-side AI with Yandex terminology style or custom key)
      if (providerType === 'yandex_builtin') {
        if (process.env.GEMINI_API_KEY) {
          const langLabel = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang;
          const pluralContext = pluralQuantity
            ? `\nPlural quantity category: "${pluralQuantity}".`
            : '';
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `[Yandex Translate Engine Mode] Translate the following Android strings.xml value from English to ${langLabel}.${pluralContext}\nReturn ONLY the translated text without any metadata labels and preserve all placeholders (%s, %d, %1$s, \\n, HTML tags) exactly:\n${sourceText}`,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              temperature: 0.1,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
          const cleaned = stripMetadataWrappers(response.text || '', sourceText);
          if (cleaned) {
            res.json({ translatedText: cleaned });
            return;
          }
        }
        const fallback = await fetchGoogleTranslate(sourceText, targetLang);
        res.json({ translatedText: fallback });
        return;
      }

      if (!apiKey) {
        res.status(400).json({ error: 'Missing API key for custom provider' });
        return;
      }

      const { translatedText } = await callProviderWithKey(
        providerType,
        apiKey,
        sourceText,
        targetLang,
        targetLocaleName,
        pluralQuantity
      );

      res.json({ translatedText });
    } catch (error) {
      console.error('Provider translation error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Provider translation failed',
      });
    }
  });

  app.post('/api/translate', async (req, res) => {
    try {
      const { sourceText, targetLang, targetLocaleName, pluralQuantity } = req.body as {
        sourceText?: string;
        targetLang?: string;
        targetLocaleName?: string;
        pluralQuantity?: string;
      };

      if (!sourceText || typeof sourceText !== 'string' || !sourceText.trim()) {
        res.json({ translatedText: sourceText || '' });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
        return;
      }

      const langLabel = targetLocaleName ? `${targetLocaleName} (${targetLang})` : targetLang || 'ar';
      const pluralContext = pluralQuantity
        ? `\nPlural quantity category: "${pluralQuantity}" (CLDR plural form for ${langLabel}).`
        : '';

      const prompt = `Translate the following Android strings.xml value from English to ${langLabel}.${pluralContext}
Return ONLY the translated text without any metadata labels (never output "[ترجمة المصطلح: ...]") and preserve all placeholders (%s, %d, %1$s, %2$d, \\n, HTML tags) exactly as they appear.

Source string:
${sourceText}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const rawOutput = response.text || '';
      const cleanedOutput = stripMetadataWrappers(rawOutput, sourceText);

      res.json({ translatedText: cleanedOutput });
    } catch (error) {
      console.error('Gemini translation error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate translation suggestion',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
