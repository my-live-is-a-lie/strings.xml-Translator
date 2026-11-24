import { parseAndroidXml, ParsedXmlResult } from './xmlParser';
import { extractBraceTokens, hasUnterminatedIcuQuote } from './placeholderCheck';
import { findIcuFindings, IcuFinding } from './icuSourceChecks';

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
 * explicit, per-item decision. Phase 3 adds partial import: a single malformed `<string>`,
 * `<plurals>` or `<string-array>` (unclosed, mismatched, or missing its `name` attribute) is
 * excluded and reported, instead of failing the whole file — see `excludeMalformedEntries`.
 *
 * Issue #33 (phase 4) adds ICU-level checks on each `<string>` / `<string-array>` value (never on `<plurals>`
 * quantity bodies), always on the Android-decoded text: an unterminated ICU quote, unbalanced braces in a clearly
 * ICU block and a misspelled `plural`/`select` keyword are blocking (the entry is excluded); a missing `other`
 * branch, a repeated clause key, a lone `{`, a doubtful keyword and mixed printf/`{name}` placeholders are review
 * (informational). The optional translation file merged at import time gets the same checks, review-only, and is
 * never excluded or edited (see `checkTargetFileIcu`). Still out of scope: a bare `<`/`>` inside a value. That
 * needs a real tolerant-XML checker, which is a different kind of tool than the text-level
 * heuristics here, and are tracked as a further phase. A duplicate resource name is detected but
 * has no safe fix to propose (renaming or merging one of them isn't a decision this tool can
 * make), so it stays informational-only for now.
 */

/**
 * `blocking` covers both whole-file failures and entries the Import Report lists as not imported.
 * In particular, `missing-name` is blocking for reporting, not a new import restriction: the parser
 * already skipped nameless entries silently. Use `isEntryExclusion` to distinguish these entry-level
 * issues from failures that must reject the whole file.
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

/**
 * The single source linking each resource tag (`<string>`, `<plurals>`, `<string-array>`) to its
 * resource kind. `excludeMalformedEntries` reads it directly, and `RESOURCE_TAG_BY_TYPE` below is
 * derived from it, so the two directions can never drift apart.
 *
 * Adding a kind here is not enough on its own: the tag-scanning regexes (`RESOURCE_TAG_START` and
 * `SIBLING_RESOURCE_TAG_START`) and the per-kind body/block patterns still name the tags by hand.
 */
export const RESOURCE_TYPE_BY_TAG: Record<string, NonNullable<RepairIssue['resourceType']>> = {
  string: 'string',
  plurals: 'plural',
  'string-array': 'array',
};

/** The inverse of `RESOURCE_TYPE_BY_TAG` (resource kind → tag word), used for localized messages. */
export const RESOURCE_TAG_BY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(RESOURCE_TYPE_BY_TAG).map(([tag, resourceType]) => [resourceType, tag])
);

