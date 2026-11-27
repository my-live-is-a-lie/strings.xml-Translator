import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyLaraError, ProviderKeyError } from './providerErrors';

const apiError = (statusCode: number, type = 'UnknownError', message = 'x') => ({ statusCode, type, message });

describe('classifyLaraError', () => {
  it('401 and explicit auth wording are invalid-key', () => {
    expect(classifyLaraError(apiError(401))).toBe('invalid-key');
    expect(classifyLaraError(apiError(403, 'Forbidden', 'denied'))).toBe('invalid-key');
    expect(classifyLaraError(apiError(400, 'AuthenticationError', 'bad credentials'))).toBe('invalid-key');
  });
  it('a bare 429 and 402 are quota-or-limit', () => {
    expect(classifyLaraError(apiError(429))).toBe('quota-or-limit');
    expect(classifyLaraError(apiError(402))).toBe('quota-or-limit');
  });
  it('other 4xx with quota or limit wording are quota-or-limit', () => {
    expect(classifyLaraError(apiError(400, 'QuotaExceeded', 'monthly characters used up'))).toBe('quota-or-limit');
    expect(classifyLaraError(apiError(403, 'X', 'Usage limit exceeded'))).toBe('quota-or-limit');
  });
  it('validation errors, 5xx, timeouts and network errors are not key problems', () => {
    expect(classifyLaraError(apiError(400, 'ValidationError', 'bad target language'))).toBeNull();
    expect(classifyLaraError(apiError(500))).toBeNull();
    expect(classifyLaraError(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBeNull();
    expect(classifyLaraError(new TypeError('fetch failed'))).toBeNull();
    expect(classifyLaraError(null)).toBeNull();
  });
  it('the quota message covers both credit and usage limit', () => {
    const msg = new ProviderKeyError('quota-or-limit').message;
    expect(msg).toContain('انتهت حصة الرصيد أو تم تجاوز حد الاستخدام');
    expect(new ProviderKeyError('invalid-key').message).toContain('المفتاح غير صالح');
  });
});

let failWith: unknown = null;
let calls = 0;
const translate = async () => {
  calls += 1;
  throw failWith;
};
vi.mock('@translated/lara', () => ({
  AccessKey: class {},
  AuthToken: class {},
  Translator: class {
    translate = translate;
  },
}));

describe('server Lara call', () => {
  beforeEach(() => {
    calls = 0;
  });
  const call = async () => {
    const { callProviderWithKey } = await import('../../server/providers');
    return callProviderWithKey('lara', JSON.stringify({ id: 'a', secret: 'b' }), 'Hello', 'ar');
  };
  it('429 -> ProviderKeyError quota-or-limit, and no second paid retry', async () => {
    failWith = apiError(429, 'TooManyRequests', 'slow down');
    await expect(call()).rejects.toMatchObject({ keyProblem: 'quota-or-limit' });
    expect(calls).toBe(1);
  });
  it('401 -> invalid-key', async () => {
    failWith = apiError(401, 'Unauthorized', 'no');
    await expect(call()).rejects.toMatchObject({ keyProblem: 'invalid-key' });
  });
  it('timeout -> generic failure, not a key problem', async () => {
    failWith = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const err = await call().catch((e) => e);
    expect(err.keyProblem).toBeUndefined();
  });
});
