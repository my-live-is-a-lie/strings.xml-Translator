/**
 * Provider key and quota errors in one place: the shared kind type, the Lara and Gemini classifiers,
 * and the Lara error class. The classifiers are moved here unchanged; the old modules re-export
 * them under their old names for now.
 */

/** What a provider error says about the user's key or account. */
export type ProviderKeyKind = 'expired-key' | 'invalid-key' | 'quota-exhausted' | 'quota-or-limit';

// ---------------------------------------------------------------- Lara

/**
 * Lara API errors, mapped to the key problems the app already shows on a provider card.
 *
 * The Lara SDK turns every non-2xx answer into an error with `statusCode`, `type` and `message`
 * taken from the server. Lara's docs promise typed errors for authentication, quota and validation
 * failures but do not publish the exact status or type for an exhausted quota, so this classifier
 * is deliberately wide for quota (UNVERIFIED against a real exhausted key):
 *   - 401, or 403 with no quota wording      -> invalid-key (an explicit auth error only)
 *   - 402, 429, or any other 4xx whose type/message talks about quota, credit, usage or limits
 *                                            -> quota-or-limit
 *   - anything else (timeouts, network, 5xx, plain validation errors) -> null, never "bad key"
 */
export type LaraKeyProblem = Extract<ProviderKeyKind, 'invalid-key' | 'quota-or-limit'>;

const QUOTA_WORDS =
  /quota|credit|insufficient|balance|usage|too many requests|rate.?limit|limit.{0,20}(reached|exceeded)|exceed|monthly/i;
const AUTH_WORDS = /unauthori[sz]ed|authenticat|forbidden|invalid.{0,12}(key|token|signature|credential)|credential/i;

export function classifyLaraError(err: unknown): LaraKeyProblem | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { statusCode?: unknown; type?: unknown; message?: unknown };
  if (typeof e.statusCode !== 'number') return null;
  const status = e.statusCode;
  if (status < 400 || status > 499) return null;
  const text = `${typeof e.type === 'string' ? e.type : ''} ${typeof e.message === 'string' ? e.message : ''}`;
  if (status === 401) return 'invalid-key';
  if (status === 402 || status === 429) return 'quota-or-limit';
  if (QUOTA_WORDS.test(text)) return 'quota-or-limit';
  if (status === 403 || AUTH_WORDS.test(text)) return 'invalid-key';
  return null;
}

/** A Lara failure that is definitely about the key or the account, not the text or the network. */
export class ProviderKeyError extends Error {
  readonly keyProblem: LaraKeyProblem;
  constructor(keyProblem: LaraKeyProblem) {
    super(
      keyProblem === 'quota-or-limit'
        ? 'Lara Translate: انتهت حصة الرصيد أو تم تجاوز حد الاستخدام / Credit quota exhausted or usage limit exceeded.'
        : 'Lara Translate: المفتاح غير صالح أو لا يملك الصلاحية المطلوبة / Invalid key or missing permission.'
    );
    this.name = 'ProviderKeyError';
    this.keyProblem = keyProblem;
  }
}

// ---------------------------------------------------------------- Gemini

/** Definite key/account problems the user must hear about, distinct from a plain rate limit. */
export type GeminiKeyProblem = Extract<ProviderKeyKind, 'expired-key' | 'invalid-key' | 'quota-exhausted'>;

/**
 * Maps a Gemini error to a definite key problem: an expired key (403 saying so), 401 and other
 * key-related 403s (invalid or restricted), and a 429 about daily quota or billing (exhausted
 * credit). A plain 429 (per-minute rate limit) and model-specific 403s are NOT key problems.
 */
export function classifyGeminiKeyProblem(status: number, message: string): GeminiKeyProblem | null {
  if (isModelUnavailableMessage(status, message)) return null;
  if (status === 401) return 'invalid-key';
  // Google's API_KEY_INVALID answer is a 400, not a 401.
  if (status === 400 && /api_?key_invalid|api key not valid|key not valid|invalid (api )?key/i.test(message)) {
    return 'invalid-key';
  }
  if (status === 403 && /key|permission|leaked|referer|ip address|disabled|expired/i.test(message)) {
    return /expired|renew/i.test(message) ? 'expired-key' : 'invalid-key';
  }
  if (status === 429) {
    // Model-scoped quota (per-model daily limit, e.g. limit 0 on the free tier) says something
    // about THIS model on this plan, not about the key: it is not a key problem.
    if (isModelQuotaMessage(status, message)) return null;
    // Only an explicit project/account metric blames the key. The generic "check your plan and
    // billing" wording is what a per-model limit-0 answers on some models (verified live: lite
    // models answer 200 for the same key in the same burst), so ambiguous 429s never blame the key.
    if (/per_?project|per_?account/i.test(message)) return 'quota-exhausted';
  }
  return null;
}

/**
 * True when a 429 is scoped to one model: either the metric names the model
 * ("generate_requests_per_model_per_day, limit: 0, model: gemini-3.1-pro") or the wording is the
 * generic plan/billing quota text, which Google also returns for per-model limit-0. A per-minute
 * variant is a plain rate limit and matches neither this nor the key problem.
 */
export function isModelQuotaMessage(status: number, message: string): boolean {
  return (
    status === 429 &&
    !/per_?minute/i.test(message) &&
    (/per_?model/i.test(message) ||
      /model:\s*\S+/i.test(message) ||
      /current quota|plan and billing|billing details/i.test(message))
  );
}

/** True when the API says this model can't be used (retired, unknown, or not for this key), not that the key is bad. */
export function isModelUnavailableMessage(status: number, message: string): boolean {
  if (status === 404) return true;
  return (
    (status === 400 || status === 403) &&
    /no longer available|not found|is not supported|not available to new users|deprecated/i.test(message)
  );
}