export interface RepairResult {
  /** The text to hand to `parseAndroidXml` — with every silent fix already applied. */
  fixedXml: string;
  /** `parseAndroidXml(fixedXml)`, computed once here so the caller doesn't have to parse the file a second time. */
  parsed: ParsedXmlResult;
  /** Applied automatically; nothing here could have changed a string's rendered meaning. */
  silentFixes: RepairIssue[];
  /** Not applied. The file still imports; each of these needs a human decision. */
  reviewIssues: RepairIssue[];
  /** The file could not be imported, or a specific entry was excluded during partial import. */
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

// Phase 3 (partial import): a resource tag that's self-closed (`<string name="a"/>`) is complete and valid
// on its own (an empty value), regardless of whether it has a `name`.
//
// Every Phase 3 pattern below ends the tag name with `(?![\w-])` instead of `\b`: there *is* a word boundary
// between `g` and `-`, so `<string\b` also matches the start of `<string-array`, and `(string|…)\b` captures
// `string` for a `<string-array>` tag. The `-` must count as part of the tag name.
const SELF_CLOSED_RESOURCE = /<(?:string-array|string|plurals)(?![\w-])[^>]*\/>/gd;
// The same three resource blocks as above, but for a tag whose opening tag has *no* `name` attribute at all
// (Android silently drops these — see parseDomTree's `if (!name) continue`). The tempered-greedy group
// `(?:(?!\bname\s*=)[^>])*` consumes attribute characters one at a time, refusing to advance past any
// position where `name\s*=` would start — so the overall match fails outright if a `name=` appears anywhere
// before the tag's `>`, exactly mirroring how STRING_BODY etc. require one.
const NAMELESS_STRING_BODY = /<string(?![\w-])((?:(?!\bname\s*=)[^>])*)(?<!\/)>([\s\S]*?)<\/string>/gd;
const NAMELESS_PLURALS_BLOCK = /<plurals(?![\w-])((?:(?!\bname\s*=)[^>])*)(?<!\/)>([\s\S]*?)<\/plurals>/gd;
const NAMELESS_STRING_ARRAY_BLOCK = /<string-array(?![\w-])((?:(?!\bname\s*=)[^>])*)(?<!\/)>([\s\S]*?)<\/string-array>/gd;
// Any top-level resource opening tag, named or not, self-closed or not — used to find every candidate and
// to locate "the next one" as an excision boundary for a dangling (unclosed/mismatched) tag. `string-array`
// is listed first so the capture group names the real tag (see the `(?![\w-])` note above).
const RESOURCE_TAG_START = /<(string-array|string|plurals)(?![\w-])/gd;
const RESOURCES_CLOSE = /<\/resources>/;
// Comments and CDATA sections, whichever starts first. Their content is never structure: CDATA in particular
// can legally hold literal markup such as `<string>` (common for HTML-formatted values).
const STRUCTURALLY_INERT = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;
// A comment that starts its own line (only indentation before it). Used as an excision boundary: such a
// comment almost always describes the *next* resource (parseDomTree attaches it as that item's `comment`).
const LINE_START_COMMENT = /^[ \t]*<!--/gm;
// A loose, best-effort scrape of a `name="..."` attribute from an excised chunk of text, just to label a
// blocking issue with the resource's name when one is present — not used for anything structural.
const LOOSE_NAME_ATTR = /\bname\s*=\s*["']([^"']+)["']/;
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

/** A copy of `text` with every comment's content blanked out by spaces of the same length (newlines kept),
 *  so a structural scan never mistakes example/commented-out markup for a real resource, while every offset
 *  it finds still lines up exactly with `text` itself. */
function blankComments(text: string): string {
  return text.replace(XML_COMMENT, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** Like `blankComments`, but also blanks CDATA sections, in a single pass so whichever of the two starts
 *  first wins (a `<!--` inside CDATA is text, not a comment). Only used by `excludeMalformedEntries`: a
 *  `<string>` written literally inside CDATA must never be mistaken for a nameless or unclosed resource. */
function blankStructurallyInert(text: string): string {
  return text.replace(STRUCTURALLY_INERT, (region) => region.replace(/[^\n]/g, ' '));
}

const SIBLING_RESOURCE_TAG_START = /<(?:string|plurals|string-array)\b/;

/**
 * Like `scannable.matchAll(re)` for one of the `*_BODY`/`*_BLOCK` regexes, except it refuses to accept a
 * match whose captured body itself contains another top-level `<string`/`<plurals`/`<string-array` start.
 * That shape only ever happens when this tag's *own* closing tag is missing or misspelled: the non-greedy
 * body group just runs on past it and latches onto an unrelated sibling's closing tag instead, silently
 * absorbing that sibling into this one's "body". Accepting a match like that would hide the sibling (and
 * the real, broken tag) from both exclusion and review scanning — instead, the match is rejected and the
 * search resumes right after *this* tag's own opening tag, so whatever it wrongly swallowed still gets a
 * chance to match cleanly on its own; the rejected tag's start is left for `excludeMalformedEntries`'s
 * general dangling-tag pass to find and excise.
 */
function validBodyMatches(scannable: string, re: RegExp): RegExpExecArray[] {
  const valid: RegExpExecArray[] = [];
  const local = new RegExp(re.source, re.flags);
  local.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = local.exec(scannable)) !== null) {
    const body = m[2] ?? '';
    if (SIBLING_RESOURCE_TAG_START.test(body)) {
      // Rewind past just this tag's own opening tag — not past the whole (wrongly absorbed) match, which
      // is where `exec` already advanced `lastIndex` to, since this is still a 'g' regex.
      const openTagEnd = m.index + m[0].indexOf('>') + 1;
      local.lastIndex = Math.max(openTagEnd, m.index + 1);
      continue;
    }
    valid.push(m);
    if (m[0].length === 0) local.lastIndex += 1; // defensive: avoid looping forever on a zero-length match
  }
  return valid;
}

/**
 * Phase 3 (partial import): finds a `<string>`, `<plurals>` or `<string-array>` that's either (a) dangling —
 * its opening tag has no matching close tag before the next resource starts (unclosed, or closed with a
 * mismatched/misspelled tag name) — or (b) missing its `name` attribute entirely (silently dropped by
 * `parseDomTree` today, with zero visibility).
 *
 * (a) is excised from `text` and the result is re-parsed to *verify* that removing it actually fixes the
 * file; if it doesn't (something else is also broken, or this heuristic mis-identified the boundary), the
 * whole attempt is discarded and the caller falls back to today's whole-file error — this never ships a
 * guess that didn't demonstrably work. (b) is never excised (it was never what broke parsing — Android just
 * silently drops it), so it's only ever reported, and only once the rest of the file is confirmed to import
 * (see `repairAndroidXml`), so it's never shown alongside a "nothing imported" error.
 *
 * A file that already parses is never touched: there, anything that looks "dangling" is by definition a
 * false positive of these text-level heuristics, and excising it could only lose a valid entry.
 */
function excludeMalformedEntries(
  text: string,
  issue: IssueFactory
): { text: string; malformedEntryIssues: RepairIssue[]; missingNameIssues: RepairIssue[] } {
  const scannable = blankStructurallyInert(text);

  const coveredRanges: Array<[number, number]> = [];
  const missingNameIssues: RepairIssue[] = [];

  function excerptOf(chunk: string): string {
    const collapsed = chunk.replace(/\s+/g, ' ').trim();
    return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
  }

  // Well-formed, named resources (the same shapes checkApostrophes/reportDuplicates rely on) are covered —
  // they're not candidates for either exclusion or missing-name reporting.
  for (const re of [STRING_BODY, PLURALS_BLOCK, STRING_ARRAY_BLOCK]) {
    for (const m of validBodyMatches(scannable, re)) {
      coveredRanges.push([m.index!, m.index! + m[0].length]);
    }
  }
  // Self-closed resources are complete and valid regardless of whether they have a name.
  for (const m of scannable.matchAll(SELF_CLOSED_RESOURCE)) {
    coveredRanges.push([m.index!, m.index! + m[0].length]);
  }
  // Well-formed but nameless resources: covered (they're not "dangling"), and always reported — Android
  // parses the file fine but silently drops exactly this one entry.
  const namelessSpecs: Array<[RegExp, 'string' | 'plurals' | 'string-array']> = [
    [NAMELESS_STRING_BODY, 'string'],
    [NAMELESS_PLURALS_BLOCK, 'plurals'],
    [NAMELESS_STRING_ARRAY_BLOCK, 'string-array'],
  ];
  for (const [re, tag] of namelessSpecs) {
    for (const m of validBodyMatches(scannable, re)) {
      coveredRanges.push([m.index!, m.index! + m[0].length]);
      missingNameIssues.push(
        issue(
          'blocking',
          'missing-name',
          `A <${tag}> has no "name" attribute, so it can't be imported: "${excerptOf(m[0])}"`,
          undefined,
          { resourceType: RESOURCE_TYPE_BY_TAG[tag], params: { excerpt: excerptOf(m[2]) } }
        )
      );
    }
  }

  // `matchAll` already yields tag starts in document order, so tag starts, covered ranges and comment starts
  // are each walked exactly once below. The previous `coveredRanges.some(...)` per tag plus
  // `allTagStarts.find(...)` per dangling tag was O(n²) — noticeable on a real file with thousands of entries.
  coveredRanges.sort((a, b) => a[0] - b[0]);
  const allTagStarts = Array.from(scannable.matchAll(RESOURCE_TAG_START), (m) => ({
    start: m.index!,
    tag: m[1],
  }));
  const commentStarts = Array.from(text.matchAll(LINE_START_COMMENT), (m) => m.index! + m[0].length - '<!--'.length);

  const resourcesCloseMatch = scannable.match(RESOURCES_CLOSE);
  const resourcesCloseIndex = resourcesCloseMatch?.index ?? text.length;

  const dangling: Array<{ start: number; tag: string; end: number }> = [];
  let rangeIdx = 0;
  let coveredUntil = -1;
  let commentIdx = 0;
  for (let i = 0; i < allTagStarts.length; i++) {
    const t = allTagStarts[i];
    while (rangeIdx < coveredRanges.length && coveredRanges[rangeIdx][0] <= t.start) {
      coveredUntil = Math.max(coveredUntil, coveredRanges[rangeIdx][1]);
      rangeIdx += 1;
    }
    if (t.start < coveredUntil) continue;

    while (commentIdx < commentStarts.length && commentStarts[commentIdx] <= t.start) commentIdx += 1;
    // Stop at the next resource, at a comment on its own line (it belongs to the next resource and must
    // survive), or at `</resources>`, whichever comes first.
    const end = Math.min(
      allTagStarts[i + 1]?.start ?? Infinity,
      commentStarts[commentIdx] ?? Infinity,
      resourcesCloseIndex,
      text.length
    );
    // E.g. a dangling tag after `</resources>`: slicing with end <= start would *duplicate* text instead of
    // removing it. There's no safe span to excise, so leave the file to the whole-file error path.
    if (end <= t.start) return { text, malformedEntryIssues: [], missingNameIssues };
    dangling.push({ ...t, end });
  }

  if (dangling.length === 0) {
    return { text, malformedEntryIssues: [], missingNameIssues };
  }

  // Nothing is malformed in a file that already parses — see the note on this function. Costs one extra
  // parse, but only in the rare case where the heuristic flagged something at all.
  if (parseAndroidXml(text).errors.length === 0) {
    return { text, malformedEntryIssues: [], missingNameIssues };
  }

  // Excise every dangling span (back to front, so each splice leaves earlier offsets valid) and verify by
  // actually re-parsing — only keep the result if it demonstrably fixed the file.
  let candidate = text;
  for (let i = dangling.length - 1; i >= 0; i--) {
    const d = dangling[i];
    candidate = candidate.slice(0, d.start) + candidate.slice(d.end);
  }
  const verifyParsed = parseAndroidXml(candidate);
  if (verifyParsed.errors.length > 0) {
    // Our guess didn't fix it (something else is also broken, or we mis-identified a boundary) — discard
    // the attempt entirely rather than ship a half-measure; the caller's own final parse of the untouched
    // `text` will surface the real error as a whole-file blocking issue, exactly as before this change.
    return { text, malformedEntryIssues: [], missingNameIssues };
  }

  const malformedEntryIssues = dangling.map((d) => {
    const chunk = text.slice(d.start, d.end);
    const name = chunk.match(LOOSE_NAME_ATTR)?.[1];
    return issue(
      'blocking',
      'malformed-entry',
      `A <${d.tag}>${name ? ` named "${name}"` : ''} doesn't have a matching closing tag (or uses a ` +
        `mismatched one), so it can't be read as valid XML. It was excluded so the rest of the file could ` +
        `still be imported: "${excerptOf(chunk)}"`,
      name,
      { resourceType: RESOURCE_TYPE_BY_TAG[d.tag], params: { excerpt: excerptOf(chunk) } }
    );
  });

  return { text: candidate, malformedEntryIssues, missingNameIssues };
}

/**
 * Issue #33 (phase 4a): turns a raw resource body into the text the ICU checks should look at. Android
 * markup and escapes are not ICU syntax, so they are removed or decoded first: inline tags (`<b>`) are
 * dropped, CDATA is unwrapped, and `\\x` escapes plus XML entities are decoded. An *escaped* apostrophe
 * (`\\'`, `&apos;`, `&#39;`) is deliberately replaced with a neutral character instead of a real `'`: the
 * author spelled it out as a literal apostrophe, so it must never be read as the start of an ICU quote.
 */
const NEUTRAL_APOSTROPHE = '\u0001';
export function decodeBodyForIcuChecks(body: string, escapedApostropheAsQuote = false): string {
  return body
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/\\(u[0-9a-fA-F]{4}|[\s\S])|&(apos|quot|lt|gt|amp|#39|#x27);/g, (_m, esc: string | undefined, ent: string | undefined) => {
      if (ent !== undefined) {
        return ent === 'apos' || ent === '#39' || ent === '#x27'
          ? escapedApostropheAsQuote ? "'" : NEUTRAL_APOSTROPHE
          : { quot: '"', lt: '<', gt: '>', amp: '&' }[ent] ?? '';
      }
      if (esc === "'") return escapedApostropheAsQuote ? "'" : NEUTRAL_APOSTROPHE;
      if (esc === 'n') return '\n';
      if (esc === 't') return '\t';
      if (esc!.length > 1) return String.fromCharCode(parseInt(esc!.slice(1), 16));
      return esc!;
    });
}

