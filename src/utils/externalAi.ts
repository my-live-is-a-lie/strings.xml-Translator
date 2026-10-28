import { ArrayStringItem, PluralStringItem, ResourceItem, SingleStringItem } from '../types';
import { normalizePluralsForLanguage } from './xmlParser';
import { validatePlaceholders } from './placeholderCheck';

// "External AI" flow: the strings are exported as JSON (+ a ready prompt), the user runs them through any AI app
// (ChatGPT, Gemini, Claude...), pastes or uploads the reply, and it is validated before anything is applied.

export interface Segment {
  id: number; // short number the AI must echo back
  key: string; // resource name, plural quantity or array index (context for the AI)
  text: string; // English source
  itemId: string;
  part: { kind: 'string' } | { kind: 'plural'; quantity: string } | { kind: 'array'; index: number };
}

/** Flattens strings, plurals and arrays into numbered segments (plurals follow the target language's quantities). */
export function buildSegments(items: ResourceItem[], targetLang: string): Segment[] {
  const out: Segment[] = [];
  let id = 1;
  for (const item of normalizePluralsForLanguage(items, targetLang)) {
    if (item.type === 'string') {
      out.push({ id: id++, key: item.name, text: item.source, itemId: item.id, part: { kind: 'string' } });
    } else if (item.type === 'plural') {
      for (const q of item.items) {
        out.push({ id: id++, key: `${item.name}#${q.quantity}`, text: q.source, itemId: item.id, part: { kind: 'plural', quantity: q.quantity } });
      }
    } else {
      for (const e of item.items) {
        out.push({ id: id++, key: `${item.name}[${e.index}]`, text: e.source, itemId: item.id, part: { kind: 'array', index: e.index } });
      }
    }
  }
  return out;
}

/** Splits into parts of at most `size` segments; size <= 0 keeps everything in one part. */
export function splitParts<T>(list: T[], size: number): T[][] {
  if (size <= 0 || list.length <= size) return [list];
  const parts: T[][] = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts;
}

export function requestJson(segments: Segment[], targetLangLabel: string): string {
  return JSON.stringify(
    { target_language: targetLangLabel, strings: segments.map((s) => ({ id: s.id, key: s.key, text: s.text })) },
    null,
    2
  );
}

/** The prompt that goes with the request. `file` = the JSON is attached, `text` = the JSON follows in the message. */
export function buildPrompt(targetLangLabel: string, mode: 'file' | 'text', glossary: Array<[string, string]> = []): string {
  const terms = glossary.length ? `\nUse these fixed translations for these terms:\n${glossary.map(([a, b]) => `- ${a} = ${b}`).join('\n')}\n` : '';
  return `You are a professional translator for Android app strings (strings.xml).
Translate every "text" value from English to ${targetLangLabel}.

Rules:
1. Reply with ONLY valid JSON, no explanations, no markdown, in exactly this shape: {"translations":[{"id":1,"text":"..."}]}
2. Return one entry for EVERY id, with the same id number. Never skip, merge, reorder or invent ids.
3. Keep placeholders and markup exactly as they are: %s, %d, %1$s, %2$d, {name}, \\n, \\', HTML tags such as <b>…</b>, and any XML entities.
4. Do not translate the "key" field, brand names, or code. Keep the tone short and natural for an app UI.
5. Translate the text yourself. Do not write code or use a script to translate.
6. Do not shorten the list: if the answer is long, still include every id.
${terms}
${mode === 'file' ? 'The strings are in the attached JSON file. Reply with the translated JSON (as a downloadable .json file if you can, otherwise as plain text).' : 'The strings follow below:'}`;
}

export function buildTextRequest(prompt: string, json: string): string {
  return `${prompt}\n\n${json}`;
}

/** Reads the AI's reply: tolerates code fences and text around the JSON, arrays, and {"1":"..."} maps. */
export function parseReply(raw: string): Map<number, string> {
  let text = raw.trim().replace(/^\uFEFF/, '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) text = fenced[1].trim();
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end <= start) throw new Error('NO_JSON');
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('BAD_JSON');
  }
  const out = new Map<number, string>();
  const put = (id: unknown, value: unknown) => {
    const n = Number(id);
    if (Number.isInteger(n) && typeof value === 'string') out.set(n, value);
  };
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { translations?: unknown }).translations)
      ? ((data as { translations: unknown[] }).translations)
      : null;
  if (list) {
    for (const entry of list) {
      if (entry && typeof entry === 'object') put((entry as { id?: unknown }).id, (entry as { text?: unknown }).text ?? (entry as { translation?: unknown }).translation);
    }
  } else if (data && typeof data === 'object') {
    const map = (data as { translations?: unknown }).translations ?? data;
    for (const [k, v] of Object.entries(map as Record<string, unknown>)) put(k, v);
  }
  if (out.size === 0) throw new Error('EMPTY');
  return out;
}

export type IssueKind = 'missing' | 'placeholder' | 'same' | 'empty';

export interface Checked {
  segment: Segment;
  text: string; // '' when missing
  issues: IssueKind[];
}

/** Compares the reply with what was asked: missing ids, lost placeholders/tags, untranslated or empty answers. */
export function checkReply(segments: Segment[], reply: Map<number, string>): { rows: Checked[]; unknownIds: number[] } {
  const known = new Set(segments.map((s) => s.id));
  const rows = segments.map((segment): Checked => {
    if (!reply.has(segment.id)) return { segment, text: '', issues: ['missing'] };
    const text = reply.get(segment.id) as string;
    const issues: IssueKind[] = [];
    if (!text.trim()) issues.push('empty');
    else {
      if (!validatePlaceholders(segment.text, text).valid) issues.push('placeholder');
      if (text.trim() === segment.text.trim() && /[A-Za-z]{3,}/.test(segment.text)) issues.push('same');
    }
    return { segment, text, issues };
  });
  return { rows, unknownIds: [...reply.keys()].filter((id) => !known.has(id)) };
}

/** Writes the accepted translations into copies of the items. Strings with only some parts answered stay as they were. */
export function applyTranslations(items: ResourceItem[], targetLang: string, accepted: Checked[]): ResourceItem[] {
  const byItem = new Map<string, Checked[]>();
  for (const row of accepted) {
    if (!row.text.trim()) continue;
    byItem.set(row.segment.itemId, [...(byItem.get(row.segment.itemId) ?? []), row]);
  }
  const out: ResourceItem[] = [];
  for (const item of normalizePluralsForLanguage(items, targetLang)) {
    const rows = byItem.get(item.id);
    if (!rows) continue;
    const meta = { translationSource: 'ai' as const, translationEngine: 'external-ai' };
    if (item.type === 'string') {
      out.push({ ...(item as SingleStringItem), target: rows[0].text, status: 'translated', ...meta });
    } else if (item.type === 'plural') {
      const byQ = new Map(rows.map((r) => [(r.segment.part as { quantity: string }).quantity, r.text]));
      const next = (item as PluralStringItem).items.map((q) => ({ ...q, target: byQ.get(q.quantity) ?? q.target }));
      out.push({ ...(item as PluralStringItem), items: next, status: next.every((q) => q.target.trim()) ? 'translated' : item.status, ...meta });
    } else {
      const byI = new Map(rows.map((r) => [(r.segment.part as { index: number }).index, r.text]));
      const next = (item as ArrayStringItem).items.map((e) => ({ ...e, target: byI.get(e.index) ?? e.target }));
      out.push({ ...(item as ArrayStringItem), items: next, status: next.every((e) => e.target.trim()) ? 'translated' : item.status, ...meta });
    }
  }
  return out;
}
