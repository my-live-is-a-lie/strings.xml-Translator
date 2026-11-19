import { ResourceItem } from '../types';
import { countLineBreaks } from './newlines';

// ICU MessageFormat argument types that carry sub-message clauses in braces
// (e.g. `{count, plural, one {...} other {...}}`). Other ICU types such as
// `number`, `date`, `time`, `duration`, `spellout` and `ordinal` only take a
// simple style keyword with no nested braces, so they don't need clause parsing.
const ICU_PLURAL_LIKE_FORMAT_TYPES = new Set(['plural', 'selectordinal']);
const ICU_CLAUSE_FORMAT_TYPES = new Set(['plural', 'select', 'selectordinal']);

// Every format type ICU MessageFormat accepts. A `{word, word}` pair whose
// second word is not one of these is not an ICU argument at all (e.g. plain
// text such as `{red, green}`), so it must not yield a `{word}` placeholder.
const ICU_FORMAT_TYPES = new Set([
  'number',
  'date',
  'time',
  'plural',
  'select',
  'selectordinal',
  'ordinal',
  'duration',
  'spellout',
]);

// Plural category keywords. `other` is required by every locale, so it stays
// in the strict source/target comparison; the rest depend on the target
// language (CLDR) and are checked against that language instead of against
// the source language.
const ICU_LOCALE_PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many']);

// Bidirectional control characters (U+200E/U+200F and the explicit embedding
// and isolate marks). Arabic keyboards and editors insert them around
// identifiers, and `String.trim()` does not remove them, so they would break
// the identifier checks below. Strip them from identifiers only, never from
// the translatable sub-message text.
const BIDI_CONTROL_CHARS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROL_CHARS, '');
}

/**
 * ICU MessageFormat apostrophe quoting (DOUBLE_OPTIONAL mode, the default):
 * a single `'` starts a quoted literal only when followed by a syntax
 * character (`{`, `}`, `|`, `#`). An apostrophe inside a word (e.g. `it's`,
 * `don't`) is a literal apostrophe, not a quote boundary. `''` is an escaped
 * apostrophe (a literal `'`). Returns the index just past the quoted
 * construct when one starts at `text[i]`, or -1 when the `'` there is a
 * plain apostrophe. Used by both the brace-balance check and the parser so
 * the two agree on what is literal text and what is structure.
 */
function skipQuotedLiteral(text: string, i: number): number {
  if (text[i] !== "'") return -1;
  const next = text[i + 1];
  if (next === "'") return i + 2; // escaped apostrophe: a literal `'`
  if (next !== '{' && next !== '}' && next !== '|' && next !== '#') return -1;
  // Scan for the closing quote, skipping `''` escapes inside it.
  let j = i + 2;
  while (j < text.length) {
    if (text[j] === "'") {
      if (text[j + 1] === "'") {
        j += 2;
        continue;
      }
      return j + 1; // closing quote
    }
    j++;
  }
  return -1; // unclosed quote: not a quoted literal, fall back to counting
}

/**
 * Finds the index of the closing brace that matches the opening brace at
 * `openIndex`, counting nested `{`/`}` pairs so ICU MessageFormat blocks like
 * `{count, plural, one {# book} other {# books}}` are matched correctly
 * instead of stopping at the first `}` found. Braces inside an ICU quoted
 * literal (`'...'`) are literal text, so they are skipped.
 */
function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      const after = skipQuotedLiteral(text, i);
      if (after !== -1) {
        i = after;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Walks `text` and extracts placeholder-like tokens, correctly handling
 * nested/balanced braces for ICU MessageFormat syntax
 * (`{var, plural|select|selectordinal, ...}`) so the reserved ICU keywords
 * (plural/select/selectordinal, one/few/many/other/zero/two, male/female,
 * `=0`/`=1`, `offset:N`) and the variable name are recognized as tokens that
 * must be preserved, while the translatable sub-message text inside each
 * clause is left alone (and recursed into, in case it nests further
 * placeholders or ICU blocks). Plain `{0}` / `{username}`-style placeholders
 * are still matched as before. `#` is only treated as a token while inside a
 * plural/selectordinal clause's own sub-message, where ICU replaces it with
 * the formatted number. ICU `'...'` quoted literals are skipped, so a brace
 * inside them is literal text, not structure.
 */
function extractBraceTokens(text: string, inPluralClause: boolean): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      const after = skipQuotedLiteral(text, i);
      if (after !== -1) {
        i = after;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{') {
      const close = findMatchingBrace(text, i);
      if (close === -1) {
        // Unbalanced brace - nothing more we can safely parse from here.
        i++;
        continue;
      }
      const inner = text.slice(i + 1, close);
      const commaIdx = inner.indexOf(',');
      if (commaIdx !== -1) {
        const argName = stripBidiControls(inner.slice(0, commaIdx).trim());
        const rest = inner.slice(commaIdx + 1);
        const nextCommaIdx = rest.indexOf(',');
        const formatType = stripBidiControls(
          (nextCommaIdx !== -1 ? rest.slice(0, nextCommaIdx) : rest).trim()
        );

        if (/^[a-zA-Z0-9_-]+$/.test(argName) && ICU_FORMAT_TYPES.has(formatType)) {
          // The variable name and the format type are one token (`{name:type}`),
          // not two independent ones: swapping the types between two variables
          // (`{price, number} {when, date}` → `{price, date} {when, number}`)
          // must be reported, and the flat token sets would otherwise be
          // identical. (The style itself, e.g. `::currency/USD` vs `short`,
          // is not compared.)
          tokens.push(`{${argName}:${formatType}}`);

          if (ICU_CLAUSE_FORMAT_TYPES.has(formatType)) {
            const styleAndClauses = nextCommaIdx !== -1 ? rest.slice(nextCommaIdx + 1) : '';

            // `offset` is only valid at the very start of the clauses (before
            // the first selector keyword). Matching it anywhere in the text
            // would also catch an `offset` inside a nested plural block or
            // inside a clause's translatable text. ICU offsets are never
            // negative, so there is no `-?` either.
            const offsetMatch = /^\s*offset:\s*(\d+)/.exec(styleAndClauses);
            if (offsetMatch) {
              tokens.push(`offset:${offsetMatch[1]}`);
            }

            const clauseIsPluralLike = ICU_PLURAL_LIKE_FORMAT_TYPES.has(formatType);
            let j = 0;
            while (j < styleAndClauses.length) {
              while (j < styleAndClauses.length && /\s/.test(styleAndClauses[j])) j++;
              if (j >= styleAndClauses.length) break;
              if (styleAndClauses[j] === "'") {
                const after = skipQuotedLiteral(styleAndClauses, j);
                if (after !== -1) {
                  j = after;
                  continue;
                }
                j++;
                continue;
              }
              if (styleAndClauses[j] === '{') {
                // Stray brace with no preceding selector keyword - skip past it.
                const strayClose = findMatchingBrace(styleAndClauses, j);
                if (strayClose === -1) break;
                j = strayClose + 1;
                continue;
              }
              const kwMatch = /^[=\w-]+/.exec(styleAndClauses.slice(j));
              if (!kwMatch) {
                j++;
                continue;
              }
              const keyword = kwMatch[0];
              j += keyword.length;
              while (j < styleAndClauses.length && /\s/.test(styleAndClauses[j])) j++;
              if (styleAndClauses[j] === '{') {
                const subClose = findMatchingBrace(styleAndClauses, j);
                if (subClose === -1) break;
                // Clause keywords that are also plural categories
                // (zero/one/two/few/many) are namespaced by the block type
                // they belong to (`plural:one` vs `select:one`), so a `select`
                // key named `one` is never confused with a plural category.
                // `other` and other keys stay un-namespaced: `other` is
                // required in every block and stays strict.
                tokens.push(
                  ICU_LOCALE_PLURAL_CATEGORIES.has(keyword)
                    ? `${formatType}:${keyword}`
                    : keyword
                );
                const subMessage = styleAndClauses.slice(j + 1, subClose);
                tokens.push(...extractBraceTokens(subMessage, clauseIsPluralLike));
                j = subClose + 1;
              }
            }
          } else if (rest.includes('{')) {
            // An ICU type we don't specially parse (number/date/time/...) but
            // its style still contains braces - recurse defensively.
            tokens.push(...extractBraceTokens(rest, false));
          }
        } else {
          tokens.push(...extractBraceTokens(inner, false));
        }
      } else {
        const simpleName = stripBidiControls(inner.trim());
        if (/^[a-zA-Z0-9_-]+$/.test(simpleName)) {
          tokens.push(`{${simpleName}}`);
        } else {
          tokens.push(...extractBraceTokens(inner, false));
        }
      }
      i = close + 1;
    } else if (ch === '#' && inPluralClause) {
      tokens.push('#');
      i++;
    } else {
      i++;
    }
  }
  return tokens;
}

