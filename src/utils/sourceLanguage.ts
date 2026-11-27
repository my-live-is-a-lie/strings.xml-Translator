import { normalizeSourceLang } from '../shared/sourceLang';
import type { ResourceItem } from '../types';

export interface SourceDetection {
  code: string;
  /** 'detected': the library was confident. 'unsure': too few strings or low confidence, English was kept. */
  status: 'detected' | 'unsure';
}

const MIN_USABLE_STRINGS = 5;
const MIN_ACCURACY = 0.4;
const MAX_TEXT_CHARS = 5000;

/** Plain text the detector can read: format tokens, tags, URLs, numbers and symbols are removed. */
export function usableDetectionText(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const cleaned = v
      .replace(/<[^>]*>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/%(?:\d+\$)?[sdfxXoeEgGcb]/g, ' ')
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\\[nrt'"]/g, ' ')
      .replace(/[\d_@#$&*+=~^|\\/[\]()<>:;,.!?¿¡"'`-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 2) out.push(cleaned);
  }
  return out;
}

export function collectSourceValues(items: ResourceItem[]): string[] {
  const values: string[] = [];
  for (const item of items) {
    if (item.type === 'string') values.push(item.source);
    else for (const sub of item.items) values.push(sub.source);
  }
  return values;
}

/**
 * Detects the language of the whole source file once, locally (no API call, no credit).
 * Per-string detection is unreliable on UI strings, so the strings are joined first.
 */
export async function detectSourceLanguage(items: ResourceItem[]): Promise<SourceDetection> {
  const usable = usableDetectionText(collectSourceValues(items));
  if (usable.length < MIN_USABLE_STRINGS) return { code: 'en', status: 'unsure' };
  try {
    const { detectAll } = await import('tinyld/light');
    const text = usable.join('\n').slice(0, MAX_TEXT_CHARS);
    const top = detectAll(text)[0];
    if (!top || top.accuracy < MIN_ACCURACY) return { code: 'en', status: 'unsure' };
    const code = normalizeSourceLang(top.lang);
    // normalizeSourceLang maps a language the app has no entry for to English, so a code that
    // changed here is one that cannot be shown or sent: keep English.
    if (code !== top.lang.split('-')[0]) {
      return { code: 'en', status: 'unsure' };
    }
    return { code, status: 'detected' };
  } catch {
    return { code: 'en', status: 'unsure' };
  }
}
