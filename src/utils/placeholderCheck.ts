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
 * Finds the index of the closing brace that matches the opening brace at
 * `openIndex`, counting nested `{`/`}` pairs so ICU MessageFormat blocks like
 * `{count, plural, one {# book} other {# books}}` are matched correctly
 * instead of stopping at the first `}` found.
 */
function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
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
 * the formatted number.
 *
 * Note: this is a lightweight, "good enough" parser for Phase 1 — it does
 * not implement ICU's `'...'` quoted-literal escaping.
 */
function extractBraceTokens(text: string, inPluralClause: boolean): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
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
          tokens.push(`{${argName}}`);

          if (ICU_CLAUSE_FORMAT_TYPES.has(formatType)) {
            tokens.push(formatType);
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
                tokens.push(keyword);
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
}

/**
 * True when `text` has a `{` with no matching `}` (or a stray `}`). A
 * translator who drops the final `}` of an ICU block should see this as its
 * own error, not as a confusing "Missing placeholders" list.
 *
 * Braces inside an ICU `'...'` quoted literal (e.g. `"'{'"`) are literal
 * text, not structure, so they are skipped. `''` is an escaped quote, not a
 * quote boundary. An unclosed quote stops the skipping, so braces after it
 * are still counted.
 */
function hasUnbalancedBraces(text: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      if (text[i + 1] === "'") {
        i += 2; // escaped quote: a literal `'`, not a boundary
        continue;
      }
      // Skip the quoted literal up to its closing quote.
      const closing = text.indexOf("'", i + 1);
      if (closing === -1) {
        // Unclosed quote: stop skipping so braces after it still count.
        i++;
        continue;
      }
      i = closing + 1;
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
 * Converts an Android resource locale (e.g. `pt-rBR`, `zh-rCN`) to BCP 47
 * (`pt-BR`, `zh-CN`), which is what Intl expects. Codes already in BCP 47
 * form (e.g. `ar`, `pt-BR`) pass through unchanged.
 */
function normalizeLocaleForPluralRules(locale: string): string {
  return locale.replace(/-r([A-Z]{2})/, '-$1');
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

/**
 * The plural categories the target language requires for the ICU blocks in
 * `sourceCounts`, or null when there is no plural/selectordinal block (or the
 * locale is invalid). Cardinal rules cover `plural`, ordinal rules cover
 * `selectordinal`; when both block types are present the union is used.
 */
function getExpectedPluralCategories(
  sourceCounts: Map<string, number>,
  targetLocale: string
): Set<string> | null {
  if (!sourceCounts.has('plural') && !sourceCounts.has('selectordinal')) return null;
  const expected = new Set<string>();
  if (sourceCounts.has('plural')) {
    const cardinal = getPluralCategoriesForLocale(targetLocale, 'cardinal');
    if (!cardinal) return null;
    for (const c of cardinal) expected.add(c);
  }
  if (sourceCounts.has('selectordinal')) {
    const ordinal = getPluralCategoriesForLocale(targetLocale, 'ordinal');
    if (!ordinal) return null;
    for (const c of ordinal) expected.add(c);
  }
  return expected.size > 0 ? expected : null;
}

/**
 * Compares the placeholder tokens of a (source, target) pair by count.
 *
 * When a target locale is given and both sides keep a plural/selectordinal
 * block, the locale-dependent plural categories (`zero/one/two/few/many`)
 * and the `#` count are NOT compared against the source: the categories a
 * translation needs depend on the target language (CLDR), not on the source
 * language, and `#` appears once per clause that uses it, so its count
 * legitimately differs between languages (e.g. 6 Arabic clauses vs 2
 * English ones). The categories are checked by `checkPluralCategories`
 * instead, and `#` is checked by presence only. `other`, `=N`, `offset`,
 * `select` keys, variable names and simple/printf placeholders stay strict.
 *
 * Without a locale, when the target dropped the plural structure entirely,
 * or when the locale is invalid, this falls back to the plain count
 * comparison (which already reports the dropped structure).
 */
function comparePlaceholderTokens(
  sourceCounts: Map<string, number>,
  targetCounts: Map<string, number>,
  targetLocale?: string
): { missing: string[]; extra: string[] } {
  const src = new Map(sourceCounts);
  const tgt = new Map(targetCounts);

  const targetHasPluralBlock = tgt.has('plural') || tgt.has('selectordinal');
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
    // not against the source.
    for (const category of ICU_LOCALE_PLURAL_CATEGORIES) {
      src.delete(category);
      tgt.delete(category);
    }

    for (const [token, srcCount] of src.entries()) {
      if ((tgt.get(token) || 0) < srcCount) missing.push(token);
    }
    for (const [token, tgtCount] of tgt.entries()) {
      if (tgtCount > (src.get(token) || 0)) extra.push(token);
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
 * (CLDR). Only runs when both sides keep a plural/selectordinal block; when
 * the target dropped the structure entirely, `comparePlaceholderTokens`
 * already reports the missing tokens.
 *
 * `other` is not checked here: it is required by every locale and stays in
 * the strict comparison, so reporting it again would duplicate it.
 */
function checkPluralCategories(
  sourceCounts: Map<string, number>,
  targetCounts: Map<string, number>,
  targetLocale?: string
): { missingCategories: string[]; extraCategories: string[] } {
  const none = { missingCategories: [], extraCategories: [] };
  if (!targetLocale) return none;
  if (!targetCounts.has('plural') && !targetCounts.has('selectordinal')) return none;
  const expected = getExpectedPluralCategories(sourceCounts, targetLocale);
  if (!expected) return none;

  const targetCategories = new Set(
    [...targetCounts.keys()].filter((t) => ICU_LOCALE_PLURAL_CATEGORIES.has(t))
  );
  const missingCategories = PLURAL_CATEGORY_ORDER.filter(
    (c) => c !== 'other' && expected.has(c) && !targetCategories.has(c)
  );
  const extraCategories = PLURAL_CATEGORY_ORDER.filter(
    (c) => targetCategories.has(c) && !expected.has(c)
  );
  return { missingCategories, extraCategories };
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
 * Checks if target translation preserves all format placeholders present in source.
 * Pass the target language (e.g. 'ar') so plural categories are checked
 * against what that language requires (CLDR) instead of against the source
 * language; without it, the plain source/target comparison is used.
 *
 * Note: checked against the extracted target tokens rather than a raw substring
 * search of `target`, since ICU MessageFormat tokens (e.g. the `{count}` token
 * representing the `count` variable in `{count, plural, ...}`) are synthesized
 * from the parsed structure and aren't necessarily a literal substring of the
 * original ICU text.
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
  const { missing, extra } = comparePlaceholderTokens(sourceCounts, targetCounts, targetLocale);
  const { missingCategories, extraCategories } = checkPluralCategories(
    sourceCounts,
    targetCounts,
    targetLocale
  );
  const missingInTarget = [...missing, ...missingCategories];
  const extraInTarget = [...extra, ...extraCategories];

  return {
    valid: missingInTarget.length === 0,
    missingInTarget,
    extraInTarget,
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
  // An unbalanced SOURCE is not the translator's fault (a lone `{`/`}` in
  // the source text, e.g. `:-}`, is ordinary text), so it is not an error.
  const targetUnbalanced = hasUnbalancedBraces(target);
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
    const { missing: missingPlaceholders, extra: extraPlaceholders } =
      comparePlaceholderTokens(sourceFormatCounts, targetFormatCounts, targetLocale);

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

    // 1b. Plural categories for the target language (CLDR). A correct
    // translation needs the categories its own language requires, not the
    // source language's (e.g. Arabic needs zero/two/few/many, Japanese
    // needs only `other`). A missing category is a warning, not an error:
    // ICU only mandates `other` (a missing category falls back to it), and
    // a missing `other` is already an error via the strict check above.
    const { missingCategories, extraCategories } = checkPluralCategories(
      sourceFormatCounts,
      targetFormatCounts,
      targetLocale
    );
    if (missingCategories.length > 0) {
      issues.push({
        id: `${itemId}_${subKey || 'main'}_missing_plural_forms`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'warning',
        messageEn: `${prefix}Missing plural forms for '${targetLocale}': ${missingCategories.join(', ')}`,
        messageAr: `${prefix}صيغ جمع ناقصة للغة '${targetLocale}': ${missingCategories.join(', ')}`,
        tokens: missingCategories,
      });
    }
    if (extraCategories.length > 0) {
      issues.push({
        id: `${itemId}_${subKey || 'main'}_extra_plural_forms`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'warning',
        messageEn: `${prefix}Unexpected plural forms for '${targetLocale}': ${extraCategories.join(', ')}`,
        messageAr: `${prefix}صيغ جمع غير متوقعة للغة '${targetLocale}': ${extraCategories.join(', ')}`,
        tokens: extraCategories,
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