/**
 * Extracts Android string format specifiers, ICU MessageFormat tokens and HTML tags
 * Matches: %s, %d, %1$s, %2$d, %1.2f, {0}, {count, plural, one {# book} other {# books}}, <b>, </b>, etc.
 */
export function extractPlaceholders(text: string): string[] {
  if (!text) return [];

  const found: string[] = [];

  // Android printf format specifiers: %s, %d, %1$s, %2$d, %1$10s, %.2f, etc.
  const formatRegex = /%(?:\d+\$)?[+-]?\d*(?:\.\d+)?[bcdefgopsx%]/gi;
  const formatMatches = text.match(formatRegex);
  if (formatMatches) {
    found.push(...formatMatches);
  }

  // ICU / bracket placeholders like {0}, {count}, {username}, and ICU MessageFormat
  // plural/select/selectordinal blocks (with their reserved keywords and variable name).
  found.push(...extractBraceTokens(text, false));

  // HTML tags like <b>, <i>, <u>, <font color="...">, etc.
  const tagRegex = /<\/?[a-zA-Z][^>]*>/g;
  const tagMatches = text.match(tagRegex);
  if (tagMatches) {
    found.push(...tagMatches);
  }

  // Return deduplicated list
  return Array.from(new Set(found));
}

export interface PlaceholderValidation {
  valid: boolean;
  missingInTarget: string[];
  extraInTarget: string[];
  /** Locale-category warnings (missing/extra plural forms). These are quality
   * issues, not errors: ICU only mandates `other`, so a missing category does
   * not make the translation invalid. Kept separate from `missingInTarget` so
   * the AI-reply check does not treat a warning as a hard placeholder error. */
  warnings: string[];
}

/**
 * True when `text` has a `{` with no matching `}` (or a stray `}`). A
 * translator who drops the final `}` of an ICU block should see this as its
 * own error, not as a confusing "Missing placeholders" list.
 *
 * Braces inside an ICU `'...'` quoted literal (e.g. `"'{'"`) are literal
 * text, not structure, so they are skipped — using the same quoting rule as
 * the parser, so the two agree. An apostrophe inside a word (e.g. `it's`,
 * `don't`) is a literal apostrophe, not a quote boundary.
 */
function hasUnbalancedBraces(text: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      const after = skipQuotedLiteral(text, i);
      if (after !== -1) {
        i = after;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) return true;
    }
    i++;
  }
  return depth !== 0;
}

/**
 * Converts an Android resource locale (e.g. `pt-rBR`, `zh-rCN`, `es-r419`)
 * to BCP 47 (`pt-BR`, `zh-CN`, `es-419`), which is what Intl expects. Codes
 * already in BCP 47 form (e.g. `ar`, `pt-BR`) pass through unchanged.
 */
function normalizeLocaleForPluralRules(locale: string): string {
  return locale.replace(/-r([A-Z]{2}|[0-9]{3})/, '-$1');
}

/**
 * The plural categories a locale requires, from CLDR via Intl.PluralRules.
 * `type` is 'cardinal' for `plural` and 'ordinal' for `selectordinal`.
 * Returns null when the locale is not usable, so callers can fall back to
 * the plain source/target comparison instead of guessing.
 *
 * Two silent-failure modes are guarded here: a well-formed but unsupported
 * tag (e.g. `zz`) does not throw — it silently falls back to the default
 * locale and would return the wrong categories — so it is rejected via
 * `supportedLocalesOf`; and an Android-format tag (e.g. `pt-rBR`) would
 * throw, so it is normalized to BCP 47 first.
 */
function getPluralCategoriesForLocale(
  locale: string,
  type: 'cardinal' | 'ordinal'
): string[] | null {
  try {
    const normalized = normalizeLocaleForPluralRules(locale);
    if (Intl.PluralRules.supportedLocalesOf([normalized]).length === 0) return null;
    return [...new Intl.PluralRules(normalized, { type }).resolvedOptions().pluralCategories];
  } catch {
    return null;
  }
}

// The namespaced forms of the locale-dependent plural categories, as emitted
// by `extractBraceTokens` for `plural`/`selectordinal` blocks
// (`plural:one`, `selectordinal:one`, ...). A `select` key named `one` is
// emitted as `select:one`, so it is never confused with a plural category.
const NAMESPACED_PLURAL_CATEGORIES = new Set(
  ['plural', 'selectordinal'].flatMap((t) =>
    [...ICU_LOCALE_PLURAL_CATEGORIES].map((c) => `${t}:${c}`)
  )
);

