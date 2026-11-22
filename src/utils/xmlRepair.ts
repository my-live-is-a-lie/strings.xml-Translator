import { parseAndroidXml, ParsedXmlResult } from './xmlParser';

/**
 * Phase 1 of the import-repair system (see issue #25): a pre-pass that runs before
 * `parseAndroidXml` on a freshly-imported file. It fixes what's purely mechanical and
 * can never change a string's meaning, flags anything that needs a human decision, and
 * reports anything it can't safely import — instead of today's all-or-nothing behavior,
 * where a single malformed tag anywhere in the file fails the whole import with a raw
 * parser error.
 *
 * Deliberately out of scope for this first pass (tracked as follow-up work in #25):
 * ICU-grammar-level checks (unbalanced `{}`, a missing mandatory `other` branch, a
 * misspelled `plural`/`select` keyword, an unterminated ICU quote, mixed placeholder
 * systems) and surgically excluding just one broken `<string>` instead of failing the
 * whole file. Those need a real ICU-aware checker and are a separate, focused change.
 */

export type RepairTier = 'silent' | 'review' | 'blocking';

export interface RepairIssue {
  /** Unique within one RepairResult (for React keys); not meant to be shown to the user. */
  id: string;
  tier: RepairTier;
  /** Short machine-readable category, e.g. 'bom', 'unescaped-apostrophe', 'xml-parse-error'. */
  category: string;
  /** Human-readable description of what was found (and, for silent fixes, what was done). English only — this
   *  is a technical fallback. The UI localizes by `category` + `params` instead of showing this directly. */
  message: string;
  /** The `<string name="...">` this issue belongs to, when it's about one specific entry. */
  stringName?: string;
  /** Structured data the UI needs to render a localized message (e.g. a count), kept apart from `message`
   *  so the UI never has to parse an English sentence to translate it. */
  params?: Record<string, number | string>;
}

export interface RepairResult {
  /** The text to hand to `parseAndroidXml` — with every silent fix already applied. */
  fixedXml: string;
  /** `parseAndroidXml(fixedXml)`, computed once here so the caller doesn't have to parse the file a second time. */
  parsed: ParsedXmlResult;
  /** Applied automatically; nothing here could have changed a string's rendered meaning. */
  silentFixes: RepairIssue[];
  /** Not applied. The file still imports; each of these needs a human decision. */
  reviewIssues: RepairIssue[];
  /** The file (or, once per-entry exclusion ships, the specific entry) could not be imported. */
  blockingIssues: RepairIssue[];
}

type IssueFactory = (
  tier: RepairTier,
  category: string,
  message: string,
  stringName?: string,
  params?: Record<string, number | string>
) => RepairIssue;

// Ids only need to be unique inside one result, so the counter lives per call instead of at module level.
function createIssueFactory(): IssueFactory {
  let seq = 0;
  return (tier, category, message, stringName, params) => {
    seq += 1;
    return { id: `repair_${seq}`, tier, category, message, stringName, params };
  };
}

// Only U+200B (zero-width space) and a stray mid-file U+FEFF are copy/paste artifacts. U+200C (ZWNJ) and
// U+200D (ZWJ) carry meaning — Persian/Urdu/Indic spelling and emoji sequences such as 👨‍👩‍👧 depend on them,
// and the editor itself offers buttons to insert them — so they must never be stripped silently.
const STRAY_INVISIBLE_CHARS = /[\u200B\uFEFF]/g;

// Regions whose content must stay byte-for-byte untouched: inside comments and CDATA a raw `&` is legal
// (escaping it there would change the text), and the DOCTYPE holds entity declarations.
const PROTECTED_REGION = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>/g;

