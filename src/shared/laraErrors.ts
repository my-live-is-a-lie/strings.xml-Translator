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
export type LaraKeyProblem = 'invalid-key' | 'quota-or-limit';

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