/** The ICU block types present in a token-count map (from `{name:type}` tokens). */
function blockTypesIn(counts: Map<string, number>): Set<string> {
  const types = new Set<string>();
  for (const token of counts.keys()) {
    const m = /^\{[^}:]+:([a-z]+)\}$/.exec(token);
    if (m) types.add(m[1]);
  }
  return types;
}

/**
 * The plural categories the target language requires, per ICU block type in
 * `sourceCounts`, or null when there is no plural/selectordinal block (or the
 * locale is invalid). Cardinal rules cover `plural`, ordinal rules cover
 * `selectordinal`; each block type is checked against its own rules, not a
 * union, so a correctly complete `plural` block is not flagged for missing
 * ordinal categories (and vice versa).
 */
function getExpectedPluralCategories(
  sourceCounts: Map<string, number>,
  targetLocale: string
): Map<string, Set<string>> | null {
  const types = blockTypesIn(sourceCounts);
  const expected = new Map<string, Set<string>>();
  if (types.has('plural')) {
    const cardinal = getPluralCategoriesForLocale(targetLocale, 'cardinal');
    if (!cardinal) return null;
    expected.set('plural', new Set(cardinal));
  }
  if (types.has('selectordinal')) {
    const ordinal = getPluralCategoriesForLocale(targetLocale, 'ordinal');
    if (!ordinal) return null;
    expected.set('selectordinal', new Set(ordinal));
  }
  return expected.size > 0 ? expected : null;
}

/**
 * Compares the placeholder tokens of a (source, target) pair.
 *
 * When a target locale is given and both sides keep a plural/selectordinal
 * block, the locale-dependent plural categories (`plural:one`, ... — the
 * namespaced forms) and the `#` count are NOT compared against the source:
 * the categories a translation needs depend on the target language (CLDR),
 * not on the source language, and `#` appears once per clause that uses it,
 * so its count legitimately differs between languages (e.g. 6 Arabic clauses
 * vs 2 English ones). The categories are checked by `checkPluralCategories`
 * instead, and `#` is checked by presence only. `other`, `=N`, `offset`,
 * `select` keys (including `select:one`), variable names and format types
 * stay strict.
 *
 * In that locale-aware path, only tokens inside a plural/selectordinal
 * branch (`branchTokens`) are compared by presence, not count: the target
 * legitimately has fewer clauses (fewer categories) than the source, so a
 * token that appears in a dropped clause (e.g. `{name}` or `%s` in the `one`
 * clause of a Japanese `other`-only translation) is not missing as long as it
 * appears in a kept clause. Everything outside those branches — plain-text
 * placeholders, `select` keys in independent blocks, HTML tags, `%%` —
 * stays count-based, so deleting a second `{name}` or a `select` key is never
 * hidden by the presence of a plural block elsewhere in the message. A block
 * that lost its `other` clause is caught separately by the per-block check,
 * since the global `other` count would hide it.
 *
 * Without a locale, when the target dropped the plural structure entirely,
 * or when the locale is invalid, this falls back to the plain count
 * comparison (which already reports the dropped structure).
 */
function comparePlaceholderTokens(
  sourceCounts: Map<string, number>,
  targetCounts: Map<string, number>,
  targetLocale?: string,
  branchTokens: Set<string> = new Set()
): { missing: string[]; extra: string[] } {
  const src = new Map(sourceCounts);
  const tgt = new Map(targetCounts);

  const targetTypes = blockTypesIn(tgt);
  const targetHasPluralBlock = targetTypes.has('plural') || targetTypes.has('selectordinal');
  const expected =
    targetLocale && targetHasPluralBlock
      ? getExpectedPluralCategories(src, targetLocale)
      : null;

  const missing: string[] = [];
  const extra: string[] = [];

  if (expected) {
    // `#` is presence-only: it appears once per clause that uses it, so a
    // correct Arabic translation (6 clauses) legitimately has more `#` than
    // the English source (2 clauses).
    const sourceHasHash = src.has('#');
    const targetHasHash = tgt.has('#');
    src.delete('#');
    tgt.delete('#');

    // Locale-dependent categories are checked against the target language,
    // not against the source. Only the `plural:`/`selectordinal:` forms are
    // excluded: a `select` key named `one` (`select:one`) stays strict.
    for (const token of NAMESPACED_PLURAL_CATEGORIES) {
      src.delete(token);
      tgt.delete(token);
    }

    for (const [token, srcCount] of src.entries()) {
      const tgtCount = tgt.get(token) || 0;
      if (branchTokens.has(token)) {
        // Inside a plural/selectordinal branch: presence-only, because a
        // whole clause (and every token in it) may legitimately be dropped
        // when the target language needs fewer categories.
        if (tgtCount === 0) missing.push(token);
      } else if (tgtCount < srcCount) {
        missing.push(token);
      }
    }
    for (const [token, tgtCount] of tgt.entries()) {
      const srcCount = src.get(token) || 0;
      if (branchTokens.has(token)) {
        if (srcCount === 0) extra.push(token);
      } else if (tgtCount > srcCount) {
        extra.push(token);
      }
    }
    if (sourceHasHash && !targetHasHash) missing.push('#');
    if (targetHasHash && !sourceHasHash) extra.push('#');
    return { missing, extra };
  }

  // Plain count comparison (no locale, no plural block on the target side,
  // or an invalid locale).
  for (const [token, srcCount] of src.entries()) {
    if ((tgt.get(token) || 0) < srcCount) missing.push(token);
  }
  for (const [token, tgtCount] of tgt.entries()) {
    if (tgtCount > (src.get(token) || 0)) extra.push(token);
  }
  return { missing, extra };
}

// Canonical CLDR order for plural categories, so reported lists are
// deterministic instead of depending on the runtime's `pluralCategories` order.
const PLURAL_CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * Checks the target's plural categories against what its language requires
 * (CLDR), per block. Only runs when both sides keep a plural/selectordinal
 * block; when the target dropped the structure entirely, `comparePlaceholderTokens`
 * already reports the missing tokens.
 *
 * Each block is checked against its own rules (cardinal for `plural`,
 * ordinal for `selectordinal`), so a category in one block never hides its
 * absence in another block of the same type. `other` is not checked here: it
 * is required by every locale and stays in the strict comparison (and in the
 * per-block check), so reporting it again would duplicate it. Returns one
 * entry per block that is missing or has extra categories, with the block's
 * variable so the warning names the block.
 */
