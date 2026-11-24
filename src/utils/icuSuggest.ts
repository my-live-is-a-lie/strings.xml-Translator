import { assembleIcuFields, getIcuFieldModel, setIcuClauseValue } from './placeholderCheck';
import type { IcuBlockField } from './placeholderCheck';
import { ARABIC_PLURAL_GLOSSARY } from './glossary';

export type IcuQuantity = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
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
  let model = getIcuFieldModel(source, suggestion, targetLocale);
  if (!model) return suggestion;
  let changed = false;
  for (let f = 0; f < model.length; f++) {
    const field = model[f];
    if (field.kind !== 'block') continue;
    const wanted: number[] = [];
    for (let k = 0; k < field.clauses.length; k++) {
      const clause = field.clauses[k];
      if (!clause.added || clause.value.trim() || !QUANTITIES.includes(clause.selector)) continue;
      wanted.push(k);
    }
    const filled = new Map<number, string>();
    const skipped = new Set<number>();
    // Arabic forms the built-in glossary already knows cost no request at all.
    if (targetLocale.split('-')[0].toLowerCase() === 'ar') {
      for (const k of wanted) {
        const hit = ARABIC_PLURAL_GLOSSARY[field.clauses[k].sourceValue.trim()]?.[field.clauses[k].selector as IcuQuantity];
        if (hit) filled.set(k, hit);
      }
    }
    const remaining = wanted.filter((k) => !filled.has(k));
    if (translateMessage && remaining.length > 1) {
      const together = await translateTogether(field, remaining, translateMessage);
      for (const [k, text] of together.filled) filled.set(k, text);
      for (const k of together.failed) skipped.add(k);
    }
    for (const k of wanted) {
      if (skipped.has(k)) continue;
      let text = filled.get(k) ?? null;
      if (!text) {
        const clause = field.clauses[k];
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
  return changed ? assembleIcuFields(model) : suggestion;
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
