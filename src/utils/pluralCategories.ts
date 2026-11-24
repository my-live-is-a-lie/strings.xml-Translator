/**
 * Plural categories per language, from CLDR through Intl.PluralRules.
 * Android codes such as `pt-rBR` are turned into BCP 47 first; a language the runtime has no
 * data for returns null so callers can fall back instead of guessing.
 */
export const PLURAL_CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export function toBcp47(locale: string): string {
  return locale.replace(/-r([A-Z]{2}|[0-9]{3})/, '-$1');
}

export function getCldrPluralCategories(
  locale: string,
  type: 'cardinal' | 'ordinal' = 'cardinal'
): string[] | null {
  try {
    const tag = toBcp47(locale);
    if (Intl.PluralRules.supportedLocalesOf([tag]).length === 0) return null;
    const found = new Intl.PluralRules(tag, { type }).resolvedOptions().pluralCategories as string[];
    return PLURAL_CATEGORY_ORDER.filter((c) => found.includes(c));
  } catch {
    return null;
  }
}

/** Example whole numbers (up to 100) that fall in each category, for a language-neutral hint. */
export function getPluralExamples(locale: string, type: 'cardinal' | 'ordinal' = 'cardinal'): Record<string, string> {
  const out: Record<string, number[]> = {};
  try {
    const rules = new Intl.PluralRules(toBcp47(locale), { type });
    for (let n = 0; n <= 100; n++) (out[rules.select(n)] ||= []).push(n);
  } catch {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [cat, nums] of Object.entries(out)) {
    result[cat] = nums.length <= 3 ? nums.join(', ') : `${nums.slice(0, 3).join(', ')}…`;
  }
  return result;
}
