import { ResourceItem } from '../types';

/**
 * Extracts Android string format specifiers and HTML tags
 * Matches: %s, %d, %1$s, %2$d, %1.2f, {0}, <b>, </b>, etc.
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

  // ICU / bracket placeholders like {0}, {count}, {username}
  const bracketRegex = /\{[a-zA-Z0-9_-]+\}/g;
  const bracketMatches = text.match(bracketRegex);
  if (bracketMatches) {
    found.push(...bracketMatches);
  }

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

  const missingInTarget = sourceTokens.filter((token) => !target.includes(token));
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
const BRACKET_PLACEHOLDER_REGEX = /\{[a-zA-Z0-9_-]+\}/g;
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
  const bracketMatches = text.match(BRACKET_PLACEHOLDER_REGEX) || [];

  for (const token of [...printfMatches, ...bracketMatches]) {
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

  // 1. Check for broken/unclosed '<' or '>' brackets when tags are attempted
  // Strip valid XML entities &lt; and &gt; first
  const cleanTarget = target.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '');
  const tagRegex = /<\/?([a-zA-Z0-9:_-]+)(?:\s+[^>]*)?\s*(\/?)>/g;

  // Check if there is a '<' that looks like an unclosed tag (e.g. "<b" without ">")
  const strippedValidTags = cleanTarget.replace(tagRegex, '');
  if (/<[a-zA-Z\/]/.test(strippedValidTags)) {
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
  const cleanSource = source.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '');
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

  return issues;
}

/**
 * Runs QA checks on a single ResourceItem (string, plural, or array)
 */
export function getItemQaIssues(item: ResourceItem): QaIssue[] {
  if (item.type === 'string') {
    return validateSourceTargetPair(item.id, item.name, item.source, item.target);
  }
  if (item.type === 'plural') {
    const all: QaIssue[] = [];
    for (const q of item.items) {
      all.push(
        ...validateSourceTargetPair(item.id, item.name, q.source, q.target, q.quantity)
      );
    }
    return all;
  }
  if (item.type === 'array') {
    const all: QaIssue[] = [];
    for (const el of item.items) {
      all.push(
        ...validateSourceTargetPair(
          item.id,
          item.name,
          el.source,
          el.target,
          `#${el.index + 1}`
        )
      );
    }
    return all;
  }
  return [];
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

  for (const item of items) {
    const issues = getItemQaIssues(item);
    if (issues.length > 0) {
      const hasPlaceholderIssue = issues.some((i) => i.category === 'placeholder');
      const hasHtmlIssue = issues.some((i) => i.category === 'html');
      const hasFormattingIssue = issues.some((i) => i.category === 'formatting');

      if (hasPlaceholderIssue) placeholderIssueItemsCount++;
      if (hasHtmlIssue) htmlIssueItemsCount++;

      const result: ItemQaResult = {
        itemId: item.id,
        itemName: item.name,
        issues,
        hasPlaceholderIssue,
        hasHtmlIssue,
        hasFormattingIssue,
      };
      allIssues.push(...issues);
      itemResults.push(result);
      byItemId.set(item.id, result);
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

