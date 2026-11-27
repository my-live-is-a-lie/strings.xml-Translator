import type { ProviderKeyKind } from '../../shared/providerErrors';

/** The UI string key that says what a key or quota problem means. One place for every card and test result. */
export const KEY_KIND_UI_KEY: Record<ProviderKeyKind, string> = {
  'expired-key': 'provider_key_expired',
  'invalid-key': 'provider_key_invalid',
  'quota-exhausted': 'provider_quota_exhausted',
  'quota-or-limit': 'provider_quota_or_limit',
};

/** UI string key for any failed key test kind, or undefined when the kind has no fixed wording. */
export function errorKindToUiKey(kind: string | undefined): string | undefined {
  if (kind === 'unreachable') return 'provider_unreachable';
  if (kind === 'provider-error') return 'provider_error';
  return kind !== undefined && Object.prototype.hasOwnProperty.call(KEY_KIND_UI_KEY, kind) ? KEY_KIND_UI_KEY[kind as ProviderKeyKind] : undefined;
}