function checkPluralCategories(
  source: string,
  target: string,
  targetLocale?: string
): {
  missing: { variable: string; categories: string[] }[];
  extra: { variable: string; categories: string[] }[];
} {
  const none: {
    missing: { variable: string; categories: string[] }[];
    extra: { variable: string; categories: string[] }[];
  } = { missing: [], extra: [] };
  if (!targetLocale) return none;
  const targetBlocks = extractIcuBlocks(target).filter(
    (b) => b.formatType === 'plural' || b.formatType === 'selectordinal'
  );
  if (targetBlocks.length === 0) return none;
  const sourceCounts = extractFormatTokensWithCounts(source);
  const expectedByType = getExpectedPluralCategories(sourceCounts, targetLocale);
  if (!expectedByType) return none;

  for (const block of targetBlocks) {
    const expected = expectedByType.get(block.formatType);
    if (!expected) continue;
    const targetCategories = new Set(
      block.keywords
        .map((k) => (ICU_LOCALE_PLURAL_CATEGORIES.has(k) ? k : null))
        .filter((c): c is string => c !== null)
    );
    const missingCategories = PLURAL_CATEGORY_ORDER.filter(
      (c) => c !== 'other' && expected.has(c) && !targetCategories.has(c)
    );
    const extraCategories = PLURAL_CATEGORY_ORDER.filter(
      (c) => targetCategories.has(c) && !expected.has(c)
    );
    if (missingCategories.length > 0) {
      none.missing.push({ variable: block.variable, categories: missingCategories });
    }
    if (extraCategories.length > 0) {
      none.extra.push({ variable: block.variable, categories: extraCategories });
    }
  }
  return none;
}

/** One ICU clause block (`{var, plural|select|selectordinal, ...}`) with its clause keywords and sub-messages. */
interface IcuBlock {
  variable: string;
  formatType: string;
  keywords: string[];
  clauses: { selector: string; subMessage: string }[];
}

/**
 * Extracts the ICU clause blocks (`{var, plural|select|selectordinal, ...}`)
 * in `text`, with each block's clause keywords, recursing into nested blocks.
 * Quoted literals are skipped, so a brace inside them is not a block. Used
 * for the per-block `other` check: the flat token count cannot tell whether
 * every block has an `other` clause, because one block's extra `other` hides
 * another block's missing one.
 */
function extractIcuBlocks(text: string): IcuBlock[] {
  const blocks: IcuBlock[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "'") {
      const after = skipQuotedLiteral(text, i);
      if (after !== -1) {
        i = after;
        continue;
      }
      i++;
      continue;
    }
    if (text[i] !== '{') {
      i++;
      continue;
    }
    const close = findMatchingBrace(text, i);
    if (close === -1) {
      i++;
      continue;
    }
    const inner = text.slice(i + 1, close);
    const commaIdx = inner.indexOf(',');
    if (commaIdx !== -1) {
      const argName = stripBidiControls(inner.slice(0, commaIdx).trim());
      const rest = inner.slice(commaIdx + 1);
      const nextCommaIdx = rest.indexOf(',');
      const formatType = stripBidiControls(
        (nextCommaIdx !== -1 ? rest.slice(0, nextCommaIdx) : rest).trim()
      );
      if (/^[a-zA-Z0-9_-]+$/.test(argName) && ICU_CLAUSE_FORMAT_TYPES.has(formatType)) {
        const styleAndClauses = nextCommaIdx !== -1 ? rest.slice(nextCommaIdx + 1) : '';
        const keywords: string[] = [];
        const clauses: { selector: string; subMessage: string }[] = [];
        let j = 0;
        while (j < styleAndClauses.length) {
          while (j < styleAndClauses.length && /\s/.test(styleAndClauses[j])) j++;
          if (j >= styleAndClauses.length) break;
          if (styleAndClauses[j] === "'") {
            const after = skipQuotedLiteral(styleAndClauses, j);
            if (after !== -1) {
              j = after;
              continue;
            }
            j++;
            continue;
          }
          if (styleAndClauses[j] === '{') {
            const strayClose = findMatchingBrace(styleAndClauses, j);
            if (strayClose === -1) break;
            j = strayClose + 1;
            continue;
          }
          const kwMatch = /^[=\w-]+/.exec(styleAndClauses.slice(j));
          if (!kwMatch) {
            j++;
            continue;
          }
          const keyword = kwMatch[0];
          j += keyword.length;
          while (j < styleAndClauses.length && /\s/.test(styleAndClauses[j])) j++;
          if (styleAndClauses[j] === '{') {
            const subClose = findMatchingBrace(styleAndClauses, j);
            if (subClose === -1) break;
            keywords.push(keyword);
            const subMessage = styleAndClauses.slice(j + 1, subClose);
            clauses.push({ selector: keyword, subMessage });
            blocks.push(...extractIcuBlocks(subMessage));
            j = subClose + 1;
          }
        }
        blocks.push({ variable: argName, formatType, keywords, clauses });
      }
    }
    i = close + 1;
  }
  return blocks;
}

/**
 * The variables of the target's ICU blocks that lack an `other` clause while
 * the corresponding source block has one. ICU requires `other` in every
 * plural/select/selectordinal block (`U_DEFAULT_KEYWORD_MISSING`), and the
 * flat token count cannot catch it: one block's extra `other` hides another
 * block's missing one. Blocks are matched to their source counterpart by
 * variable name and ordinal position (the n-th target block with a variable
 * matches the n-th source block with it), so repeated variables and added
 * blocks are handled: an added block (no source counterpart) that lacks
 * `other` is an error, while a source block that itself lacks `other` is not
 * flagged — the target faithfully preserving it is not an error.
 */
function findBlocksMissingOther(source: string, target: string): string[] {
  const sourceByVariable = new Map<string, boolean[]>();
  for (const block of extractIcuBlocks(source)) {
    if (!sourceByVariable.has(block.variable)) sourceByVariable.set(block.variable, []);
    sourceByVariable.get(block.variable)?.push(block.keywords.includes('other'));
  }
  const seenByVariable = new Map<string, number>();
  const missing: string[] = [];
  for (const block of extractIcuBlocks(target)) {
    if (block.keywords.includes('other')) continue;
    const ordinal = seenByVariable.get(block.variable) || 0;
    seenByVariable.set(block.variable, ordinal + 1);
    const sourceHasOther = sourceByVariable.get(block.variable)?.[ordinal];
    // No source counterpart (an added block) or a source block that has
    // `other`: the target block is invalid. Only a source block that itself
    // lacks `other` excuses the target.
    if (sourceHasOther === false) continue;
    if (!missing.includes(block.variable)) missing.push(block.variable);
  }
  return missing;
}

