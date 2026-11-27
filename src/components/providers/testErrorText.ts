import type { ProviderTestResult } from '../../utils/translator';

type Translate = (key: string, ...args: string[]) => string;

/** The app's Arabic copy for a failed key test. */
export function testErrorText(t: Translate, result: ProviderTestResult): string {
  switch (result.errorKind) {
    case 'expired-key':
      return t('provider_key_expired');
    case 'invalid-key':
      return t('provider_key_invalid');
    case 'quota-exhausted':
      return t('provider_quota_exhausted');
    case 'quota-or-limit':
      return t('provider_quota_or_limit');
    case 'unreachable':
      return t('provider_unreachable');
    case 'provider-error':
      return t('provider_error');
    default:
      // Gemini always sets errorKind, so its raw messages (mixed language, about a model) never
      // reach here. Other providers do not categorize: show what they actually said (HTTP status,
      // "folder ID required", ...) instead of hiding it behind a generic line.
      if (result.errorKind === undefined && result.error) return result.error;
      return t('provider_key_rejected');
  }
}
