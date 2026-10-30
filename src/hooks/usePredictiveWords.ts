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
 * Word completion while typing: the source text is translated by the service, its words are stored in order,
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
  wordsRef.current = words;
  rejectedRef.current = rejected;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const fieldsSignature = fields.map((f) => `${f.key}:${f.quantity ?? ''}:${f.source}`).join('\u0001');

  useEffect(() => {
    setWords({});
    setRejected(null);
    if (!enabled) return;
    let cancelled = false;
    for (const f of fieldsRef.current) {
      if (!f.source.trim()) continue;
      translateOnce(f, targetLang, targetLocaleName).then((text) => {
        if (cancelled || !text) return;
        setWords((prev) => ({ ...prev, [f.key]: extractWords(text) }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [enabled, resetKey, fieldsSignature, targetLang, targetLocaleName]);

  const skipFor = (key: string, text: string) => {
    const r = rejectedRef.current;
    return r && r.field === key && r.prefix === currentPartial(text) ? r.skip : [];
  };

  /** Grey completion to show after the text of a field (empty when there is none). */
  const ghostFor = (key: string, text: string): string => {
    if (!enabled || !ctx || ctx.field !== key || !ctx.atEnd) return '';
    return findSuggestion(words[key], text, skipFor(key, text))?.suffix ?? '';
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
    const list = wordsRef.current[key];
    if (!list || list.length === 0) return null;
    const skip = skipFor(key, prev);
    if (next === prev + ' ') {
      const s = findSuggestion(list, prev, skip);
      if (s) {
        setRejected(null);
        return prev + s.suffix + ' ';
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
