import { parseAndroidXml, ParsedXmlResult } from './xmlParser';

/**
 * The import-repair system (see issue #25): a pre-pass that runs before `parseAndroidXml` on a
 * freshly-imported file. It fixes what's purely mechanical and can never change a string's
 * meaning, flags anything that needs a human decision, and reports anything it can't safely
 * import — instead of today's all-or-nothing behavior, where a single malformed tag anywhere in
 * the file fails the whole import with a raw parser error.
 *
 * `repairAndroidXml` does the detection (Phase 1): it never writes a review issue's proposed fix
 * into `fixedXml` on its own. `applyReviewDecisions` (Phase 2) applies only the specific review
 * issues the caller names, by id, once a person has actually chosen to accept each one on the
 * Import Report — so nothing that could change a string's meaning is ever applied without an
 * explicit, per-item decision.
 *
 * Deliberately out of scope so far (tracked as follow-up work in #25):
 * ICU-grammar-level checks (unbalanced `{}`, a missing mandatory `other` branch, a
 * misspelled `plural`/`select` keyword, an unterminated ICU quote, mixed placeholder
 * systems) and surgically excluding just one broken `<string>` instead of failing the
 * whole file. Those need a real ICU-aware checker and are a separate, focused change (Phase 3).
 * A duplicate resource name is detected but has no safe fix to propose (renaming or merging one
 * of them isn't a decision this tool can make), so it stays informational-only for now.
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
  /** The resource's own `name` attribute this issue belongs to (a `<string>`, `<plurals>` or `<string-array>`). */
  stringName?: string;
  /** Which kind of resource `stringName` names. Review/blocking issues about a `<string>` omit this. */
  resourceType?: 'string' | 'plural' | 'array';
  /** Which `<item>` of a plural/array resource this is about: the quantity ('one', 'other', ...) for a
   *  plural, or the zero-based index for an array. Omitted for a plain `<string>` or a whole-resource issue
   *  (e.g. duplicate-name, which is about the resource, not one item). */
  itemQualifier?: string;
  /** Structured data the UI needs to render a localized message (e.g. a count), kept apart from `message`
   *  so the UI never has to parse an English sentence to translate it. */
  params?: Record<string, number | string>;
  /**
   * A review issue the user can act on gets both of these: `range` locates the exact slice of `fixedXml`
   * this issue is about (the resource's or item's inner body, computed once up front so a decision made
   * later doesn't need to re-find it in possibly-duplicated text), and `suggestedFix` is the text to put
   * there if the user accepts it. A review issue with no safe fix to propose (e.g. duplicate-name) omits
   * both — it's informational only; see `applyReviewDecisions`.
   */
  range?: { start: number; end: number };
  suggestedFix?: string;
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

type IssueExtras = Pick<RepairIssue, 'resourceType' | 'itemQualifier' | 'params' | 'range' | 'suggestedFix'>;
type IssueFactory = (
  tier: RepairTier,
  category: string,
  message: string,
  stringName?: string,
  extras?: Partial<IssueExtras>
) => RepairIssue;

// Ids only need to be unique inside one result, so the counter lives per call instead of at module level.
function createIssueFactory(): IssueFactory {
  let seq = 0;
  return (tier, category, message, stringName, extras) => {
    seq += 1;
    return { id: `repair_${seq}`, tier, category, message, stringName, ...extras };
  };
}

// Only U+200B (zero-width space) and a stray mid-file U+FEFF are copy/paste artifacts. U+200C (ZWNJ) and
// U+200D (ZWJ) carry meaning — Persian/Urdu/Indic spelling and emoji sequences such as 👨‍👩‍👧 depend on them,
// and the editor itself offers buttons to insert them — so they must never be stripped silently.
//
// U+200B itself isn't always a stray paste either: it's the standard word separator in Thai, Khmer and
// Burmese text, which is written without spaces between words. Stripping it there would merge two words.
// strings.xml source text is close to always English, so the risk is low in practice — but a project whose
// *source* strings are themselves in one of those scripts is the case this silent fix would get wrong. Not
// handled here (it would need real script detection, not just a character blocklist); tracked as a known
// limitation in issue #25 rather than guessed at.
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