/**
 * Review-only: true when the value only looks fine because an escaped apostrophe (`\\'`, `&apos;`, `&#39;`) was
 * read as a plain character, but the editor's own save check (`hasUnterminatedIcuQuote`, which sees the raw
 * text) would treat it as the start of an ICU quote, e.g. `Hello \\'{name}`. Whether that matters depends on
 * whether the app formats the value with ICU at run time, so it is reported and never excluded.
 */
export function hasEscapedApostropheIcuQuote(body: string): boolean {
  return !hasUnterminatedIcuQuote(decodeBodyForIcuChecks(body)) && hasUnterminatedIcuQuote(decodeBodyForIcuChecks(body, true));
}

// A printf-style placeholder (`%1$s`, `%s`, `%d`, `%.2f`). `%%` is a literal percent and is removed first. A
// bare `%x` (no `n$` position) only counts for s/d/f and only when it doesn't follow a digit, so "20%off" or
// "100%d" style prose isn't read as a placeholder; the positional form `%1$o` etc. is always unambiguous.
const PRINTF_POSITIONAL = /%\d+\$[-#+0,(]*\d*(?:\.\d+)?[a-zA-Z]/;
const PRINTF_BARE = /(?<![\d%])%[-#+0,(]*\d*(?:\.\d+)?[sdf]/;

/** Case #18: returns the first printf placeholder and the first `{name}`/`{0}` argument (or plural/select block) when one text uses both. */
export function findMixedPlaceholders(decoded: string): { printf: string; icu: string } | null {
  if (!decoded.includes('%') || !decoded.includes('{')) return null;
  const noPercents = decoded.replace(/%%/g, '');
  const printf = (PRINTF_POSITIONAL.exec(noPercents) ?? PRINTF_BARE.exec(noPercents))?.[0];
  if (!printf) return null;
  const tokens = extractBraceTokens(decoded, false);
  // A simple `{name}` / `{0}` argument, or the opening of a plural/select/selectordinal block (its token is
  // `{arg:type}`), which is ICU too: `{n, plural, one {%1$s file} other {%1$s files}}` still mixes both systems.
  const simple = tokens.find((tok) => /^\{[a-zA-Z0-9_-]+\}$/.test(tok));
  const block = tokens.map((tok) => /^\{([a-zA-Z0-9_-]+):(plural|select|selectordinal)\}$/.exec(tok)).find(Boolean);
  const icu = simple ?? (block ? `{${block[1]}, ${block[2]}, …}` : undefined);
  return icu ? { printf, icu } : null;
}

/** The first reason (if any) a decoded value can't be used as an ICU message: an unterminated quote (#14), or a
 *  clearly-ICU block with unbalanced braces (#13) or a misspelled keyword (#15). */
function blockingIcuProblem(body: string): { category: string; detail?: string } | null {
  const decoded = decodeBodyForIcuChecks(body);
  if (hasUnterminatedIcuQuote(decoded)) return { category: 'unterminated-icu-quote' };
  const f = findIcuFindings(decoded).find((x) => x.blocking);
  return f ? { category: f.kind, detail: f.detail } : null;
}

/**
 * Case #14 (and the blocking ICU cases #13 and #15 that share this path): a resource whose decoded value can't
 * be rendered by an ICU MessageFormat engine is excluded like a malformed entry: only after the rest of the file
 * is confirmed to parse, and verified by re-parsing the result. A `<string-array>` is excluded as a whole,
 * because dropping one item would silently renumber the ones after it. `<plurals>` items are plain text per
 * quantity, not ICU, and are never checked.
 */
export function excludeUnterminatedIcuQuotes(
  text: string,
  issue: IssueFactory,
  reparse: (candidate: string) => { errors: unknown[] } = parseAndroidXml
): { text: string; issues: RepairIssue[] } {
  const scannable = blankComments(text);
  const found: Array<{ start: number; end: number; issue: RepairIssue }> = [];
  const excerptOf = (chunk: string) => {
    const collapsed = chunk.replace(/\s+/g, ' ').trim();
    return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
  };

  for (const m of validBodyMatches(scannable, STRING_BODY)) {
    const [bodyStart, bodyEnd] = m.indices![2];
    const body = text.slice(bodyStart, bodyEnd);
    const problem = blockingIcuProblem(body);
    if (!problem) continue;
    found.push({
      start: m.index!,
      end: m.index! + m[0].length,
      issue: issue(
        'blocking',
        problem.category,
        `"${m[1]}" can't be used as an ICU message (${problem.category}): "${excerptOf(body)}"`,
        m[1],
        { resourceType: 'string', params: { excerpt: excerptOf(body), ...(problem.detail ? { detail: problem.detail } : {}) } }
      ),
    });
  }
  for (const block of validBodyMatches(scannable, STRING_ARRAY_BLOCK)) {
    const blockBodyStart = block.indices![2][0];
    let index = 0;
    for (const item of block[2].matchAll(ARRAY_ITEM)) {
      const [s, e] = item.indices![1];
      const body = text.slice(blockBodyStart + s, blockBodyStart + e);
      const problem = blockingIcuProblem(body);
      if (problem) {
        found.push({
          start: block.index!,
          end: block.index! + block[0].length,
          issue: issue(
            'blocking',
            problem.category,
            `Item #${index + 1} of "${block[1]}" can't be used as an ICU message (${problem.category}): "${excerptOf(body)}"`,
            block[1],
            {
              resourceType: 'array',
              itemQualifier: String(index),
              params: { excerpt: excerptOf(body), ...(problem.detail ? { detail: problem.detail } : {}) },
            }
          ),
        });
        break; // one report per array: the whole array is excluded
      }
      index += 1;
    }
  }
  if (found.length === 0) return { text, issues: [] };
  // A file that doesn't parse is reported as a whole-file error elsewhere; nothing here is trustworthy yet.
  if (parseAndroidXml(text).errors.length > 0) return { text, issues: [] };

  found.sort((a, b) => b.start - a.start);
  let candidate = text;
  for (const f of found) {
    let { start, end } = f;
    // Also remove the line's indentation and newline when the excised resource was alone on its line.
    const lineStart = candidate.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = candidate.indexOf('\n', end);
    if (candidate.slice(lineStart, start).trim() === '' && lineEnd !== -1 && candidate.slice(end, lineEnd).trim() === '') {
      start = lineStart;
      end = lineEnd + 1;
    }
    candidate = candidate.slice(0, start) + candidate.slice(end);
  }
  if (reparse(candidate).errors.length > 0) {
    // The cleaned-up file doesn't re-parse, so nothing is removed. Say so instead of importing silently.
    return {
      text,
      issues: found
        .slice()
        .reverse()
        .map((f) =>
          issue(
            'review',
            'icu-exclusion-failed',
            `"${f.issue.stringName}" can't be used as an ICU message but could not be left out safely, so it was imported as written.`,
            f.issue.stringName,
            { resourceType: f.issue.resourceType, itemQualifier: f.issue.itemQualifier, params: { problem: f.issue.category } }
          )
        ),
    };
  }
  return { text: candidate, issues: found.reverse().map((f) => f.issue) };
}

function describeIcuFinding(name: string, f: IcuFinding): string {
  switch (f.kind) {
    case 'unmatched-brace':
      return `"${name}" has a "{" that is never closed (${f.detail}).`;
    case 'suspect-icu-keyword':
      return `"${name}": "${f.detail}" in {${f.arg}, ${f.detail}, ...} isn't a known ICU keyword.`;
    case 'missing-other-branch':
      return `"${name}": the ${f.detail} block for "${f.arg}" has no mandatory "other" branch.`;
    default:
      return `"${name}": the "${f.detail}" branch is repeated in the block for "${f.arg}".`;
  }
}

/**
 * Issue #33 phase 4c: the optional translation file that is merged in at import time gets the same ICU checks
 * as the source, but EVERYTHING is a `review` issue and nothing is ever excluded: those are the user's own
 * translations, and silently dropping one would lose their work. It only reports. The issue category is always
 * `target-icu` and `params.kind` carries the underlying finding (e.g. `unterminated-icu-quote`,
 * `unbalanced-icu-block`, `mixed-placeholders`). Plural quantity bodies are skipped, like for the source.
 * The file is read after the same mechanical clean-up the merge itself applies.
 */
export function checkTargetFileIcu(rawTarget: string): RepairIssue[] {
  const text = applySilentFixes(rawTarget).text;
  if (parseAndroidXml(text).errors.length > 0) return []; // nothing from it is merged either
  const scannable = blankComments(text);
  const out: RepairIssue[] = [];
  let seq = 0;
  const add = (name: string, kind: string, extras: Partial<IssueExtras>, params: Record<string, number | string>) => {
    seq += 1;
    out.push({
      id: `target_${seq}`,
      tier: 'review',
      category: 'target-icu',
      message: `In the translation file, "${name}": ${kind}.`,
      stringName: name,
      ...extras,
      params: { kind, ...params },
    });
  };
  const check = (name: string, body: string, extras: Partial<IssueExtras>) => {
    const decoded = decodeBodyForIcuChecks(body);
    const seen = new Set<string>();
    if (hasUnterminatedIcuQuote(decoded)) {
      add(name, 'unterminated-icu-quote', extras, { detail: '', arg: '' });
    } else {
      if (hasEscapedApostropheIcuQuote(body)) add(name, 'escaped-apostrophe-quote', extras, { detail: '', arg: '' });
      for (const f of findIcuFindings(decoded)) {
        const key = `${f.kind}|${f.arg ?? ''}|${f.detail}`;
        if (seen.has(key)) continue;
        seen.add(key);
        add(name, f.kind, extras, { detail: f.detail, arg: f.arg ?? '' });
      }
    }
    const mixed = findMixedPlaceholders(decoded);
    if (mixed) add(name, 'mixed-placeholders', extras, { printf: mixed.printf, icu: mixed.icu });
  };
  for (const m of validBodyMatches(scannable, STRING_BODY)) {
    const [a, b] = m.indices![2];
    check(m[1], text.slice(a, b), { resourceType: 'string' });
  }
  for (const block of validBodyMatches(scannable, STRING_ARRAY_BLOCK)) {
    const base = block.indices![2][0];
    let index = 0;
    for (const item of block[2].matchAll(ARRAY_ITEM)) {
      const [a, b] = item.indices![1];
      check(block[1], text.slice(base + a, base + b), { resourceType: 'array', itemQualifier: String(index) });
      index += 1;
    }
  }
  return out;
}

/** Blocking categories that describe one excluded entry rather than the whole file. The Import Report shows
 *  these as its read-only "Not imported" section and still lets the import continue; any *other* blocking
 *  issue keeps rejecting the whole file. Defined next to where they're produced so the two can't drift. */
const ENTRY_EXCLUSION_CATEGORIES: ReadonlySet<string> = new Set(['malformed-entry', 'missing-name', 'unterminated-icu-quote', 'unbalanced-icu-block', 'unknown-icu-keyword']);

export function isEntryExclusion(issue: RepairIssue): boolean {
  return issue.tier === 'blocking' && ENTRY_EXCLUSION_CATEGORIES.has(issue.category);
}

export function repairAndroidXml(raw: string): RepairResult {
  const issue = createIssueFactory();
  const {
    text: afterSilentFixes,
    silentFixes,
    undefinedEntities: undefinedBeforeExclusion,
  } = applySilentFixes(raw, issue);

  const reviewIssues: RepairIssue[] = [];
  const blockingIssues: RepairIssue[] = [];

  const { text: afterMalformed, malformedEntryIssues, missingNameIssues } = excludeMalformedEntries(afterSilentFixes, issue);
  // Issue #33 (4a): unterminated ICU quotes. Runs on the already-cleaned text so every later range stays exact.
  const { text, issues: icuQuoteIssues } = excludeUnterminatedIcuQuotes(afterMalformed, issue);
  // An undefined entity that only appeared inside an excluded entry is gone along with it; reporting it
  // anyway would list, under "Not imported", a problem that no longer exists in the imported file.
  const undefinedEntities = undefinedBeforeExclusion.filter((name) => text.includes(`&${name};`));

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
  const scannable = blankComments(text);

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

  // Issue #33 (4a), case #18: a value mixing printf placeholders (`%s`) with `{name}` arguments. Common in real
  // files and often intentional, so it is informational only (no suggested fix), never blocking.
  function checkMixedPlaceholders(name: string, body: string, extras: Partial<IssueExtras> = {}) {
    const mixed = findMixedPlaceholders(decodeBodyForIcuChecks(body));
    if (!mixed) return;
    reviewIssues.push(
      issue(
        'review',
        'mixed-placeholders',
        `"${name}" mixes printf-style (${mixed.printf}) and brace-style (${mixed.icu}) placeholders in one value.`,
        name,
        { ...extras, params: { printf: mixed.printf, icu: mixed.icu } }
      )
    );
  }

  // Issue #33 (4b): non-blocking ICU findings for one value: a lone `{`, a keyword that may be a typo, a
  // missing mandatory `other`, a repeated clause key. Informational (no suggested fix). Blocking findings were
  // already handled (the entry is gone from `text`), so only review-tier findings can show up here.
  function checkIcuStructure(name: string, body: string, extras: Partial<IssueExtras> = {}) {
    const seen = new Set<string>();
    if (hasEscapedApostropheIcuQuote(body)) {
      reviewIssues.push(
        issue(
          'review',
          'escaped-apostrophe-quote',
          `"${name}" has an escaped apostrophe right before "{" or "}". Android reads it as a plain apostrophe, but the editor's ICU check would read it as an ICU quote.`,
          name,
          extras
        )
      );
    }
    for (const f of findIcuFindings(decodeBodyForIcuChecks(body))) {
      if (f.blocking) continue;
      const key = `${f.kind}|${f.arg ?? ''}|${f.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reviewIssues.push(
        issue('review', f.kind, describeIcuFinding(name, f), name, {
          ...extras,
          params: { detail: f.detail, arg: f.arg ?? '' },
        })
      );
    }
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
    checkMixedPlaceholders(name, text.slice(bodyStart, bodyEnd), { resourceType: 'string' });
    checkIcuStructure(name, text.slice(bodyStart, bodyEnd), { resourceType: 'string' });
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
      checkMixedPlaceholders(name, text.slice(bodyStart, bodyEnd), { resourceType: 'array', itemQualifier: String(index) });
      checkIcuStructure(name, text.slice(bodyStart, bodyEnd), { resourceType: 'array', itemQualifier: String(index) });
      index += 1;
    }
  }
  reportDuplicates(seenArrayNames, 'array', '<string-array>');

  // Blocking issues that remain after per-entry exclusion reject the whole file.
  // Excluded malformed or nameless entries are reported separately below if the remaining XML parses.
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
  // The excluded-entry issues (malformed-entry, missing-name) are only meaningful once `text` itself is
  // confirmed to parse — `excludeMalformedEntries` only ever returns them once it has verified exactly that
  // by re-parsing, so `parsed` (computed from that same `text`) is guaranteed to have zero errors whenever
  // either array is non-empty. Reported even if every entry in the file turned out to be one of these (see
  // the no-strings check below) — "here's specifically what was wrong" is strictly more useful than silence.
  if (parsed.errors.length === 0) {
    blockingIssues.push(...malformedEntryIssues, ...missingNameIssues, ...icuQuoteIssues);
  }
  // A well-formed file with nothing importable (e.g. an empty <resources/>, or one where every entry was
  // excluded above) would otherwise pass every check, show the report, and then fail only after the user
  // clicks Continue.
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
