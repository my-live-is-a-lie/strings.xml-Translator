import { useCallback, useEffect, useRef, useState } from 'react';
import { suggestTranslation } from '../utils/translator';
import { currentPartial, extractWords, findSuggestion } from '../utils/wordPredictor';

export interface PredictField {
  key: string;
  source: string;
  quantity?: 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
}

// Machine translations are stored per source text, so moving between strings never asks twice
const translationCache = new Map<string, Promise<string>>();

function translateOnce(field: PredictField, targetLang: string, targetLocaleName?: string): Promise<string> {
  const cacheKey = `${targetLang}|${field.quantity ?? ''}|${field.source}`;
  let p = translationCache.get(cacheKey);
  if (!p) {
    p = suggestTranslation(field.source, targetLang, targetLocaleName, field.quantity)
      .then((r) => r.text || '')
      .catch(() => {
        translationCache.delete(cacheKey);
        return '';
      });
    translationCache.set(cacheKey, p);
  }
  return p;
}

interface Rejected {
  field: string;
  prefix: string;
  skip: string[];
}

/**
 * Word completion while typing: on the first edit of a field its source text is translated by the service, its words are stored in order,
 * and the first stored word starting with the typed letters is shown (grey) as a completion.
 * Space accepts it (+ one space); Backspace rejects it and offers the next matching stored word.
 */
export function usePredictiveWords(opts: {
  enabled: boolean;
  resetKey: string;
  fields: PredictField[];
  targetLang: string;
  targetLocaleName?: string;
}) {
  const { enabled, resetKey, fields, targetLang, targetLocaleName } = opts;
  const [words, setWords] = useState<Record<string, string[]>>({});
  const [ctx, setCtx] = useState<{ field: string; atEnd: boolean } | null>(null);
  const [rejected, setRejected] = useState<Rejected | null>(null);
  const wordsRef = useRef(words);
  const rejectedRef = useRef<Rejected | null>(null);
  const fieldsRef = useRef(fields);
  // refs are kept in sync after each render; event handlers read them
  useEffect(() => {
    wordsRef.current = words;
    rejectedRef.current = rejected;
    fieldsRef.current = fields;
  });
  const fieldsSignature = fields.map((f) => `${f.key}:${f.quantity ?? ''}:${f.source}`).join('\u0001');

  // Nothing is requested while the user only browses strings: a field is translated on its first edit
  const requestedRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(0);

  // Everything is reset when the string, language or setting changes (state reset during render, no effect needed)
  const resetToken = `${enabled}|${resetKey}|${fieldsSignature}|${targetLang}|${targetLocaleName ?? ''}`;
  const [seenToken, setSeenToken] = useState(resetToken);
  if (seenToken !== resetToken) {
    setSeenToken(resetToken);
    setWords({});
    setRejected(null);
  }
  useEffect(() => {
    generationRef.current++;
    requestedRef.current = new Set();
  }, [resetToken]);

  const ensureWords = (key: string) => {
    if (requestedRef.current.has(key)) return;
    const f = fieldsRef.current.find((x) => x.key === key);
    if (!f || !f.source.trim()) return;
    requestedRef.current.add(key);
    const generation = generationRef.current;
    translateOnce(f, targetLang, targetLocaleName).then((text) => {
      if (generation !== generationRef.current || !text) return;
      setWords((prev) => ({ ...prev, [key]: extractWords(text) }));
    });
  };

  const skipFor = (r: Rejected | null, key: string, text: string) =>
    r && r.field === key && r.prefix === currentPartial(text) ? r.skip : [];

  /** Grey completion to show after the text of a field (empty when there is none). */
  const ghostFor = (key: string, text: string): string => {
    if (!enabled || !ctx || ctx.field !== key || !ctx.atEnd) return '';
    return findSuggestion(words[key], text, skipFor(rejected, key, text))?.suffix ?? '';
  };

  const noteCursor = useCallback((key: string, el: HTMLTextAreaElement | null) => {
    if (!el) return;
    const len = el.value.length;
    const atEnd = el.selectionStart === len && el.selectionEnd === len;
    setCtx((c) => (c && c.field === key && c.atEnd === atEnd ? c : { field: key, atEnd }));
  }, []);

  const clearCursor = useCallback(() => setCtx(null), []);

  /**
   * Called with the text before and after an edit. Returns the text to use instead when the edit
   * accepted (space) or rejected (backspace) a completion, otherwise null.
   */
  const handleChange = (key: string, prev: string, next: string): string | null => {
    if (!enabled) return null;
    ensureWords(key);
    const list = wordsRef.current[key];
    if (!list || list.length === 0) return null;
    const skip = skipFor(rejectedRef.current, key, prev);
    if (next === prev + ' ') {
      const s = findSuggestion(list, prev, skip);
      if (s) {
        setRejected(null);
        // no trailing space after the last stored word, nor after a one-word source's completion
        const oneWord = (fieldsRef.current.find((f) => f.key === key)?.source.trim().split(/\s+/).length ?? 2) === 1;
        return prev + s.suffix + (oneWord || s.isLast ? '' : ' ');
      }
    } else if (next.length === prev.length - 1 && prev.startsWith(next)) {
      const s = findSuggestion(list, prev, skip);
      if (s) {
        setRejected({ field: key, prefix: s.partial, skip: [...skip, s.word] });
        return prev; // the typed letters stay, only the suggestion is dropped
      }
    }
    if (rejectedRef.current) setRejected(null);
    return null;
  };

  return { ghostFor, noteCursor, clearCursor, handleChange };
}
