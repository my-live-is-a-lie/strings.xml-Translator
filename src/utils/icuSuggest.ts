import { assembleIcuFields, getIcuFieldModel, setIcuClauseValue } from './placeholderCheck';

export type IcuQuantity = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
const QUANTITIES: readonly string[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * A suggestion translates the clauses the SOURCE has (`=0`, `one`, `other`), so a target language
 * that uses more plural categories (Arabic: zero, two, few, many) gets those fields back empty.
 * This fills each empty category the editor added by translating the source's body for it, with the
 * category passed as the plural quantity so the engine can inflect it. A body that cannot be
 * translated stays empty (an empty added category is simply not saved).
 */
export async function fillAddedIcuClauses(
  source: string,
  suggestion: string,
  targetLocale: string,
  translateBody: (body: string, quantity: IcuQuantity) => Promise<string | null>
): Promise<string> {
  let model = getIcuFieldModel(source, suggestion, targetLocale);
  if (!model) return suggestion;
  let changed = false;
  for (let f = 0; f < model.length; f++) {
    const field = model[f];
    if (field.kind !== 'block') continue;
    for (let k = 0; k < field.clauses.length; k++) {
      const clause = field.clauses[k];
      if (!clause.added || clause.value.trim() || !QUANTITIES.includes(clause.selector)) continue;
      const text = await translateBody(clause.sourceValue, clause.selector as IcuQuantity);
      if (text && text.trim()) {
        model = setIcuClauseValue(model, f, k, text);
        changed = true;
      }
    }
  }
  return changed ? assembleIcuFields(model) : suggestion;
}
