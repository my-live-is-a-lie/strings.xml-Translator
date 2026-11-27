import { describe, expect, it } from 'vitest';
import { testErrorText } from './testErrorText';
import type { ProviderTestResult } from '../../utils/translator';

const t = (key: string) => `<${key}>`;
const fail = (extra: Partial<ProviderTestResult>) => ({ success: false, ...extra }) as ProviderTestResult;

describe('testErrorText', () => {
  it.each([
    ['expired-key', 'provider_key_expired'],
    ['invalid-key', 'provider_key_invalid'],
    ['quota-exhausted', 'provider_quota_exhausted'],
    ['quota-or-limit', 'provider_quota_or_limit'],
    ['unreachable', 'provider_unreachable'],
    ['provider-error', 'provider_error'],
  ] as const)('%s uses %s, even when the provider sent raw text', (errorKind, key) => {
    expect(testErrorText(t, fail({ errorKind, error: 'raw provider text' }))).toBe(`<${key}>`);
  });

  it('a provider that does not categorize shows what it said', () => {
    expect(testErrorText(t, fail({ error: 'HTTP 418' }))).toBe('HTTP 418');
  });

  it('no category and no text falls back to the generic rejection line', () => {
    expect(testErrorText(t, fail({}))).toBe('<provider_key_rejected>');
  });

  it('the "unknown" category hides raw text behind the generic rejection line', () => {
    expect(testErrorText(t, fail({ errorKind: 'unknown', error: 'raw text' }))).toBe('<provider_key_rejected>');
  });
});