// Either a complete entity/char reference (`&name;`, `&#38;`, `&#x26;`) or a lone `&`.
const AMPERSAND_OR_REFERENCE = /&(?:([A-Za-z_:][\w.:-]*)|#\d+|#x[0-9a-fA-F]+);|&/g;

const XML_PREDEFINED_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

// HTML named entities people paste into strings.xml. XML doesn't know them, so the file would fail to parse;
// the numeric reference renders exactly the same character, so this rewrite can't change the meaning.
const HTML_ENTITY_CODEPOINTS: Record<string, number> = {
  nbsp: 0xa0, copy: 0xa9, reg: 0xae, trade: 0x2122, hellip: 0x2026, mdash: 0x2014, ndash: 0x2013,
  laquo: 0xab, raquo: 0xbb, lsquo: 0x2018, rsquo: 0x2019, ldquo: 0x201c, rdquo: 0x201d,
  bull: 0x2022, middot: 0xb7, euro: 0x20ac, deg: 0xb0, times: 0xd7,
};

const STRING_BODY = /<string\s+[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*(?<!\/)>([\s\S]*?)<\/string>/g;
const XML_COMMENT = /<!--[\s\S]*?-->/g;
const INLINE_TAG = /<[^>]*>/g;

/** Runs `fn` on every part of `text` that isn't a comment, CDATA section or DOCTYPE. */
function mapOutsideProtected(text: string, fn: (chunk: string) => string): string {
  const region = new RegExp(PROTECTED_REGION.source, 'g');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = region.exec(text)) !== null) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

/** Counts apostrophes not escaped by an odd number of backslashes (`\'` is escaped, `\\'` is not). */
function countUnescapedApostrophes(body: string): number {
  let count = 0;
  for (const m of body.replace(INLINE_TAG, '').matchAll(/(\\*)'/g)) {
    if (m[1].length % 2 === 0) count += 1;
  }
  return count;
}

export interface SilentFixResult {
  text: string;
  silentFixes: RepairIssue[];
  /** Named entities that are neither XML-predefined, declared in the DOCTYPE, nor a known HTML entity. */
  undefinedEntities: string[];
}

/**
 * Only the mechanical, meaning-preserving part of the repair. Exported separately so a second file (e.g. an
 * existing target translation that gets merged in) can get the same clean-up without a report screen.
 */
export function applySilentFixes(raw: string, issue: IssueFactory = createIssueFactory()): SilentFixResult {
  const silentFixes: RepairIssue[] = [];
  let text = raw;

  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    silentFixes.push(issue('silent', 'bom', 'Removed a byte-order-mark (BOM) at the start of the file.'));
  }

  const strayCount = (text.match(STRAY_INVISIBLE_CHARS) || []).length;
  if (strayCount > 0) {
    text = text.replace(STRAY_INVISIBLE_CHARS, '');
    silentFixes.push(
      issue(
        'silent',
        'zero-width-chars',
        `Removed ${strayCount} invisible zero-width space character(s) (likely pasted in by accident).`,
        undefined,
        { count: strayCount }
      )
    );
  }

  const crlfCount = (text.match(/\r\n|\r/g) || []).length;
  if (crlfCount > 0) {
    text = text.replace(/\r\n|\r/g, '\n');
    silentFixes.push(
      issue(
        'silent',
        'line-endings',
        `Normalized ${crlfCount} Windows/old-Mac line ending(s) to plain \\n.`,
        undefined,
        { count: crlfCount }
      )
    );
  }

  const declaredEntities = new Set(Array.from(text.matchAll(/<!ENTITY\s+([A-Za-z_:][\w.:-]*)\s/g), (m) => m[1]));
  let bareAmpersandCount = 0;
  let htmlEntityCount = 0;
  const undefinedEntities = new Set<string>();

  text = mapOutsideProtected(text, (chunk) =>
    chunk.replace(AMPERSAND_OR_REFERENCE, (whole: string, name: string | undefined) => {
      if (whole === '&') {
        bareAmpersandCount += 1;
        return '&amp;';
      }
      if (name === undefined || XML_PREDEFINED_ENTITIES.has(name) || declaredEntities.has(name)) return whole;
      const codePoint = HTML_ENTITY_CODEPOINTS[name];
      if (codePoint !== undefined) {
        htmlEntityCount += 1;
        return `&#${codePoint};`;
      }
      undefinedEntities.add(name);
      return whole;
    })
  );

  if (bareAmpersandCount > 0) {
    silentFixes.push(
      issue(
        'silent',
        'bare-ampersand',
        `Escaped ${bareAmpersandCount} unescaped "&" character(s) as "&amp;".`,
        undefined,
        { count: bareAmpersandCount }
      )
    );
  }
  if (htmlEntityCount > 0) {
    silentFixes.push(
      issue(
        'silent',
        'html-entity',
        `Rewrote ${htmlEntityCount} HTML entity reference(s) (e.g. "&nbsp;") as equivalent numeric references.`,
        undefined,
        { count: htmlEntityCount }
      )
    );
  }

  return { text, silentFixes, undefinedEntities: [...undefinedEntities] };
}

export function repairAndroidXml(raw: string): RepairResult {
  const issue = createIssueFactory();
  const { text, silentFixes, undefinedEntities } = applySilentFixes(raw, issue);

  const reviewIssues: RepairIssue[] = [];
  const blockingIssues: RepairIssue[] = [];

  // Review: an Android resource value with a raw apostrophe that isn't backslash-escaped and
  // isn't a whole value wrapped in double quotes. This can be perfectly valid ICU (a balanced
  // quote span), so it isn't "broken" — but it's an aapt build risk, and a quoted
  // "'{placeholder}'" silently stops substituting that placeholder, which is rarely intended.
  // Commented-out entries are skipped: they're not resources and would otherwise show up as duplicates.
  const scannable = text.replace(XML_COMMENT, '');
  const seenNames = new Map<string, number>();
  for (const match of scannable.matchAll(STRING_BODY)) {
    const [, name, body] = match;
    seenNames.set(name, (seenNames.get(name) || 0) + 1);

    const trimmed = body.trim();
    const wholeValueDoubleQuoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
    if (!wholeValueDoubleQuoted) {
      const unescapedApostrophes = countUnescapedApostrophes(body);
      if (unescapedApostrophes > 0) {
        reviewIssues.push(
          issue(
            'review',
            'unescaped-apostrophe',
            `Contains ${unescapedApostrophes} raw apostrophe character(s) that aren't backslash-escaped. ` +
              `This may be valid ICU quoting, but it can also silently swallow a placeholder as literal text, ` +
              `and raw Android builds require "\\'" or the whole value in double quotes.`,
            name,
            { count: unescapedApostrophes }
          )
        );
      }
    }
  }

  for (const [name, count] of seenNames) {
    if (count > 1) {
      reviewIssues.push(
        issue('review', 'duplicate-name', `"${name}" is used by ${count} different <string> entries.`, name, {
          count,
        })
      );
    }
  }

  // Blocking: anything parseAndroidXml itself can't make sense of. Today that fails the whole
  // file rather than just the one broken entry (tracked as follow-up work in #25).
  if (undefinedEntities.length > 0) {
    const names = undefinedEntities.map((n) => `&${n};`).join(', ');
    blockingIssues.push(
      issue('blocking', 'undefined-entity', `Uses entity reference(s) that XML doesn't define: ${names}.`, undefined, {
        names,
      })
    );
  }

  const parsed = parseAndroidXml(text);
  for (const message of parsed.errors) {
    blockingIssues.push(issue('blocking', 'xml-parse-error', message));
  }
  // A well-formed file with nothing importable (e.g. an empty <resources/>) would otherwise pass every check,
  // show the report, and then fail only after the user clicks Continue.
  if (parsed.errors.length === 0 && parsed.items.length === 0) {
    blockingIssues.push(issue('blocking', 'no-strings', 'Could not parse any strings from this XML.'));
  }

  return { fixedXml: text, parsed, silentFixes, reviewIssues, blockingIssues };
}