/**
 * The tokens that appear inside a plural/selectordinal clause's sub-message
 * (recursing into nested blocks), including printf specifiers. Only these
 * tokens may legitimately differ in count between source and target: when the
 * target language needs fewer plural categories, a whole clause — and every
 * token inside it — is dropped. Tokens outside these branches (plain-text
 * placeholders, `select` keys in independent blocks, HTML tags) are compared
 * by count, so a deleted `{name}` or `select` key is never hidden by the
 * presence of a plural block elsewhere in the message.
 */
function collectBranchTokens(text: string): Set<string> {
  const branchTokens = new Set<string>();
  for (const block of extractIcuBlocks(text)) {
    if (block.formatType !== 'plural' && block.formatType !== 'selectordinal') continue;
    for (const clause of block.clauses) {
      const subCounts = extractFormatTokensWithCounts(clause.subMessage);
      for (const token of subCounts.keys()) branchTokens.add(token);
      for (const nested of collectBranchTokens(clause.subMessage)) branchTokens.add(nested);
    }
  }
  return branchTokens;
}

/**
 * Adds HTML tags and literal `%%` to a token-count map.
 * `extractFormatTokensWithCounts` only returns printf + ICU tokens, but the
 * old set-based `validatePlaceholders` also compared tags and `%%`, and the
 * AI-reply check (`checkReply`) relies on it alone to catch a dropped tag.
 * These are added here — not inside `extractFormatTokensWithCounts` —
 * because the QA path already covers tags thoroughly via `checkHtmlTags`,
 * and counting them there too would duplicate the issue.
 */
function addHtmlAndPercentCounts(counts: Map<string, number>, text: string): void {
  for (const tag of text.match(/<\/?[a-zA-Z][^>]*>/g) || []) {
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  for (const pct of text.match(/%%/g) || []) {
    counts.set(pct, (counts.get(pct) || 0) + 1);
  }
}

/**
 * Returns `'{'` when `text` has a `{` with no matching `}`, `'}'` when it has
 * a stray `}`, or null when the braces balance. (Quote-aware, like
 * `hasUnbalancedBraces`.) Used by the AI-reply check so it flags a malformed
 * target the same way QA does, instead of passing it because the token counts
 * are unchanged.
 */
function firstUnbalancedBrace(text: string): '{' | '}' | null {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      const after = skipQuotedLiteral(text, i);
      if (after !== -1) {
        i = after;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) return '}';
    }
    i++;
  }
  return depth !== 0 ? '{' : null;
}

/**
 * Checks if target translation preserves all format placeholders present in source.
 * Pass the target language (e.g. 'ar') so plural categories are checked
 * against what that language requires (CLDR) instead of against the source
 * language; without it, the plain source/target comparison is used.
 *
 * Note: checked against the extracted target tokens rather than a raw substring
 * search of `target`, since ICU MessageFormat tokens (e.g. the `{count}` token
 * representing the `count` variable in `{count, plural, ...}`) are synthesized
 * from the parsed structure and aren't necessarily a literal substring of the
 * original ICU text. `valid` reflects errors only; missing/extra plural
 * categories are reported in `warnings` (they are quality issues, not errors).
 */
export function validatePlaceholders(
  source: string,
  target: string,
  targetLocale?: string
): PlaceholderValidation {
  const sourceCounts = extractFormatTokensWithCounts(source);
  const targetCounts = extractFormatTokensWithCounts(target);
  // Also compare HTML tags and literal `%%`, which `extractFormatTokensWithCounts`
  // does not return but the old check did (see `addHtmlAndPercentCounts`).
  addHtmlAndPercentCounts(sourceCounts, source);
  addHtmlAndPercentCounts(targetCounts, target);
  // Tokens inside a plural/selectordinal branch may legitimately differ in
  // count (a whole clause can be dropped when the target language needs fewer
  // categories); HTML tags and `%%` are added above, outside any branch, so
  // they stay count-based. Computed from the original texts, before the tags
  // are added, so a tag inside a branch is not mistaken for one outside it.
  const branchTokens = new Set([
    ...collectBranchTokens(source),
    ...collectBranchTokens(target),
  ]);
  const { missing, extra } = comparePlaceholderTokens(
    sourceCounts,
    targetCounts,
    targetLocale,
    branchTokens
  );
  const { missing: missingByBlock, extra: extraByBlock } = checkPluralCategories(
    source,
    target,
    targetLocale
  );
  // A target block that lost its `other` clause is an error, even when the
  // global `other` count is unchanged (another block's extra `other` hides it).
  const blocksMissingOther = findBlocksMissingOther(source, target);
  const missingInTarget = [
    ...missing,
    ...blocksMissingOther.map((v) => `other:{${v}}`),
  ];
  const extraInTarget = [...extra];
  // Warnings are the flat, deduplicated category lists across blocks, so a
  // missing category is a warning (not an error) in the AI check, matching QA.
  const warnings = Array.from(
    new Set([
      ...missingByBlock.flatMap((b) => b.categories),
      ...extraByBlock.flatMap((b) => b.categories),
    ])
  );
  // An unbalanced target (when the source is balanced) is an error here too,
  // not just in QA: an appended `{` is malformed ICU (`U_UNMATCHED_BRACES`)
  // even though the token counts are unchanged, so the AI-reply check would
  // otherwise pass it silently. A lone `}` in a target with no `{` at all is
  // ordinary literal text in a non-ICU message, not a broken block.
  const unbalanced = firstUnbalancedBrace(target);
  if (unbalanced && !hasUnbalancedBraces(source) && target.includes('{')) {
    missingInTarget.push(unbalanced);
  }

  return {
    valid: missingInTarget.length === 0,
    missingInTarget,
    extraInTarget,
    warnings,
  };
}

export type QaIssueCategory = 'placeholder' | 'html' | 'formatting';

export interface QaIssue {
  id: string;
  itemId: string;
  itemName: string;
  subKey?: string;
  category: QaIssueCategory;
  severity: 'error' | 'warning';
  messageEn: string;
  messageAr: string;
  tokens: string[];
}

export interface ItemQaResult {
  itemId: string;
  itemName: string;
  issues: QaIssue[];
  hasPlaceholderIssue: boolean;
  hasHtmlIssue: boolean;
  hasFormattingIssue: boolean;
}

const FORMAT_SPECIFIER_REGEX = /%(?:\d+\$)?[+-]?\d*(?:\.\d+)?[bcdefgopsx]/gi;
const ALLOWED_ANDROID_HTML_TAGS = new Set([
  'b',
  'i',
  'u',
  'a',
  'font',
  'small',
  'big',
  'sub',
  'sup',
  'strike',
  's',
  'del',
  'tt',
  'span',
  'br',
  'p',
  'div',
  'ul',
  'li',
  'xliff:g',
]);

function extractFormatTokensWithCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!text) return counts;

  const printfMatches = text.match(FORMAT_SPECIFIER_REGEX) || [];
  const icuMatches = extractBraceTokens(text, false);

  for (const token of [...printfMatches, ...icuMatches]) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

/**
 * Validates HTML tags in target string compared to source string
 */
function checkHtmlTags(source: string, target: string): {
  issuesEn: string[];
  issuesAr: string[];
  tokens: string[];
} {
  const issuesEn: string[] = [];
  const issuesAr: string[] = [];
  const tokens: string[] = [];

  const safeSource = source || '';
  const safeTarget = target || '';

  // 1. Check for broken/unclosed '<' or '>' brackets when tags are attempted
  // Strip valid XML entities &lt; and &gt; first
  const cleanTarget = safeTarget.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '');
  const tagRegex = /<\/?([a-zA-Z0-9:_-]+)(?:\s+[^>]*)?\s*(\/?)>/g;

  // Check if there is a '<' that looks like an unclosed tag (e.g. "<b" without ">")
  const strippedValidTags = cleanTarget.replace(tagRegex, '');
  if (/<[a-zA-Z/]/.test(strippedValidTags)) {
    const brokenMatch = strippedValidTags.match(/<[^>]{0,20}/)?.[0] || '<...';
    issuesEn.push(`Malformed or unclosed HTML tag (${brokenMatch})`);
    issuesAr.push(`وسم HTML غير مكتمل أو غير صالح (${brokenMatch})`);
    tokens.push(brokenMatch);
  }

  // 2. Parse opening/closing tag stack in target
  const stack: string[] = [];
  const targetTagNames: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(cleanTarget)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isClosing = fullTag.startsWith('</');
    const isSelfClosing = match[2] === '/' || tagName === 'br';

    targetTagNames.push(tagName);

    if (!ALLOWED_ANDROID_HTML_TAGS.has(tagName)) {
      issuesEn.push(`Unsupported Android HTML tag <${tagName}>`);
      issuesAr.push(`وسم HTML غير مدعوم في أندرويد <${tagName}>`);
      tokens.push(fullTag);
    }

    if (isSelfClosing) {
      continue;
    }

    if (!isClosing) {
      stack.push(tagName);
    } else {
      const lastOpen = stack[stack.length - 1];
      if (lastOpen === tagName) {
        stack.pop();
      } else {
        issuesEn.push(`Unexpected closing tag </${tagName}>`);
        issuesAr.push(`وسم إغلاق غير متطابق </${tagName}>`);
        tokens.push(fullTag);
      }
    }
  }

  if (stack.length > 0) {
    for (const unclosed of stack) {
      issuesEn.push(`Unclosed HTML tag <${unclosed}>`);
      issuesAr.push(`وسم HTML غير مغلق <${unclosed}>`);
      tokens.push(`<${unclosed}>`);
    }
  }

  // 3. Compare with source HTML tags (ensure tags in source weren't lost)
  const cleanSource = safeSource.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '');
  const sourceTagCounts = new Map<string, number>();
  let srcMatch: RegExpExecArray | null;
  const srcTagRegex = /<\/?([a-zA-Z0-9:_-]+)(?:\s+[^>]*)?\s*(\/?)>/g;
  while ((srcMatch = srcTagRegex.exec(cleanSource)) !== null) {
    const fullTag = srcMatch[0];
    if (!fullTag.startsWith('</')) {
      const tName = srcMatch[1].toLowerCase();
      sourceTagCounts.set(tName, (sourceTagCounts.get(tName) || 0) + 1);
    }
  }

  const targetOpenTagCounts = new Map<string, number>();
  const tgtTagRegex = /<\/?([a-zA-Z0-9:_-]+)(?:\s+[^>]*)?\s*(\/?)>/g;
  while ((srcMatch = tgtTagRegex.exec(cleanTarget)) !== null) {
    const fullTag = srcMatch[0];
    if (!fullTag.startsWith('</')) {
      const tName = srcMatch[1].toLowerCase();
      targetOpenTagCounts.set(tName, (targetOpenTagCounts.get(tName) || 0) + 1);
    }
  }

  for (const [tagName, srcCount] of sourceTagCounts.entries()) {
    const tgtCount = targetOpenTagCounts.get(tagName) || 0;
    if (tgtCount < srcCount) {
      issuesEn.push(`Missing HTML tag <${tagName}> from source`);
      issuesAr.push(`وسم HTML مفقود من النص الأصلي <${tagName}>`);
      tokens.push(`<${tagName}>`);
    }
  }

  return {
    issuesEn: Array.from(new Set(issuesEn)),
    issuesAr: Array.from(new Set(issuesAr)),
    tokens: Array.from(new Set(tokens)),
  };
}

/**
 * Compares only the printf specifiers (`%s`, `%d`, `%1$s`, ...) of a pair.
 * Used when the target has unbalanced braces: the ICU/bracket comparison is
 * unreliable then, but printf specifiers do not involve braces, so a dropped
 * `%s` is still worth reporting instead of being silently skipped.
 */
function comparePrintfSpecifiers(
  source: string,
  target: string
): { missing: string[]; extra: string[] } {
  const countMatches = (text: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const m of text.match(FORMAT_SPECIFIER_REGEX) || []) {
      counts.set(m, (counts.get(m) || 0) + 1);
    }
    return counts;
  };
  const src = countMatches(source);
  const tgt = countMatches(target);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [token, srcCount] of src.entries()) {
    if ((tgt.get(token) || 0) < srcCount) missing.push(token);
  }
  for (const [token, tgtCount] of tgt.entries()) {
    if (tgtCount > (src.get(token) || 0)) extra.push(token);
  }
  return { missing, extra };
}

/**
 * Checks a single (source, target) pair for Android XML QA issues
 */
