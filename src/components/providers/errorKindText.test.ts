import { describe, expect, it } from 'vitest';
import { errorKindToUiKey, KEY_KIND_UI_KEY } from './errorKindText';

describe('errorKindToUiKey', () => {
  it('maps every key problem kind and the two transport kinds', () => {
    expect(errorKindToUiKey('expired-key')).toBe('provider_key_expired');
    expect(errorKindToUiKey('invalid-key')).toBe('provider_key_invalid');
    expect(errorKindToUiKey('quota-exhausted')).toBe('provider_quota_exhausted');
    expect(errorKindToUiKey('quota-or-limit')).toBe('provider_quota_or_limit');
    expect(errorKindToUiKey('unreachable')).toBe('provider_unreachable');
    expect(errorKindToUiKey('provider-error')).toBe('provider_error');
  });
  it('has no fixed wording for unknown or missing kinds', () => {
    expect(errorKindToUiKey('unknown')).toBeUndefined();
    expect(errorKindToUiKey(undefined)).toBeUndefined();
    expect(errorKindToUiKey('toString')).toBeUndefined();
  });
  it('the card table has one entry per key problem kind', () => {
    expect(Object.keys(KEY_KIND_UI_KEY).sort()).toEqual(['expired-key', 'invalid-key', 'quota-exhausted', 'quota-or-limit']);
  });
});
