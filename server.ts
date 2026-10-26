import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import {
  PROVIDER_TYPES,
  callProviderWithKey,
  getReferenceTranslation,
  outputMatchesReference,
  translateBatch,
} from './server/providers';
import { createRateLimiter } from './server/rateLimit';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gemini is NOT handled by this server: the browser calls the Gemini API directly with the
// user's own key (see src/utils/geminiDirect.ts), so that key never reaches this server.

const MAX_SOURCE_TEXT = 5000;
const MAX_BATCH_SIZE = 50;
const MAX_KEY_LENGTH = 512;
const MAX_FOLDER_ID_LENGTH = 64;
const LANG_CODE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const PLURAL_QUANTITIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const ALLOWED_PROVIDER_VALUES = ['auto', ...PROVIDER_TYPES];

/** Returns the request body as a plain object, or null when it is missing or not an object. */
function readBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function validateProviderFields(
  body: Record<string, unknown>,
  { requireSourceText }: { requireSourceText: boolean }
): { error?: string; fields?: Record<string, string | undefined> } {
  const providerType = typeof body.providerType === 'string' ? body.providerType : 'auto';
  if (!ALLOWED_PROVIDER_VALUES.includes(providerType)) {
    return { error: 'نوع المزود غير مدعوم / Unsupported provider type.' };
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey) return { error: 'مفتاح API مطلوب / API key is required.' };
  if (apiKey.length > MAX_KEY_LENGTH) return { error: 'مفتاح API طويل جداً / API key is too long.' };

  const folderId = body.folderId === undefined || body.folderId === null ? undefined : String(body.folderId).trim();
  if (folderId && folderId.length > MAX_FOLDER_ID_LENGTH) {
    return { error: 'معرّف المجلد طويل جداً / Folder ID is too long.' };
  }

  const targetLang = typeof body.targetLang === 'string' ? body.targetLang : 'ar';
  if (!LANG_CODE.test(targetLang)) return { error: 'رمز اللغة غير صالح / Invalid language code.' };

  const sourceText = typeof body.sourceText === 'string' ? body.sourceText : '';
  if (requireSourceText) {
    if (!sourceText.trim()) return { error: 'النص المراد ترجمته مطلوب / Source text is required.' };
    if (sourceText.length > MAX_SOURCE_TEXT) {
      return { error: `النص طويل جداً (الحد ${MAX_SOURCE_TEXT} حرف) / Source text exceeds ${MAX_SOURCE_TEXT} characters.` };
    }
  }

  const targetLocaleName =
    typeof body.targetLocaleName === 'string' ? body.targetLocaleName.slice(0, 80) : undefined;
  const pluralQuantity =
    typeof body.pluralQuantity === 'string' && PLURAL_QUANTITIES.includes(body.pluralQuantity)
      ? body.pluralQuantity
      : undefined;

  return {
    fields: {
      providerType,
      apiKey,
      folderId,
      targetLang,
      sourceText,
      targetLocaleName,
      pluralQuantity,
    },
  };
}

/** Turns network and timeout errors into a clear message; other errors already carry a readable message. */
function toUserMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return 'انتهت مهلة الاتصال بالمزود، حاول لاحقاً / The provider timed out, try again later.';
    }
    if (err instanceof TypeError || /fetch failed/i.test(err.message)) {
      return 'تعذّر الاتصال بالمزود من الخادم / Could not reach the provider from the server.';
    }
    return err.message;
  }
  return fallback;
}