// The 'd' flag (match.indices) lets a caller locate group 2 (or 1) in the original text precisely, instead
// of re-deriving it from match.index + surrounding tag lengths — needed so a later, user-approved fix can
// replace exactly that span even if the same text happens to appear elsewhere in the file.
// The `(?<!\/)` guard keeps a self-closed tag (`<string name="a"/>`, `<plurals name="a"/>`) from matching
// as an opening tag: without it the block would run on to the *next* close tag, attributing that resource's
// items to the self-closed name and hiding the real resource from duplicate counting.
const STRING_BODY = /<string\s+[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*(?<!\/)>([\s\S]*?)<\/string>/gd;
const PLURALS_BLOCK = /<plurals\s+[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*(?<!\/)>([\s\S]*?)<\/plurals>/gd;
const STRING_ARRAY_BLOCK = /<string-array\s+[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*(?<!\/)>([\s\S]*?)<\/string-array>/gd;
const PLURAL_ITEM = /<item\s+[^>]*?\bquantity\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/item>/gd;
const ARRAY_ITEM = /<item\b[^>]*>([\s\S]*?)<\/item>/gd;
const XML_COMMENT = /<!--[\s\S]*?-->/g;
// Known edge case: a CDATA section also matches this pattern, since `<![CDATA[` looks like the start of a
// tag. An apostrophe inside CDATA is therefore checked only when the CDATA content itself contains a `>`
// (which ends the "tag" early), and then only the part after that `>`. CDATA is rare in strings.xml and
// the scanner only ever *adds* a review note, never rewrites on its own, so this is documented rather than
// special-cased.
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

/** Runs `fn` on every part of `text` that isn't an inline markup tag (e.g. `<a href='...'>`), leaving tags
 *  (and whatever they hold, like a quoted attribute) untouched — an apostrophe used as markup syntax there
 *  isn't a translator's typo and must never be "fixed". */
function mapOutsideInlineTags(text: string, fn: (chunk: string) => string): string {
  const tag = new RegExp(INLINE_TAG.source, 'g');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text)) !== null) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

/** Escapes each apostrophe not already escaped by an odd number of backslashes (`\'` is escaped, `\\'` is
 *  not), outside inline markup tags. Returns both the count (for the review message) and the fixed text
 *  (the candidate `suggestedFix`), from one pass, so the two can never disagree with each other. */
function escapeUnescapedApostrophes(body: string): { count: number; fixed: string } {
  let count = 0;
  const fixed = mapOutsideInlineTags(body, (chunk) => {
    let out = '';
    let backslashRun = 0;
    for (const ch of chunk) {
      if (ch === '\\') {
        backslashRun += 1;
        out += ch;
        continue;
      }
      if (ch === "'" && backslashRun % 2 === 0) {
        out += "\\'";
        count += 1;
      } else {
        out += ch;
      }
      backslashRun = 0;
    }
    return out;
  });
  return { count, fixed };
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
        { params: { count: strayCount } }
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
        { params: { count: crlfCount } }
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
        { params: { count: bareAmpersandCount } }
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
        { params: { count: htmlEntityCount } }
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

  // Review: an Android resource value with a raw apostrophe that isn't backslash-escaped and isn't a whole
  // value wrapped in double quotes. This can be perfectly valid ICU (a balanced quote span), so it isn't
  // "broken" — but it's an aapt build risk, and a quoted "'{placeholder}'" silently stops substituting that
  // placeholder, which is rarely intended. Checked for a plain <string> and for each <item> of a <plurals>
  // or <string-array>, since those hold translatable values the same way.
  //
  // Known gap, not yet verified against a real Android build: this only looks for a literal `'` character.
  // `&apos;` and `&#39;` both decode to the same apostrophe and are left untouched here (the former is an
  // XML-predefined entity, the latter a valid numeric reference, so neither trips the silent fixes either).
  // If aapt2's string-resource compiler applies its apostrophe rule to the *decoded* value — plausible, but
  // not something we can test without an actual Android build — those two forms hit the exact same risk and
  // currently go unflagged. Tracked in issue #25 pending that verification.
  //
  // Commented-out entries are skipped throughout — they're not resources and would otherwise show up as
  // duplicates or get a "fix" written into dead text. Structure is matched on `scannable`: a copy of `text`
  // with every comment blanked out by spaces of the same length (newlines kept). Offsets are therefore
  // identical to `text`, so `range` stays an exact offset for a later surgical fix — but, unlike skipping
  // matches that *start* inside a comment, this also (a) skips an `<item>` commented out inside a live
  // `<plurals>`/`<string-array>`, and (b) stops a match that starts inside a comment (e.g. an unclosed
  // `<!-- <string name="old">...  -->`) from running on and swallowing the real resource that follows.
  // Bodies are always read back from `text`, so a comment inside a value survives byte-for-byte.
  const scannable = text.replace(XML_COMMENT, (comment) => comment.replace(/[^\n]/g, ' '));

  function checkApostrophes(name: string, body: string, bodyStart: number, extras: Partial<IssueExtras> = {}) {
    const trimmed = body.trim();
    const wholeValueDoubleQuoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
    if (wholeValueDoubleQuoted) return;
    const { count, fixed } = escapeUnescapedApostrophes(body);
    if (count === 0) return;
    reviewIssues.push(
      issue(
        'review',
        'unescaped-apostrophe',
        `Contains ${count} raw apostrophe character(s) that aren't backslash-escaped. ` +
          `This may be valid ICU quoting, but it can also silently swallow a placeholder as literal text, ` +
          `and raw Android builds require "\\'" or the whole value in double quotes.`,
        name,
        { ...extras, params: { count }, range: { start: bodyStart, end: bodyStart + body.length }, suggestedFix: fixed }
      )
    );
  }

  function reportDuplicates(seenNames: Map<string, number>, resourceType: RepairIssue['resourceType'], noun: string) {
    for (const [name, count] of seenNames) {
      if (count > 1) {
        reviewIssues.push(
          issue('review', 'duplicate-name', `"${name}" is used by ${count} different ${noun} entries.`, name, {
            resourceType,
            params: { count },
          })
        );
      }
    }
  }

  // <string name="...">body</string>
  const seenStringNames = new Map<string, number>();
  for (const match of scannable.matchAll(STRING_BODY)) {
    const name = match[1];
    seenStringNames.set(name, (seenStringNames.get(name) || 0) + 1);
    const [bodyStart, bodyEnd] = match.indices![2];
    checkApostrophes(name, text.slice(bodyStart, bodyEnd), bodyStart, { resourceType: 'string' });
  }
  reportDuplicates(seenStringNames, 'string', '<string>');

  // <plurals name="...">...<item quantity="...">body</item>...</plurals>
  const seenPluralNames = new Map<string, number>();
  for (const block of scannable.matchAll(PLURALS_BLOCK)) {
    const [, name, blockBody] = block;
    seenPluralNames.set(name, (seenPluralNames.get(name) || 0) + 1);
    const blockBodyStart = block.indices![2][0];
    for (const item of blockBody.matchAll(PLURAL_ITEM)) {
      const quantity = item[1];
      const bodyStart = blockBodyStart + item.indices![2][0];
      const bodyEnd = blockBodyStart + item.indices![2][1];
      checkApostrophes(name, text.slice(bodyStart, bodyEnd), bodyStart, { resourceType: 'plural', itemQualifier: quantity });
    }
  }
  reportDuplicates(seenPluralNames, 'plural', '<plurals>');

  // <string-array name="...">...<item>body</item>...</string-array>
  const seenArrayNames = new Map<string, number>();
  for (const block of scannable.matchAll(STRING_ARRAY_BLOCK)) {
    const [, name, blockBody] = block;
    seenArrayNames.set(name, (seenArrayNames.get(name) || 0) + 1);
    const blockBodyStart = block.indices![2][0];
    let index = 0;
    for (const item of blockBody.matchAll(ARRAY_ITEM)) {
      const bodyStart = blockBodyStart + item.indices![1][0];
      const bodyEnd = blockBodyStart + item.indices![1][1];
      checkApostrophes(name, text.slice(bodyStart, bodyEnd), bodyStart, { resourceType: 'array', itemQualifier: String(index) });
      index += 1;
    }
  }
  reportDuplicates(seenArrayNames, 'array', '<string-array>');

  // Blocking: anything parseAndroidXml itself can't make sense of. Today that fails the whole
  // file rather than just the one broken entry (tracked as follow-up work in #25).
  if (undefinedEntities.length > 0) {
    const names = undefinedEntities.map((n) => `&${n};`).join(', ');
    blockingIssues.push(
      issue(
        'blocking',
        'undefined-entity',
        `Uses entity reference(s) that XML doesn't define: ${names}.`,
        undefined,
        { params: { names } }
      )
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

/** A review issue the user can accept on the Import Report: it has both a `range` and a `suggestedFix`. Shared by
 *  `applyReviewDecisions` and the UI, so what counts as "fixable" can never drift between the two. */
export type FixableRepairIssue = RepairIssue & { range: { start: number; end: number }; suggestedFix: string };

export function isFixableIssue(issue: RepairIssue): issue is FixableRepairIssue {
  return issue.range !== undefined && issue.suggestedFix !== undefined;
}

/**
 * Phase 2 of issue #25: applies the subset of `reviewIssues` the user accepted (by `id`, from the Import
 * Report) on top of `fixedXml`, and leaves every other review issue's text exactly as it was — nothing is
 * ever applied without an explicit, per-item decision. Only an issue with both `range` and `suggestedFix`
 * (today, just `unescaped-apostrophe`) can be accepted this way; an id for anything else (or one not found
 * at all) is silently ignored, since there is no safe automatic fix to apply for it yet.
 *
 * Returns `fixedXml` unchanged (the identical string, by reference) when `acceptedIds` accepts nothing, so a
 * caller can cheaply tell "nothing changed" apart from "something changed" with `===` and skip re-parsing.
 *
 * Defensive: a range that is out of bounds, inverted, or overlaps one already applied is skipped instead of
 * spliced in. `repairAndroidXml` never produces such a range today, but a wrong splice would silently corrupt
 * the file, so it's cheaper to guard here than to debug later.
 */
export function applyReviewDecisions(fixedXml: string, reviewIssues: RepairIssue[], acceptedIds: ReadonlySet<string>): string {
  const accepted = reviewIssues
    .filter((i): i is FixableRepairIssue => isFixableIssue(i) && acceptedIds.has(i.id))
    .sort((a, b) => b.range.start - a.range.start); // descending, so each replace leaves earlier offsets valid

  if (accepted.length === 0) return fixedXml;

  let out = fixedXml;
  let appliedFrom = fixedXml.length; // start of the lowest range applied so far
  for (const i of accepted) {
    const { start, end } = i.range;
    if (start < 0 || start > end || end > appliedFrom) continue;
    out = out.slice(0, start) + i.suggestedFix + out.slice(end);
    appliedFrom = start;
  }
  return out;
}