function validateSourceTargetPair(
  itemId: string,
  itemName: string,
  source: string,
  target: string,
  subKey?: string,
  targetLocale?: string
): QaIssue[] {
  if (!target || !target.trim()) {
    return [];
  }

  const issues: QaIssue[] = [];
  const prefix = subKey ? `[${subKey}] ` : '';

  // 0. Unbalanced braces in the TARGET: the placeholder parser cannot
  // reliably extract tokens from a string with a missing `}`, so report
  // that directly instead of a misleading "Missing placeholders" list.
  // Only when the source is balanced: a lone `{`/`}` in the source text
  // (e.g. `:-}`) is ordinary text, so a target that faithfully preserves
  // the same literal braces is not an error.
  // A lone `}` in a target with no `{` at all is ordinary literal text in a
  // non-ICU message, not a broken ICU block — the brace check only applies
  // when the target contains an opening brace.
  const targetUnbalanced =
    hasUnbalancedBraces(target) && !hasUnbalancedBraces(source) && target.includes('{');
  if (targetUnbalanced) {
    issues.push({
      id: `${itemId}_${subKey || 'main'}_unbalanced_braces`,
      itemId,
      itemName,
      subKey,
      category: 'placeholder',
      severity: 'error',
      messageEn: `${prefix}Unbalanced braces in the translation (a "{" has no matching "}")`,
      messageAr: `${prefix}أقواس غير متوازنة في النص المترجم (يوجد "{" بلا "}" مطابقة)`,
      tokens: ['{', '}'],
    });
  }

  // 1. Placeholder checks (%s, %d, %1$s, {0}, etc.)
  const sourceFormatCounts = extractFormatTokensWithCounts(source);
  const targetFormatCounts = extractFormatTokensWithCounts(target);

  if (targetUnbalanced) {
    // The ICU/bracket comparison is unreliable with unbalanced braces, but
    // printf specifiers do not involve braces, so a dropped `%s` is still
    // reported instead of being silently skipped.
    const { missing: missingPrintf, extra: extraPrintf } = comparePrintfSpecifiers(
      source,
      target
    );
    if (missingPrintf.length > 0) {
      issues.push({
        id: `${itemId}_${subKey || 'main'}_missing_ph`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'error',
        messageEn: `${prefix}Missing placeholder${missingPrintf.length > 1 ? 's' : ''}: ${missingPrintf.join(', ')}`,
        messageAr: `${prefix}عنصر نائب مفقود: ${missingPrintf.join(', ')}`,
        tokens: missingPrintf,
      });
    }
    if (extraPrintf.length > 0) {
      issues.push({
        id: `${itemId}_${subKey || 'main'}_extra_ph`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'warning',
        messageEn: `${prefix}Extra/mismatched placeholder${extraPrintf.length > 1 ? 's' : ''}: ${extraPrintf.join(', ')}`,
        messageAr: `${prefix}عنصر نائب إضافي أو غير متطابق: ${extraPrintf.join(', ')}`,
        tokens: extraPrintf,
      });
    }
  } else {
    const branchTokens = new Set([
      ...collectBranchTokens(source),
      ...collectBranchTokens(target),
    ]);
    const { missing: missingPlaceholders, extra: extraPlaceholders } =
      comparePlaceholderTokens(sourceFormatCounts, targetFormatCounts, targetLocale, branchTokens);

    if (missingPlaceholders.length > 0) {
      issues.push({
        id: `${itemId}_${subKey || 'main'}_missing_ph`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'error',
        messageEn: `${prefix}Missing placeholder${missingPlaceholders.length > 1 ? 's' : ''}: ${missingPlaceholders.join(', ')}`,
        messageAr: `${prefix}عنصر نائب مفقود: ${missingPlaceholders.join(', ')}`,
        tokens: missingPlaceholders,
      });
    }

    if (extraPlaceholders.length > 0) {
      issues.push({
        id: `${itemId}_${subKey || 'main'}_extra_ph`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'warning',
        messageEn: `${prefix}Extra/mismatched placeholder${extraPlaceholders.length > 1 ? 's' : ''}: ${extraPlaceholders.join(', ')}`,
        messageAr: `${prefix}عنصر نائب إضافي أو غير متطابق: ${extraPlaceholders.join(', ')}`,
        tokens: extraPlaceholders,
      });
    }

    // 1b. Plural categories for the target language (CLDR), per block. A
    // correct translation needs the categories its own language requires, not
    // the source language's (e.g. Arabic needs zero/two/few/many, Japanese
    // needs only `other`). A missing category is a warning, not an error:
    // ICU only mandates `other` (a missing category falls back to it), and
    // a missing `other` is already an error via the strict check above. Each
    // block is checked on its own, so a category in one block never hides its
    // absence in another block of the same type; the warning names the block.
    const { missing: missingByBlock, extra: extraByBlock } = checkPluralCategories(
      source,
      target,
      targetLocale
    );
    if (missingByBlock.length > 0) {
      const missingCategories = Array.from(
        new Set(missingByBlock.flatMap((b) => b.categories))
      );
      const blocks = missingByBlock
        .map((b) => `{${b.variable}}: ${b.categories.join(', ')}`)
        .join('; ');
      issues.push({
        id: `${itemId}_${subKey || 'main'}_missing_plural_forms`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'warning',
        messageEn: `${prefix}Missing plural forms for '${targetLocale}': ${blocks}`,
        messageAr: `${prefix}صيغ جمع ناقصة للغة '${targetLocale}': ${blocks}`,
        tokens: missingCategories,
      });
    }
    if (extraByBlock.length > 0) {
      const extraCategories = Array.from(
        new Set(extraByBlock.flatMap((b) => b.categories))
      );
      const blocks = extraByBlock
        .map((b) => `{${b.variable}}: ${b.categories.join(', ')}`)
        .join('; ');
      issues.push({
        id: `${itemId}_${subKey || 'main'}_extra_plural_forms`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'warning',
        messageEn: `${prefix}Unexpected plural forms for '${targetLocale}': ${blocks}`,
        messageAr: `${prefix}صيغ جمع غير متوقعة للغة '${targetLocale}': ${blocks}`,
        tokens: extraCategories,
      });
    }

    // 1c. Per-block `other`: ICU requires `other` in every plural/select/
    // selectordinal block (`U_DEFAULT_KEYWORD_MISSING`). The flat token count
    // cannot catch a block that lost its `other`, because another block's
    // extra `other` keeps the global count unchanged.
    const blocksMissingOther = findBlocksMissingOther(source, target);
    if (blocksMissingOther.length > 0) {
      issues.push({
        id: `${itemId}_${subKey || 'main'}_missing_other`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'error',
        messageEn: `${prefix}Missing 'other' clause in ICU block${blocksMissingOther.length > 1 ? 's' : ''}: ${blocksMissingOther.map((v) => `{${v}}`).join(', ')}`,
        messageAr: `${prefix}فرع 'other' مفقود في بلوك ICU: ${blocksMissingOther.map((v) => `{${v}}`).join(', ')}`,
        tokens: blocksMissingOther.map((v) => `other:{${v}}`),
      });
    }
  }

  // 2. HTML Tag checks (<b>, <i>, <u>, <a href=...>, unclosed tags, etc.)
  const htmlCheck = checkHtmlTags(source, target);
  if (htmlCheck.issuesEn.length > 0) {
    issues.push({
      id: `${itemId}_${subKey || 'main'}_html`,
      itemId,
      itemName,
      subKey,
      category: 'html',
      severity: 'error',
      messageEn: `${prefix}${htmlCheck.issuesEn.join(' • ')}`,
      messageAr: `${prefix}${htmlCheck.issuesAr.join(' • ')}`,
      tokens: htmlCheck.tokens,
    });
  }

  // 3. Line breaks (\n): the translation must have exactly as many as the source
  const srcBreaks = countLineBreaks(source);
  const tgtBreaks = countLineBreaks(target);
  if (srcBreaks !== tgtBreaks) {
    const diff = srcBreaks - tgtBreaks;
    const n = Math.abs(diff);
    const arBreaks = n === 1 ? 'سطر جديد واحد' : n === 2 ? 'سطران جديدان' : n <= 10 ? `${n} أسطر جديدة` : `${n} سطرًا جديدًا`;
    issues.push({
      id: `${itemId}_${subKey || 'main'}_linebreaks`,
      itemId,
      itemName,
      subKey,
      category: 'formatting',
      severity: 'error',
      messageEn:
        diff > 0
          ? `${prefix}${n} line break${n > 1 ? 's' : ''} missing (the source has ${srcBreaks}, the translation has ${tgtBreaks})`
          : `${prefix}${n} extra line break${n > 1 ? 's' : ''} (the source has ${srcBreaks}, the translation has ${tgtBreaks})`,
      messageAr:
        diff > 0
          ? `${prefix}ينقص ${arBreaks} (الأصل فيه ${srcBreaks} والترجمة فيها ${tgtBreaks})`
          : `${prefix}يزيد ${arBreaks} عن الأصل (الأصل فيه ${srcBreaks} والترجمة فيها ${tgtBreaks})`,
      tokens: ['\\n'],
    });
  }

  // 4. Multiple consecutive spaces check (مسافات متعددة متتالية)
  if (/ {2,}/.test(target)) {
    issues.push({
      id: `${itemId}_${subKey || 'main'}_multiple_spaces`,
      itemId,
      itemName,
      subKey,
      category: 'formatting',
      severity: 'warning',
      messageEn: `${prefix}Multiple consecutive spaces detected between words`,
      messageAr: `${prefix}تم رصد مسافات متتالية متعددة بين الكلمات`,
      tokens: ['  '],
    });
  }

  return issues;
}

