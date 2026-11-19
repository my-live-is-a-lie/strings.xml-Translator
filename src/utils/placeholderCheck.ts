import { ResourceItem } from '../types';
import { countLineBreaks } from './newlines';

// ICU MessageFormat argument types that carry sub-message clauses in braces
// (e.g. `{count, plural, one {...} other {...}}`). Other ICU types such as
// `number`, `date`, `time`, `duration`, `spellout` and `ordinal` only take a
// simple style keyword with no nested braces, so they don't need clause parsing.
const ICU_PLURAL_LIKE_FORMAT_TYPES = new Set(['plural', 'selectordinal']);
const ICU_CLAUSE_FORMAT_TYPES = new Set(['plural', 'select', 'selectordinal']);

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
        const argName = inner.slice(0, commaIdx).trim();
        const rest = inner.slice(commaIdx + 1);
        const nextCommaIdx = rest.indexOf(',');
        const formatType = (nextCommaIdx !== -1 ? rest.slice(0, nextCommaIdx) : rest).trim();

        if (/^[a-zA-Z0-9_]+$/.test(argName) && formatType) {
          tokens.push(`{${argName}}`);

          if (ICU_CLAUSE_FORMAT_TYPES.has(formatType)) {
            tokens.push(formatType);
            const styleAndClauses = nextCommaIdx !== -1 ? rest.slice(nextCommaIdx + 1) : '';

            const offsetMatch = styleAndClauses.match(/offset:\s*-?\d+/);
            if (offsetMatch) {
              tokens.push(offsetMatch[0].replace(/\s+/g, ''));
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
      } else if (/^[a-zA-Z0-9_-]+$/.test(inner.trim())) {
        tokens.push(`{${inner.trim()}}`);
      } else {
        tokens.push(...extractBraceTokens(inner, false));
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
 * Checks if target translation preserves all format placeholders present in source
 */
export function validatePlaceholders(source: string, target: string): PlaceholderValidation {
  const sourceTokens = extractPlaceholders(source);
  const targetTokens = extractPlaceholders(target);

  // Note: checked against the extracted target tokens rather than a raw substring
  // search of `target`, since ICU MessageFormat tokens (e.g. the `{count}` token
  // representing the `count` variable in `{count, plural, ...}`) are synthesized
  // from the parsed structure and aren't necessarily a literal substring of the
  // original ICU text.
  const missingInTarget = sourceTokens.filter((token) => !targetTokens.includes(token));
  const extraInTarget = targetTokens.filter((token) => !sourceTokens.includes(token));

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
 * Checks a single (source, target) pair for Android XML QA issues
 */
function validateSourceTargetPair(
  itemId: string,
  itemName: string,
  source: string,
  target: string,
  subKey?: string
): QaIssue[] {
  if (!target || !target.trim()) {
    return [];
  }

  const issues: QaIssue[] = [];
  const prefix = subKey ? `[${subKey}] ` : '';

  // 1. Placeholder checks (%s, %d, %1$s, {0}, etc.)
  const sourceFormatCounts = extractFormatTokensWithCounts(source);
  const targetFormatCounts = extractFormatTokensWithCounts(target);

  const missingPlaceholders: string[] = [];
  for (const [token, srcCount] of sourceFormatCounts.entries()) {
    const tgtCount = targetFormatCounts.get(token) || 0;
    if (tgtCount < srcCount) {
      missingPlaceholders.push(token);
    }
  }

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

  const extraPlaceholders: string[] = [];
  for (const [token, tgtCount] of targetFormatCounts.entries()) {
    const srcCount = sourceFormatCounts.get(token) || 0;
    if (tgtCount > srcCount) {
      extraPlaceholders.push(token);
    }
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
 * Runs QA checks on a single ResourceItem (string, plural, or array)
 */
export function getItemQaIssues(item: ResourceItem): QaIssue[] {
  if (!item) return [];
  if (item.type === 'string') {
    return validateSourceTargetPair(item.id, item.name, item.source || '', item.target || '');
  }
  if (item.type === 'plural') {
    const all: QaIssue[] = [];
    for (const q of item.items || []) {
      all.push(
        ...validateSourceTargetPair(item.id, item.name, q.source || '', q.target || '', q.quantity)
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
          `#${(el.index ?? 0) + 1}`
        )
      );
    }
    return all;
  }
  return [];
}

/** Only the line-break errors of an item: a translation with a different number of line breaks cannot be saved. */
export function getLineBreakIssues(item: ResourceItem): QaIssue[] {
  return getItemQaIssues(item).filter((i) => i.id.endsWith('_linebreaks'));
}

const itemQaCache = new Map<string, ItemQaResult | null>();

function getItemCacheKey(item: ResourceItem): string {
  if (item.type === 'string') {
    return `${item.id}_${item.name}_${item.source || ''}_${item.target || ''}`;
  }
  if (item.type === 'plural') {
    const sub = (item.items || []).map((q) => `${q.quantity}:${q.source || ''}:${q.target || ''}`).join('|');
    return `${item.id}_${item.name}_p_${sub}`;
  }
  if (item.type === 'array') {
    const sub = (item.items || []).map((el) => `${el.index}:${el.source || ''}:${el.target || ''}`).join('|');
    return `${item.id}_${item.name}_a_${sub}`;
  }
  return '';
}

/**
 * Runs QA checks across all items in the project and returns a summary + lookup map
 */
export function analyzeProjectQa(items: ResourceItem[]): {
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
    const cacheKey = getItemCacheKey(item);
    let cachedResult = itemQaCache.get(cacheKey);

    if (cachedResult === undefined) {
      const issues = getItemQaIssues(item);
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

