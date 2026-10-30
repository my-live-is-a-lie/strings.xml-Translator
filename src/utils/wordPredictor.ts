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

const LEAD_PUNCT = /^[^\p{L}\p{N}%{<]+/u;
const TRAIL_PUNCT = /[^\p{L}\p{N}}>]+$/u;

/** A token without the punctuation around it ("\\"%1$s\\"؟" -> "%1$s", "(hello)," -> "hello"). */
const coreOf = (token: string) => token.replace(LEAD_PUNCT, '').replace(TRAIL_PUNCT, '').toLowerCase();

/**
 * Tokens of a translated text in order of appearance, exactly as written: words with the punctuation attached
 * to them, placeholders (%1$s) and tags. Tokens made only of symbols are dropped.
 */
export function extractWords(text: string): string[] {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}%{<]/u.test(t));
}

/** What is being typed at the end of the text: everything after the last space (empty after a space). */
export function currentPartial(text: string): string {
  return text.match(/\S+$/u)?.[0] ?? '';
}

export interface WordSuggestion {
  word: string;
  partial: string;
  suffix: string;
  /** The word is the last one of the stored translation (nothing follows it). */
  isLast: boolean;
}

const sameToken = (a: string, b: string) => {
  const ca = coreOf(a);
  return a.toLowerCase() === b.toLowerCase() || (ca !== '' && ca === coreOf(b));
};

/**
 * Next word after a finished one: the text ends with a space and its last word is in the stored translation,
 * so the stored token that follows it is offered (typed words are aligned to the stored ones in order).
 */
function findNextWord(words: string[], text: string, skip: string[]): WordSuggestion | null {
  if (/[\r\n]$/.test(text)) return null;
  const typed = text.split(/\s+/).filter(Boolean);
  if (typed.length === 0) return null;
  let pointer = 0;
  let lastMatched = false;
  for (const tok of typed) {
    const i = words.findIndex((w, idx) => idx >= pointer && sameToken(w, tok));
    lastMatched = i >= 0;
    if (i >= 0) pointer = i + 1;
  }
  if (!lastMatched) return null;
  const i = words.findIndex((w, idx) => idx >= pointer && !skip.includes(w));
  return i >= 0 ? { word: words[i], partial: '', suffix: words[i], isLast: i === words.length - 1 } : null;
}

/**
 * Completion for the text: the first stored token (in order) starting with what was typed, or, right after
 * a finished word, the stored token that follows it. Tokens already used in the text and rejected ones are skipped.
 */
export function findSuggestion(words: string[] | undefined, text: string, skip: string[] = []): WordSuggestion | null {
  if (!words || words.length === 0) return null;
  const partial = currentPartial(text);
  if (!partial) return findNextWord(words, text, skip);
  const lower = partial.toLowerCase();
  const pCore = partial.replace(LEAD_PUNCT, '').toLowerCase();
  // typed tokens are used up (one stored occurrence each), so they are not offered again
  const remaining = [...words];
  for (const tok of text.slice(0, text.length - partial.length).split(/\s+/)) {
    if (!tok) continue;
    const i = remaining.findIndex((w) => sameToken(w, tok));
    if (i >= 0) remaining.splice(i, 1);
  }
  for (let i = 0; i < remaining.length; i++) {
    const w = remaining[i];
    if (skip.includes(w)) continue;
    const isLast = i === remaining.length - 1;
    if (w.length > partial.length && w.toLowerCase().startsWith(lower)) {
      return { word: w, partial, suffix: w.slice(partial.length), isLast };
    }
    // typed without the punctuation the stored token starts with: complete the word only
    const lead = w.length - w.replace(LEAD_PUNCT, '').length;
    if (lead > 0 && pCore && !LEAD_PUNCT.test(partial)) {
      const body = w.slice(lead);
      if (body.length > pCore.length && body.toLowerCase().startsWith(pCore)) {
        return { word: w, partial, suffix: body.slice(pCore.length).replace(TRAIL_PUNCT, ''), isLast };
      }
    }
  }
  return null;
}
