import { getStoredItem, setStoredItem } from './storage';

const KEY = 'auto_correct_enabled_v1';

/** Auto-correction (punctuation, placeholders, tags, brackets) is on unless the user switched it off. */
export function getAutoCorrectEnabled(): boolean {
  try {
    return getStoredItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAutoCorrectEnabled(enabled: boolean): void {
  try {
    setStoredItem(KEY, enabled ? 'true' : 'false');
  } catch {
    /* best effort */
  }
}
