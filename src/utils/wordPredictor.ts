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
  /** The word is the last one of the stored translation (nothing follows it). */
  isLast: boolean;
}

const letterRuns = (text: string) => text.split(/[^\p{L}\p{M}]+/u).filter(Boolean);

/**
 * Next word after a finished one: the text ends with a space, its last word is in the stored translation,
 * so the stored word that follows it is offered (the typed words are aligned to the stored ones in order).
 */
function findNextWord(words: string[], text: string, skip: string[]): WordSuggestion | null {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed || trimmed === text || /[\r\n]$/.test(text)) return null;
  if (!/[\p{L}\p{M}]$/u.test(trimmed)) return null;
  const tokens = letterRuns(trimmed);
  let pointer = 0;
  let lastMatched = false;
  for (const tok of tokens) {
    const i = words.findIndex((w, idx) => idx >= pointer && w.toLowerCase() === tok.toLowerCase());
    lastMatched = i >= 0;
    if (i >= 0) pointer = i + 1;
  }
  if (!lastMatched) return null;
  const i = words.findIndex((w, idx) => idx >= pointer && !skip.includes(w));
  return i >= 0 ? { word: words[i], partial: '', suffix: words[i], isLast: i === words.length - 1 } : null;
}

/**
 * Completion for the text: the first stored word (in order) starting with the typed letters, or, right after
 * a finished word, the stored word that follows it. Rejected words are skipped.
 */
export function findSuggestion(words: string[] | undefined, text: string, skip: string[] = []): WordSuggestion | null {
  if (!words || words.length === 0) return null;
  const partial = currentPartial(text);
  if (!partial) return findNextWord(words, text, skip);
  const lower = partial.toLowerCase();
  // words already typed in this text are used up (one stored occurrence each), so they are not offered again
  const remaining = [...words];
  for (const tok of text.slice(0, text.length - partial.length).split(/[^\p{L}\p{M}]+/u)) {
    if (!tok) continue;
    const i = remaining.findIndex((w) => w.toLowerCase() === tok.toLowerCase());
    if (i >= 0) remaining.splice(i, 1);
  }
  const i = remaining.findIndex((w) => !skip.includes(w) && w.length > partial.length && w.toLowerCase().startsWith(lower));
  return i >= 0
    ? { word: remaining[i], partial, suffix: remaining[i].slice(partial.length), isLast: i === remaining.length - 1 }
    : null;
}
