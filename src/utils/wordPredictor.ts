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

/** Distinct words of a translated text in order of appearance (placeholders and tags are ignored). */
export function extractWords(text: string): string[] {
  const clean = text.replace(/%(?:\d+\$)?[+-]?\d*(?:\.\d+)?[a-zA-Z]|\{[^}]*\}|<[^>]+>|&[a-zA-Z#0-9]+;/g, ' ');
  const out: string[] = [];
  for (const w of clean.split(/[^\p{L}\p{M}]+/u)) {
    if (w.length >= 2 && !out.includes(w)) out.push(w);
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
  const word = words.find((w) => !skip.includes(w) && w.length > partial.length && w.toLowerCase().startsWith(lower));
  return word ? { word, partial, suffix: word.slice(partial.length) } : null;
}