/** Logs only the error message, never the request (which contains the user's key). */
function logProviderError(scope: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${scope}] ${message.slice(0, 300)}`);
}

async function startServer() {
  const app = express();
  // PORT is set by the hosting platform (e.g. Cloud Run). Local runs default to loopback only.
  const PORT = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';
  const HOST = process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1');

  app.disable('x-powered-by');
  // Behind a load balancer (e.g. Cloud Run) use the first proxy's address so rate limiting sees real clients.
  // Only trust X-Forwarded-For when explicitly deployed behind a proxy; otherwise clients could spoof their IP.
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

  // Cross-origin access is off unless the origin is listed in ALLOWED_ORIGINS (comma-separated),
  // e.g. the packaged Android app's origin.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // Key-handling endpoints get their own limit; the static app is not limited.
  const providerLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
  app.use('/api/providers', providerLimiter);
  app.use('/api', express.json({ limit: '64kb' }));

  app.post('/api/providers/test', async (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (!body) {
      return res.status(400).json({ success: false, matched: false, error: 'طلب غير صالح / Invalid request body.' });
    }

    const validated = validateProviderFields(body, { requireSourceText: false });
    if (!validated.fields) {
      return res.status(400).json({ success: false, matched: false, error: validated.error });
    }
    const { providerType, apiKey, folderId } = validated.fields as Record<string, string>;

    // Small standard test word ("Install" -> Arabic "تثبيت")
    const testSource = 'Install';
    const testTargetLang = 'ar';
    const accepted = ['تثبيت', 'التثبيت', 'تنصيب', 'ثبت'];

    try {
      const reference = await getReferenceTranslation(testSource, testTargetLang);
      const { translatedText: providerTranslation, detectedType } = await callProviderWithKey(
        providerType,
        apiKey,
        testSource,
        testTargetLang,
        'Arabic',
        undefined,
        folderId
      );
      const matched = outputMatchesReference(providerTranslation, reference, [...accepted, reference ?? '']);
      const googleTranslation = reference ?? 'تثبيت';

      if (!matched) {
        return res.status(422).json({
          success: false,
          matched: false,
          testSource,
          googleTranslation,
          providerTranslation,
          detectedType,
          error: `الترجمة "${providerTranslation}" لا تطابق المرجع "${googleTranslation}". / Test translation did not match the reference.`,
        });
      }

      return res.json({ success: true, matched: true, testSource, googleTranslation, providerTranslation, detectedType });
    } catch (error) {
      logProviderError('providers/test', error);
      return res.status(400).json({
        success: false,
        matched: false,
        error: toUserMessage(error, 'فشل اختبار المفتاح / API key test failed.'),
      });
    }
  });

  app.post('/api/providers/translate', async (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (!body) return res.status(400).json({ error: 'طلب غير صالح / Invalid request body.' });

    const validated = validateProviderFields(body, { requireSourceText: true });
    if (!validated.fields) return res.status(400).json({ error: validated.error });
    const f = validated.fields;

    try {
      const { translatedText } = await callProviderWithKey(
        f.providerType as string,
        f.apiKey as string,
        f.sourceText as string,
        f.targetLang as string,
        f.targetLocaleName,
        f.pluralQuantity,
        f.folderId
      );
      return res.json({ translatedText });
    } catch (error) {
      logProviderError('providers/translate', error);
      return res.status(502).json({
        error: toUserMessage(error, 'فشلت الترجمة عبر المزود / Provider translation failed.'),
      });
    }
  });

  // Several short texts in one request (used by bulk translation to avoid one request per string)
  app.post('/api/providers/translate-batch', async (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (!body) return res.status(400).json({ error: 'طلب غير صالح / Invalid request body.' });

    const validated = validateProviderFields(body, { requireSourceText: false });
    if (!validated.fields) return res.status(400).json({ error: validated.error });
    const f = validated.fields;
    if (f.providerType === 'auto') {
      return res.status(400).json({ error: 'حدد نوع المزود للترجمة الجماعية / Choose a provider type for batch translation.' });
    }

    const texts = Array.isArray(body.texts) ? body.texts : null;
    if (!texts || texts.length === 0 || texts.length > MAX_BATCH_SIZE) {
      return res.status(400).json({ error: `عدد النصوص غير صالح (1 إلى ${MAX_BATCH_SIZE}) / Batch must hold 1 to ${MAX_BATCH_SIZE} texts.` });
    }
    if (!texts.every((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= MAX_SOURCE_TEXT)) {
      return res.status(400).json({ error: 'نص غير صالح في الدفعة / Invalid text in batch.' });
    }

    try {
      const translations = await translateBatch(
        f.providerType as string,
        f.apiKey as string,
        texts,
        f.targetLang as string,
        f.folderId
      );
      return res.json({ translations });
    } catch (error) {
      logProviderError('providers/translate-batch', error);
      return res.status(502).json({
        error: toUserMessage(error, 'فشلت الترجمة الجماعية / Batch translation failed.'),
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
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
