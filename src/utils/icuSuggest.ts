import { assembleIcuFields, getIcuFieldModel, setIcuClauseValue } from './placeholderCheck';
import type { IcuBlockField, IcuField } from './placeholderCheck';
import { ARABIC_PLURAL_GLOSSARY } from './glossary';

export type IcuQuantity = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
const NON_LATIN_TARGETS = new Set([
  'ar', 'fa', 'ur', 'he', 'ps', 'ku', 'ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'mn', 'el', 'hy', 'ka',
  'zh', 'ja', 'ko', 'hi', 'bn', 'th', 'ta', 'te', 'ml', 'kn', 'mr', 'gu', 'pa', 'ne', 'si', 'my', 'km', 'lo',
]);
const QUANTITIES: readonly string[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * A suggestion translates the clauses the SOURCE has (`=0`, `one`, `other`), so a target language
 * that uses more plural categories (Arabic: zero, two, few, many) gets those fields back empty.
 * This fills each empty category the editor added by translating the source's body for it.
 *
 * Every request carries the provider's fixed instructions, so asking once per category costs several
 * times the tokens of the text itself. The categories that share a source body are therefore sent
 * together, as ONE plural message holding only those clauses, through `translateMessage`; the reply
 * is read clause by clause. A category the reply leaves out or empty falls back to `translateBody`,
 * one request for that category with the category passed as the plural quantity. When the combined
 * request itself fails (rate or daily limit, network, an unreadable reply) nothing more is sent: a
 * user on a paid or limited API should not pay for four more requests right after one failed. The
 * categories stay empty (an empty added category is simply not saved) and Suggest can be run again.
 * One failed request never loses the rest of the suggestion.
 */
export async function fillAddedIcuClauses(
  source: string,
  suggestion: string,
  targetLocale: string,
  translateBody: (body: string, quantity: IcuQuantity) => Promise<string | null>,
  translateMessage?: (message: string) => Promise<string | null>
): Promise<string> {
  const model = getIcuFieldModel(source, suggestion, targetLocale);
  if (!model) return suggestion;
  const { fields, changed } = await fillFields(model, targetLocale, translateBody, translateMessage);
  return changed ? assembleIcuFields(fields) : suggestion;
}

/** Fills the added categories of every block in `fields`, including blocks nested in a clause body. */
async function fillFields(
  input: IcuField[],
  targetLocale: string,
  translateBody: (body: string, quantity: IcuQuantity) => Promise<string | null>,
  translateMessage?: (message: string) => Promise<string | null>
): Promise<{ fields: IcuField[]; changed: boolean }> {
  let model = input;
  let changed = false;
  for (let f = 0; f < model.length; f++) {
    const field = model[f];
    if (field.kind !== 'block') continue;
    // A clause whose body holds its own block (a plural inside a select): fill that block too
    for (let k = 0; k < field.clauses.length; k++) {
      const clause = field.clauses[k];
      if (!clause.children) continue;
      const inner = await fillFields(clause.children, targetLocale, translateBody, translateMessage);
      if (!inner.changed) continue;
      const updated = { ...clause, children: inner.fields, value: assembleIcuFields(inner.fields) };
      model = model.map((fl, i) =>
        i === f && fl.kind === 'block' ? { ...fl, clauses: fl.clauses.map((c, j) => (j === k ? updated : c)) } : fl
      );
      changed = true;
    }
    // An English ordinal suffix ("#st", "#nd", "#th") has no translation. For a non-Latin target the
    // suffix is dropped: every ordinal clause that is only "#" plus letters becomes a plain "#" (Arabic
    // has one ordinal form, so the same text serves all the source's forms). No request is sent.
    if (field.type === 'selectordinal' && NON_LATIN_TARGETS.has(targetLocale.split('-')[0].toLowerCase())) {
      for (let k = 0; k < field.clauses.length; k++) {
        const clause = field.clauses[k];
        if (clause.children || !/^#[A-Za-z]{1,3}$/.test(clause.sourceValue.trim()) || clause.value === '#') continue;
        model = setIcuClauseValue(model, f, k, '#');
        changed = true;
      }
    }
    const current = model[f] as IcuBlockField;
    const wanted: number[] = [];
    for (let k = 0; k < current.clauses.length; k++) {
      const clause = current.clauses[k];
      if (!clause.added || clause.value.trim() || !QUANTITIES.includes(clause.selector)) continue;
      wanted.push(k);
    }
    const filled = new Map<number, string>();
    const skipped = new Set<number>();
    // Arabic forms the built-in glossary already knows cost no request at all.
    if (targetLocale.split('-')[0].toLowerCase() === 'ar') {
      for (const k of wanted) {
        const hit = ARABIC_PLURAL_GLOSSARY[current.clauses[k].sourceValue.trim()]?.[current.clauses[k].selector as IcuQuantity];
        if (hit) filled.set(k, hit);
      }
    }
    const remaining = wanted.filter((k) => !filled.has(k));
    if (translateMessage && remaining.length > 1) {
      const together = await translateTogether(current, remaining, translateMessage);
      for (const [k, text] of together.filled) filled.set(k, text);
      for (const k of together.failed) skipped.add(k);
    }
    for (const k of wanted) {
      if (skipped.has(k)) continue;
      let text = filled.get(k) ?? null;
      if (!text) {
        const clause = current.clauses[k];
        try {
          text = await translateBody(clause.sourceValue, clause.selector as IcuQuantity);
        } catch {
          text = null;
        }
      }
      if (text && text.trim()) {
        model = setIcuClauseValue(model, f, k, text);
        changed = true;
      }
    }
  }
  return { fields: model, changed };
}

/** One request per distinct source body: the categories that share it go out as a single plural message. */
async function translateTogether(
  field: IcuBlockField,
  wanted: number[],
  translateMessage: (message: string) => Promise<string | null>
): Promise<{ filled: Map<number, string>; failed: number[] }> {
  const out = new Map<number, string>();
  const failed: number[] = [];
  const byBody = new Map<string, number[]>();
  for (const k of wanted) {
    const body = field.clauses[k].sourceValue;
    // A body with its own ICU block, or no words at all, keeps the one-request-per-category path.
    if (field.clauses[k].children || !body.trim()) continue;
    byBody.set(body, [...(byBody.get(body) ?? []), k]);
  }
  for (const [body, ks] of byBody) {
    if (ks.length < 2) continue;
    const selectors = ks.map((k) => field.clauses[k].selector);
    const message = `{n, ${field.type}, ${selectors.map((s) => `${s} {${body}}`).join(' ')} other {${body}}}`;
    try {
      const reply = await translateMessage(message);
      const parsed = reply ? getIcuFieldModel(message, reply)?.[0] : undefined;
      if (!parsed || parsed.kind !== 'block' || parsed.type !== field.type) {
        failed.push(...ks);
        continue;
      }
      for (const k of ks) {
        const clause = parsed.clauses.find((c) => c.selector === field.clauses[k].selector);
        if (clause && !clause.children && clause.value.trim()) out.set(k, clause.value);
      }
    } catch {
      failed.push(...ks);
    }
  }
  return { filled: out, failed };
}


/**
 * The plural forms a suggestion left without a translation, so the editor can say so instead of
 * leaving them silently empty: a category the target language adds that is still empty, and (for a
 * target written in a non-Latin script) a form that still holds its English source text, which is
 * what a failed request leaves behind. Returns the distinct selectors, in order.
 */
export function emptyAddedIcuCategories(source: string, text: string, targetLocale: string): string[] {
  const model = getIcuFieldModel(source, text, targetLocale);
  if (!model) return [];
  const nonLatin = NON_LATIN_TARGETS.has(targetLocale.split('-')[0].toLowerCase());
  const out: string[] = [];
  const visit = (fields: IcuField[]) => {
    for (const field of fields) {
      if (field.kind !== 'block') continue;
      for (const clause of field.clauses) {
        if (clause.children) visit(clause.children);
        if (!QUANTITIES.includes(clause.selector) || out.includes(clause.selector)) continue;
        const value = clause.value.trim();
        const empty = clause.added && !value;
        const keptSource = nonLatin && !clause.children && value !== '' && value === clause.sourceValue.trim() && /[A-Za-z]{2,}/.test(value);
        if (empty || keptSource) out.push(clause.selector);
      }
    }
  };
  visit(model);
  return out;
}
