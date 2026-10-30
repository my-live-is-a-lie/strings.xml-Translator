import { getStoredItem, setStoredItem } from './storage';

const KEY = 'predictive_words_v1';

export function getPredictiveWordsEnabled(): boolean {
  try {
    return getStoredItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setPredictiveWordsEnabled(enabled: boolean): void {
  try {
    setStoredItem(KEY, enabled ? 'true' : 'false');
  } catch {
    /* best effort */
  }
}

/** Words of a translated text in order of appearance (placeholders and tags are ignored). */
export function extractWords(text: string): string[] {
  const clean = text.replace(/%(?:\d+\$)?[+-]?\d*(?:\.\d+)?[a-zA-Z]|\{[^}]*\}|<[^>]+>|&[a-zA-Z#0-9]+;/g, ' ');
  const out: string[] = [];
  for (const w of clean.split(/[^\p{L}\p{M}]+/u)) {
    if (w.length >= 2) out.push(w);
  }
  return out;
}

/** The letters being typed at the end of the text (nothing when the text ends with a space or symbol). */
export function currentPartial(text: string): string {
  return text.match(/[\p{L}\p{M}]+$/u)?.[0] ?? '';
}

export interface WordSuggestion {
  word: string;
  partial: string;
  suffix: string;
}

/** First stored word (in order) that starts with the typed letters, skipping rejected ones. */
export function findSuggestion(words: string[] | undefined, text: string, skip: string[] = []): WordSuggestion | null {
  if (!words || words.length === 0) return null;
  const partial = currentPartial(text);
  if (!partial) return null;
  const lower = partial.toLowerCase();
  // words already typed in this text are used up (one stored occurrence each), so they are not offered again
  const remaining = [...words];
  for (const tok of text.slice(0, text.length - partial.length).split(/[^\p{L}\p{M}]+/u)) {
    if (!tok) continue;
    const i = remaining.findIndex((w) => w.toLowerCase() === tok.toLowerCase());
    if (i >= 0) remaining.splice(i, 1);
  }
  const word = remaining.find((w) => !skip.includes(w) && w.length > partial.length && w.toLowerCase().startsWith(lower));
  return word ? { word, partial, suffix: word.slice(partial.length) } : null;
}
