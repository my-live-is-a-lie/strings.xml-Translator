import { parseAndroidXml } from './xmlParser';

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
  /** Stable id for React keys / dedup; not meant to be shown to the user. */
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
  /** Applied automatically; nothing here could have changed a string's rendered meaning. */
  silentFixes: RepairIssue[];
  /** Not applied. The file still imports; each of these needs a human decision. */
  reviewIssues: RepairIssue[];
  /** The file (or, once per-entry exclusion ships, the specific entry) could not be imported. */
  blockingIssues: RepairIssue[];
}

const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D]/g;
// A `&` that isn't the start of a real XML entity reference.
const BARE_AMPERSAND = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g;
const STRING_BODY = /<string\s+[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*(?<!\/)>([\s\S]*?)<\/string>/g;

let nextId = 0;
function issue(
  tier: RepairTier,
  category: string,
  message: string,
  stringName?: string,
  params?: Record<string, number | string>
): RepairIssue {
  nextId += 1;
  return { id: `repair_${nextId}`, tier, category, message, stringName, params };
}

export function repairAndroidXml(raw: string): RepairResult {
  const silentFixes: RepairIssue[] = [];
  let text = raw;

  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    silentFixes.push(issue('silent', 'bom', 'Removed a byte-order-mark (BOM) at the start of the file.'));
  }

  const zeroWidthCount = (text.match(ZERO_WIDTH_CHARS) || []).length;
  if (zeroWidthCount > 0) {
    text = text.replace(ZERO_WIDTH_CHARS, '');
    silentFixes.push(
      issue(
        'silent',
        'zero-width-chars',
        `Removed ${zeroWidthCount} invisible zero-width character(s) (likely pasted in by accident).`,
        undefined,
        { count: zeroWidthCount }
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

  const bareAmpersandCount = (text.match(BARE_AMPERSAND) || []).length;
  if (bareAmpersandCount > 0) {
    text = text.replace(BARE_AMPERSAND, '&amp;');
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

  const reviewIssues: RepairIssue[] = [];
  const blockingIssues: RepairIssue[] = [];

  // Review: an Android resource value with a raw apostrophe that isn't backslash-escaped and
  // isn't a whole value wrapped in double quotes. This can be perfectly valid ICU (a balanced
  // quote span), so it isn't "broken" — but it's an aapt build risk, and a quoted
  // "'{placeholder}'" silently stops substituting that placeholder, which is rarely intended.
  const seenNames = new Map<string, number>();
  let match: RegExpExecArray | null;
  STRING_BODY.lastIndex = 0;
  while ((match = STRING_BODY.exec(text)) !== null) {
    const [, name, body] = match;
    seenNames.set(name, (seenNames.get(name) || 0) + 1);

    const trimmed = body.trim();
    const wholeValueDoubleQuoted = trimmed.startsWith('"') && trimmed.endsWith('"');
    if (!wholeValueDoubleQuoted) {
      const unescapedApostrophes = (body.match(/(?<!\\)'/g) || []).length;
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
  const parsed = parseAndroidXml(text);
  for (const message of parsed.errors) {
    blockingIssues.push(issue('blocking', 'xml-parse-error', message));
  }

  return { fixedXml: text, silentFixes, reviewIssues, blockingIssues };
}