/**
 * Runs QA checks on a single ResourceItem (string, plural, or array).
 * Pass the target language (e.g. 'ar') so ICU plural categories are checked
 * against what that language requires (CLDR).
 */
export function getItemQaIssues(item: ResourceItem, targetLocale?: string): QaIssue[] {
  if (!item) return [];
  if (item.type === 'string') {
    return validateSourceTargetPair(item.id, item.name, item.source || '', item.target || '', undefined, targetLocale);
  }
  if (item.type === 'plural') {
    const all: QaIssue[] = [];
    for (const q of item.items || []) {
      all.push(
        ...validateSourceTargetPair(item.id, item.name, q.source || '', q.target || '', q.quantity, targetLocale)
      );
    }
    return all;
  }
  if (item.type === 'array') {
    const all: QaIssue[] = [];
    for (const el of item.items || []) {
      all.push(
        ...validateSourceTargetPair(
          item.id,
          item.name,
          el.source || '',
          el.target || '',
          `#${(el.index ?? 0) + 1}`,
          targetLocale
        )
      );
    }
    return all;
  }
  return [];
}

/** Only the line-break errors of an item: a translation with a different number of line breaks cannot be saved. */
export function getLineBreakIssues(item: ResourceItem, targetLocale?: string): QaIssue[] {
  return getItemQaIssues(item, targetLocale).filter((i) => i.id.endsWith('_linebreaks'));
}

const itemQaCache = new Map<string, ItemQaResult | null>();

function getItemCacheKey(item: ResourceItem, targetLocale?: string): string {
  // The locale is part of the key: plural-category results depend on it, so
  // a cached result computed for one language must not be reused for another.
  const localePrefix = targetLocale ? `${targetLocale}|` : '';
  if (item.type === 'string') {
    return `${localePrefix}${item.id}_${item.name}_${item.source || ''}_${item.target || ''}`;
  }
  if (item.type === 'plural') {
    const sub = (item.items || []).map((q) => `${q.quantity}:${q.source || ''}:${q.target || ''}`).join('|');
    return `${localePrefix}${item.id}_${item.name}_p_${sub}`;
  }
  if (item.type === 'array') {
    const sub = (item.items || []).map((el) => `${el.index}:${el.source || ''}:${el.target || ''}`).join('|');
    return `${localePrefix}${item.id}_${item.name}_a_${sub}`;
  }
  return '';
}

/**
 * Runs QA checks across all items in the project and returns a summary + lookup map.
 * Pass the target language (e.g. 'ar') so ICU plural categories are checked
 * against what that language requires (CLDR).
 */
export function analyzeProjectQa(items: ResourceItem[], targetLocale?: string): {
  allIssues: QaIssue[];
  itemResults: ItemQaResult[];
  byItemId: Map<string, ItemQaResult>;
  placeholderIssueItemsCount: number;
  htmlIssueItemsCount: number;
  totalAffectedItemsCount: number;
} {
  const allIssues: QaIssue[] = [];
  const itemResults: ItemQaResult[] = [];
  const byItemId = new Map<string, ItemQaResult>();
  let placeholderIssueItemsCount = 0;
  let htmlIssueItemsCount = 0;

  if (itemQaCache.size > 10000) {
    itemQaCache.clear();
  }

  for (const item of items || []) {
    const cacheKey = getItemCacheKey(item, targetLocale);
    let cachedResult = itemQaCache.get(cacheKey);

    if (cachedResult === undefined) {
      const issues = getItemQaIssues(item, targetLocale);
      if (issues.length > 0) {
        const hasPlaceholderIssue = issues.some((i) => i.category === 'placeholder');
        const hasHtmlIssue = issues.some((i) => i.category === 'html');
        const hasFormattingIssue = issues.some((i) => i.category === 'formatting');

        cachedResult = {
          itemId: item.id,
          itemName: item.name,
          issues,
          hasPlaceholderIssue,
          hasHtmlIssue,
          hasFormattingIssue,
        };
      } else {
        cachedResult = null;
      }
      itemQaCache.set(cacheKey, cachedResult);
    }

    if (cachedResult) {
      if (cachedResult.hasPlaceholderIssue) placeholderIssueItemsCount++;
      if (cachedResult.hasHtmlIssue) htmlIssueItemsCount++;
      allIssues.push(...cachedResult.issues);
      itemResults.push(cachedResult);
      byItemId.set(item.id, cachedResult);
    }
  }

  return {
    allIssues,
    itemResults,
    byItemId,
    placeholderIssueItemsCount,
    htmlIssueItemsCount,
    totalAffectedItemsCount: itemResults.length,
  };
}

