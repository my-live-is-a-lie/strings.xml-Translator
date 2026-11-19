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
/**
 * The absolute offsets of every `{` that opens an ICU *clause body* (the `{He}` in
 * `{gender, select, male {He} other {They}}`), found with the same parser and the same
 * quoting rules as `extractBraceTokens`, so the two never disagree.
 *
 * The callers need this because a clause body is indistinguishable from a plain
 * placeholder by its text alone (`{He}` and `{name}` look the same): ICU *replaces* a
 * clause body with the translation, so a translated clause must not be treated as a
 * token that "went missing" and re-inserted. Plain `{name}` arguments are not reported.
 */
export function findClauseBodyOpens(text: string): Set<number> {
  const opens = new Set<number>();

  const walk = (src: string, base: number): void => {
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "'") {
        const after = skipQuotedLiteral(src, i);
        i = after !== -1 ? after : i + 1;
        continue;
      }
      if (ch !== '{') {
        i++;
        continue;
      }
      const close = findMatchingBrace(src, i);
      if (close === -1) {
        i++;
        continue;
      }
      const innerStart = base + i + 1;
      const inner = src.slice(i + 1, close);
      const commaIdx = inner.indexOf(',');
      if (commaIdx !== -1) {
        const argName = stripBidiControls(inner.slice(0, commaIdx).trim());
        const rest = inner.slice(commaIdx + 1);
        const nextCommaIdx = rest.indexOf(',');
        const formatType = stripBidiControls(
          (nextCommaIdx !== -1 ? rest.slice(0, nextCommaIdx) : rest).trim()
        );
        if (/^[a-zA-Z0-9_-]+$/.test(argName) && ICU_CLAUSE_FORMAT_TYPES.has(formatType) && nextCommaIdx !== -1) {
          const styleAndClauses = rest.slice(nextCommaIdx + 1);
          const styleStart = innerStart + commaIdx + 1 + nextCommaIdx + 1;
          let j = 0;
          while (j < styleAndClauses.length) {
            while (j < styleAndClauses.length && /\s/.test(styleAndClauses[j])) j++;
            if (j >= styleAndClauses.length) break;
            if (styleAndClauses[j] === "'") {
              const after = skipQuotedLiteral(styleAndClauses, j);
              j = after !== -1 ? after : j + 1;
              continue;
            }
            if (styleAndClauses[j] === '{') {
              const stray = findMatchingBrace(styleAndClauses, j);
              if (stray === -1) break;
              j = stray + 1;
              continue;
            }
            const kwMatch = /^[=\w-]+/.exec(styleAndClauses.slice(j));
            if (!kwMatch) {
              j++;
              continue;
            }
            j += kwMatch[0].length;
            while (j < styleAndClauses.length && /\s/.test(styleAndClauses[j])) j++;
            if (styleAndClauses[j] !== '{') continue;
            const subClose = findMatchingBrace(styleAndClauses, j);
            if (subClose === -1) break;
            opens.add(styleStart + j);
            walk(styleAndClauses.slice(j + 1, subClose), styleStart + j + 1);
            j = subClose + 1;
          }
        } else {
          walk(inner, innerStart);
        }
      } else {
        walk(inner, innerStart);
      }
      i = close + 1;
    }
  };

  walk(text, 0);
  return opens;
}

export interface IcuBlockPart {
  kind: 'text' | 'block';
  /** The exact source slice. */
  text: string;
  /** For a block: its clause bodies, with spans relative to `text`. */
  bodies?: { start: number; end: number }[];
}

/**
 * Splits `text` into plain runs and top-level ICU blocks (`plural` / `select` /
 * `selectordinal`), with each block's clause-body spans. The clause walk mirrors
 * `findClauseBodyOpens` (same quoting rules, same keyword matching), but only the
 * block's direct bodies are reported: a body that itself contains a block is opaque
 * here and is split again when that body is translated on its own.
 *
 * Phase 3 uses this to translate an ICU string piece by piece: the block's structure
 * is copied from the source verbatim and only the bodies are translated, so a
 * machine-translation engine never sees (or translates) the keywords.
 * Returns null when the text contains no ICU block.
 */
export function splitIcuBlocks(text: string): IcuBlockPart[] | null {
  const parts: IcuBlockPart[] = [];
  let foundBlock = false;
  let textStart = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      const after = skipQuotedLiteral(text, i);
      i = after !== -1 ? after : i + 1;
      continue;
    }
    if (ch !== '{') {
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
    let bodies: { start: number; end: number }[] | null = null;
    if (commaIdx !== -1) {
      const argName = stripBidiControls(inner.slice(0, commaIdx).trim());
      const rest = inner.slice(commaIdx + 1);
      const nextCommaIdx = rest.indexOf(',');
      const formatType = stripBidiControls(
        (nextCommaIdx !== -1 ? rest.slice(0, nextCommaIdx) : rest).trim()
      );
      if (
        /^[a-zA-Z0-9_-]+$/.test(argName) &&
        ICU_CLAUSE_FORMAT_TYPES.has(formatType) &&
        nextCommaIdx !== -1
      ) {
        bodies = [];
        const styleAndClauses = rest.slice(nextCommaIdx + 1);
        // Offsets of the style text inside the block: the block opens at `i`, the
        // inner content starts at `i + 1`, and the style follows the two commas.
        const styleStart = i + 1 + commaIdx + 1 + nextCommaIdx + 1;
        let j = 0;
        while (j < styleAndClauses.length) {
          while (j < styleAndClauses.length && /\s/.test(styleAndClauses[j])) j++;
          if (j >= styleAndClauses.length) break;
          if (styleAndClauses[j] === "'") {
            const after = skipQuotedLiteral(styleAndClauses, j);
            j = after !== -1 ? after : j + 1;
            continue;
          }
          if (styleAndClauses[j] === '{') {
            const stray = findMatchingBrace(styleAndClauses, j);
            if (stray === -1) break;
            j = stray + 1;
            continue;
          }
          const kwMatch = /^[=\w-]+/.exec(styleAndClauses.slice(j));
          if (!kwMatch) {
            j++;
            continue;
          }
          j += kwMatch[0].length;
          while (j < styleAndClauses.length && /\s/.test(styleAndClauses[j])) j++;
          if (styleAndClauses[j] !== '{') continue;
          const subClose = findMatchingBrace(styleAndClauses, j);
          if (subClose === -1) break;
          // Spans relative to the block text (the block starts at `i`).
          bodies.push({ start: styleStart + j + 1 - i, end: styleStart + subClose - i });
          j = subClose + 1;
        }
      }
    }
    if (!bodies) {
      // Not a block: step inside it, a block can hide in another brace group.
      i++;
      continue;
    }
    foundBlock = true;
    if (i > textStart) parts.push({ kind: 'text', text: text.slice(textStart, i) });
    parts.push({ kind: 'block', text: text.slice(i, close + 1), bodies });
    i = close + 1;
    textStart = i;
  }
  if (!foundBlock) return null;
  if (textStart < text.length) parts.push({ kind: 'text', text: text.slice(textStart) });
  return parts;
}

// ---------------------------------------------------------------------------
// ICU branch editor: a field model that is a *view* over a message string.
// The string stays the single source of truth; the model only splits it into
// editable pieces (text runs and clause bodies) and glues it back together.
// ---------------------------------------------------------------------------

/** A run of plain text outside any top-level ICU block. */
export interface IcuTextField {
  kind: 'text';
  value: string;
  /** The matching text run of the source, shown as the reference. */
  sourceValue: string;
}

/** One clause of a top-level ICU block: its selector (read-only) and its body (editable). */
export interface IcuClauseField {
  selector: string;
  value: string;
  /** The body of the same selector in the source (the `other` body when the source has no such clause). */
  sourceValue: string;
}

/** A top-level ICU block. Only the clause bodies are editable; the structure is `frame`. */
export interface IcuBlockField {
  kind: 'block';
  name: string;
  type: string;
  offset?: string;
  clauses: IcuClauseField[];
  /**
   * The exact text around the bodies, `clauses.length + 1` pieces: the header up to the first
   * body, the text between two bodies (`} other {`) and the closing text. Kept verbatim so an
   * untouched model reassembles byte for byte and typing in a body can never alter the structure.
   */
  frame: string[];
}

export type IcuField = IcuTextField | IcuBlockField;

const ICU_BLOCK_HEADER = /^\{([^,]*),([^,]*),/;

/**
 * A text run between two blocks that carries no words: only whitespace and punctuation
 * (`' · '`, `' / '`, `' — '`). It is structure, so the fields view keeps it instead of
 * starting it empty — otherwise the separator vanished from the saved string.
 */
const STRUCTURAL_TEXT_RUN = /^[\s\p{P}\p{S}]*$/u;

/**
 * Same question, ignoring bidi controls. Arabic text copied from an app or a chat usually wraps
 * its punctuation in U+200F/U+061C (`'\u200f·\u200f'`): those marks carry no words either, but
 * they are category Cf — not punctuation — so the plain regex called such a run "text with
 * words", left the field empty and dropped the separator on save. The bytes are kept as they
 * are; only the classification ignores the marks.
 */
const isStructuralText = (text: string): boolean => STRUCTURAL_TEXT_RUN.test(stripBidiControls(text));

/** Splits one block part into its frame and clauses, or null when it cannot be read reliably. */
function parseBlockField(part: IcuBlockPart): IcuBlockField | null {
  const bodies = part.bodies;
  if (!bodies || bodies.length === 0) return null;
  const text = part.text;
  const frame: string[] = [];
  const clauses: IcuClauseField[] = [];
  frame.push(text.slice(0, bodies[0].start));
  for (let k = 0; k < bodies.length; k++) {
    const next = k + 1 < bodies.length ? bodies[k + 1].start : text.length;
    frame.push(text.slice(bodies[k].end, next));
  }
  for (let k = 0; k < bodies.length; k++) {
    const selector = /([=\w-]+)\s*\{$/.exec(frame[k]);
    if (!selector) return null;
    clauses.push({ selector: selector[1], value: text.slice(bodies[k].start, bodies[k].end), sourceValue: '' });
  }
  const header = ICU_BLOCK_HEADER.exec(frame[0]);
  if (!header) return null;
  const offset = /offset:\s*(\d+)/.exec(frame[0]);
  return {
    kind: 'block',
    name: stripBidiControls(header[1].trim()),
    type: stripBidiControls(header[2].trim()),
    offset: offset ? offset[1] : undefined,
    clauses,
    frame,
  };
}

/** Parses a whole message into fields; null when it has no block or its structure is broken. */
function buildIcuFields(text: string): IcuField[] | null {
  const parts = splitIcuBlocks(text);
  if (!parts || hasUnbalancedBraces(text)) return null;
  const fields: IcuField[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      fields.push({ kind: 'text', value: part.text, sourceValue: '' });
      continue;
    }
    const block = parseBlockField(part);
    if (!block) return null;
    fields.push(block);
  }
  return fields;
}

/**
 * Builds the field model of an ICU string for the branch editor, or null when the fields view
 * is not available (the editor then shows the raw textarea).
 *
 * The model comes from the target when it holds at least one top-level block (so a target that
 * was adapted to the language's plural categories shows those clauses). An empty target gets the
 * source's structure with every body empty. Anything else (no block, or a broken one) is null.
 * A clause body that itself contains a block stays one opaque value.
 */
export function getIcuFieldModel(source: string, target: string): IcuField[] | null {
  const sourceFields = buildIcuFields(source);
  const targetIsEmpty = target.trim() === '';
  const targetFields = targetIsEmpty ? null : buildIcuFields(target);
  // A non-empty target that yields no fields has no block or a broken one: no fields view.
  // (An empty target is the "not translated yet" case and borrows the source's structure.)
  if (!targetIsEmpty && !targetFields) return null;
  const fields = targetFields ?? sourceFields;
  if (!fields) return null;

  const sourceTexts = (sourceFields ?? []).filter((f): f is IcuTextField => f.kind === 'text');
  const sourceBlocks = (sourceFields ?? []).filter((f): f is IcuBlockField => f.kind === 'block');

  // A target that holds every block but is missing a TEXT RUN (the user typed in one field of
  // an otherwise empty string, or a translation dropped a run) must not shrink the fields view:
  // deriving from the target alone made the untouched runs disappear, so they could never be
  // filled in and the saved string silently lost their text. The source layout is used instead
  // and whatever the target already provides is overlaid.
  // A target whose block does not parse, or that has no block at all, keeps its own handling:
  // the caller shows the raw textarea and the save gate explains why.
  if (targetFields) {
    const targetBlockCount = targetFields.filter((f) => f.kind === 'block').length;
    const targetTextCount = targetFields.filter((f) => f.kind === 'text').length;
    const fillsInMissingTextRuns =
      targetBlockCount > 0 && targetBlockCount === sourceBlocks.length && targetTextCount < sourceTexts.length;
    if (fillsInMissingTextRuns) {
      const targetBlocks = targetFields.filter((f): f is IcuBlockField => f.kind === 'block');
      // Group the target's text runs by the segment they sit in (before the first block,
      // between two blocks, after the last block) and overlay each run onto the source run in
      // the SAME segment. A purely positional overlay got this wrong: when the user had typed
      // only in the trailing run, the target's only run was assigned to the source's FIRST run,
      // so the text silently moved to the front of the string on the next keystroke.
      const targetSegments: string[][] = [[]];
      for (const f of targetFields) {
        if (f.kind === 'block') targetSegments.push([]);
        else targetSegments[targetSegments.length - 1].push(f.value);
      }
      const taken = targetSegments.map(() => 0);
      let b = 0;
      let segment = 0;
      return sourceFields!.map((field) => {
        if (field.kind === 'text') {
          // A run the target does not have at all is the source's again when it carries no
          // words: a translation (or a pasted reply) that dropped `' · '` between two blocks
          // must not silently glue them together, and there is nothing to translate in a
          // separator. A run with words stays empty — that is the user's text to write.
          const value =
            targetSegments[segment]?.[taken[segment]++] ?? (isStructuralText(field.value) ? field.value : '');
          return { kind: 'text', value, sourceValue: field.value };
        }
        segment++;
        const fromTarget = targetBlocks[b++];
        return {
          ...field,
          clauses: field.clauses.map((clause) => {
            const match = fromTarget?.clauses.find((c) => c.selector === clause.selector);
            return { ...clause, value: match?.value ?? '', sourceValue: clause.value };
          }),
        };
      });
    }
  }

  let textIndex = 0;
  let blockIndex = 0;
  return fields.map((field) => {
    if (field.kind === 'text') {
      if (targetIsEmpty) {
        // Every text run starts empty (a placeholder for text the user will type) with the
        // source as the reference. Punctuation used as structure between blocks (`' · '`,
        // `' '`, `' / '`) is kept verbatim: it carries no words to translate, and dropping it
        // glued two clauses together — `{a…} · {b…}` saved as `{a…}{b…}` with no warning.
        return {
          kind: 'text',
          value: isStructuralText(field.value) ? field.value : '',
          sourceValue: field.value,
        };
      }
      return { kind: 'text', value: field.value, sourceValue: sourceTexts[textIndex++]?.value ?? '' };
    }
    const src = sourceBlocks[blockIndex++];
    return {
      ...field,
      clauses: field.clauses.map((clause) => {
        const match =
          src?.clauses.find((c) => c.selector === clause.selector) ?? src?.clauses.find((c) => c.selector === 'other');
        const sourceValue = targetIsEmpty ? clause.value : (match?.value ?? '');
        // A body that carries no words (`{-}`, `{…}`, `{+}`, `{#}`, `{%}`, `{!}`) is punctuation:
        // it is copied from the source like the structure around it. Leaving it empty lost it on
        // save, and there is nothing to translate in it.
        const value = targetIsEmpty
          ? (isStructuralText(clause.value) ? clause.value : '')
          : clause.value;
        return { ...clause, value, sourceValue };
      }),
    };
  });
}

/** Glues a field model back into the message string (the inverse of `getIcuFieldModel`). */
export function assembleIcuFields(fields: IcuField[]): string {
  return fields
    .map((field) => {
      if (field.kind === 'text') return field.value;
      let out = field.frame[0];
      field.clauses.forEach((clause, k) => {
        out += clause.value + field.frame[k + 1];
      });
      return out;
    })
    .join('');
}

/** Returns a copy of the model with one text run replaced. */
export function setIcuTextValue(fields: IcuField[], fieldIndex: number, value: string): IcuField[] {
  return fields.map((f, i) => (i === fieldIndex && f.kind === 'text' ? { ...f, value } : f));
}

/** Returns a copy of the model with one clause body replaced. */
export function setIcuClauseValue(
  fields: IcuField[],
  fieldIndex: number,
  clauseIndex: number,
  value: string
): IcuField[] {
  return fields.map((f, i) =>
    i === fieldIndex && f.kind === 'block'
      ? { ...f, clauses: f.clauses.map((c, k) => (k === clauseIndex ? { ...c, value } : c)) }
      : f
  );
}

/**
 * True when one ICU block straddles a line break, i.e. a `{` and its matching `}` are
 * separated by `\n`. The translation pipeline splits a source string on its line breaks
 * and translates each piece on its own; for such a string every piece is an unbalanced
 * fragment, so the structural check cannot see the block and a reply that drops a clause
 * would slip through. Callers use this to keep the whole string in one piece instead.
 */
export function hasMultilineIcuBlock(text: string): boolean {
  if (!text.includes('{') || !/[\r\n]/.test(text)) return false;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "'") {
      const after = skipQuotedLiteral(text, i);
      i = after !== -1 ? after : i + 1;
      continue;
    }
    if (text[i] === '{') {
      const close = findMatchingBrace(text, i);
      if (close !== -1) {
        if (/[\r\n]/.test(text.slice(i, close))) return true;
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return false;
}

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

// Canonical CLDR order for plural categories, so reported lists are
// deterministic instead of depending on the runtime's `pluralCategories` order.
const PLURAL_CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

// ---------------------------------------------------------------------------
// Structural (tree-based) ICU comparison.
//
// The flat token-count comparison loses which block and clause each token
// belongs to, so a token in one block can hide its absence in another, a type
// swap between two variables is invisible, and a token in a dropped plural
// clause is confused with one in plain text. This section parses a message
// into a tree of elements (arguments, blocks with clauses, printf specifiers,
// HTML tags, `#`, `%%`) and compares the source and target trees by structure,
// so every finding is reported in the block and clause where it actually
// belongs. `validatePlaceholders` and the QA path both use this comparison,
// so the AI-reply check and the project check agree.
// ---------------------------------------------------------------------------

/** One element of a parsed ICU message, preserving its structure. */
type IcuElement =
  | { kind: 'simple'; name: string }
  | { kind: 'formatted'; name: string; type: string }
  | {
      kind: 'block';
      name: string;
      type: 'plural' | 'select' | 'selectordinal';
      offset?: string;
      clauses: IcuClause[];
    }
  | { kind: 'printf'; spec: string }
  | { kind: 'html'; tag: string }
  | { kind: 'percent' }
  | { kind: 'hash' };

interface IcuClause {
  selector: string;
  elements: IcuElement[];
}

type IcuBlockElement = Extract<IcuElement, { kind: 'block' }>;

/** The token string an element reports as (for `missing`/`extra` lists). */
function elementToken(el: IcuElement): string {
  switch (el.kind) {
    case 'simple':
      return `{${el.name}}`;
    case 'formatted':
      return `{${el.name}:${el.type}}`;
    case 'block':
      return `{${el.name}:${el.type}}`;
    case 'printf':
      return el.spec;
    case 'html':
      return el.tag;
    case 'percent':
      return '%%';
    case 'hash':
      return '#';
  }
}

// A printf specifier at the start of a string (non-global, so `.exec` is safe).
const PRINTF_SPEC_AT_START = /^(?:%)(?:\d+\$)?[+-]?\d*(?:\.\d+)?[bcdefgopsx]/i;
// An HTML tag at the start of a string.
const HTML_TAG_AT_START = /^<\/?[a-zA-Z][^>]*>/;

/**
 * Parses `text` into a list of structural elements, recursing into ICU clause
 * sub-messages. Quoted literals are skipped, so a brace inside them is literal
 * text, not structure. `#` is only an element while inside a plural/
 * selectordinal clause's sub-message, where ICU replaces it with the
 * formatted number. Plain text is not an element.
 */
function parseIcuMessage(text: string, inPluralClause = false): IcuElement[] {
  const elements: IcuElement[] = [];
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
        i++;
        continue;
      }
      const inner = text.slice(i + 1, close);
      const before = elements.length;
      const commaIdx = inner.indexOf(',');
      if (commaIdx === -1) {
        const name = stripBidiControls(inner.trim());
        if (/^[a-zA-Z0-9_-]+$/.test(name)) {
          elements.push({ kind: 'simple', name });
        }
      } else {
        const argName = stripBidiControls(inner.slice(0, commaIdx).trim());
        const rest = inner.slice(commaIdx + 1);
        const nextCommaIdx = rest.indexOf(',');
        const formatType = stripBidiControls(
          (nextCommaIdx !== -1 ? rest.slice(0, nextCommaIdx) : rest).trim()
        );
        if (/^[a-zA-Z0-9_-]+$/.test(argName) && ICU_FORMAT_TYPES.has(formatType)) {
          if (ICU_CLAUSE_FORMAT_TYPES.has(formatType)) {
            const styleAndClauses = nextCommaIdx !== -1 ? rest.slice(nextCommaIdx + 1) : '';
            const isPluralLike = formatType === 'plural' || formatType === 'selectordinal';
            const { offset, clauses } = parseIcuClauses(styleAndClauses, isPluralLike);
            elements.push({
              kind: 'block',
              name: argName,
              type: formatType as 'plural' | 'select' | 'selectordinal',
              offset,
              clauses,
            });
          } else {
            elements.push({ kind: 'formatted', name: argName, type: formatType });
          }
        }
      }
      // A brace group that is not itself a valid ICU element but hides a brace
      // inside it (`{{name}}`) is malformed, not empty: record it as an element
      // named after its content, so it compares as missing the real placeholder
      // and carrying an extra one instead of silently equalling the source.
      // (Recursing into the content instead would make `{{name}}` equivalent to
      // `{name}` and let a doubled brace pass the check.)
      if (elements.length === before && inner.includes('{')) {
        elements.push({ kind: 'simple', name: inner });
      }
      i = close + 1;
      continue;
    }
    if (ch === '%' && text[i + 1] === '%') {
      elements.push({ kind: 'percent' });
      i += 2;
      continue;
    }
    if (ch === '%') {
      const m = PRINTF_SPEC_AT_START.exec(text.slice(i));
      if (m) {
        elements.push({ kind: 'printf', spec: m[0] });
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '<') {
      const m = HTML_TAG_AT_START.exec(text.slice(i));
      if (m) {
        elements.push({ kind: 'html', tag: m[0] });
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '#' && inPluralClause) {
      elements.push({ kind: 'hash' });
      i++;
      continue;
    }
    i++;
  }
  return elements;
}

/**
 * Parses the clause list of an ICU block (`offset:N` and `selector {sub-message}`
 * pairs) into an offset and a list of clauses with their parsed sub-messages.
 * `inPluralClause` is true for `plural`/`selectordinal` blocks, so `#` inside
 * their sub-messages is a token, and so `offset:` is recognized (it is only
 * valid in plural/selectordinal blocks, not in `select`).
 */
function parseIcuClauses(
  styleAndClauses: string,
  inPluralClause: boolean
): { offset?: string; clauses: IcuClause[] } {
  let offset: string | undefined;
  const clauses: IcuClause[] = [];
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
    if (inPluralClause) {
      const offsetMatch = /^offset:\s*(\d+)/.exec(styleAndClauses.slice(j));
      if (offsetMatch) {
        offset = offsetMatch[1];
        j += offsetMatch[0].length;
        continue;
      }
    }
    const kwMatch = /^[=\w-]+/.exec(styleAndClauses.slice(j));
    if (!kwMatch) {
      j++;
      continue;
    }
    const selector = kwMatch[0];
    j += selector.length;
    while (j < styleAndClauses.length && /\s/.test(styleAndClauses[j])) j++;
    if (styleAndClauses[j] === '{') {
      const subClose = findMatchingBrace(styleAndClauses, j);
      if (subClose === -1) break;
      const subMessage = styleAndClauses.slice(j + 1, subClose);
      clauses.push({ selector, elements: parseIcuMessage(subMessage, inPluralClause) });
      j = subClose + 1;
    }
  }
  return { offset, clauses };
}

export interface StructuralComparison {
  /** Error tokens missing in the target. */
  missing: string[];
  /** Error tokens extra in the target. */
  extra: string[];
  /** Missing/extra plural categories (warnings, not errors), flat and deduplicated. */
  warnings: string[];
  /** Missing plural categories, per block (for the QA message). */
  missingCategories: { variable: string; categories: string[] }[];
  /** Extra plural categories, per block (for the QA message). */
  extraCategories: { variable: string; categories: string[] }[];
}

interface ComparisonAccumulator {
  missing: string[];
  extra: string[];
  warnings: string[];
  missingCategories: { variable: string; categories: string[] }[];
  extraCategories: { variable: string; categories: string[] }[];
}

/** All the tokens of an element, recursively: the element's own token, then
 * (for a block) each clause's selector and the tokens of its sub-elements.
 * Used when a whole block is dropped or added, so the missing/extra list
 * names what was inside it, not just the block itself. Clause selectors that
 * are plural categories are namespaced by block type (`plural:one`,
 * `select:one`); `other` and non-category keys stay bare. */
function collectElementTokens(el: IcuElement): string[] {
  const tokens: string[] = [elementToken(el)];
  if (el.kind === 'block') {
    for (const clause of el.clauses) {
      const selector = clause.selector;
      if (selector === 'other' || !ICU_LOCALE_PLURAL_CATEGORIES.has(selector)) {
        tokens.push(selector);
      } else {
        tokens.push(`${el.type}:${selector}`);
      }
      for (const sub of clause.elements) {
        tokens.push(...collectElementTokens(sub));
      }
    }
  }
  return tokens;
}

/** The number of `#` elements in a parsed message (recursing into clauses). */
function countHashElements(elements: IcuElement[]): number {
  let count = 0;
  for (const el of elements) {
    if (el.kind === 'hash') count++;
    if (el.kind === 'block') {
      for (const clause of el.clauses) count += countHashElements(clause.elements);
    }
  }
  return count;
}

/**
 * Compares the source and target messages structurally, element by element.
 * Elements are matched by name and type (so a type swap between two variables
 * is reported, and reordering two sound arguments is not an error), and
 * repeated elements are matched in order. Blocks are compared clause by
 * clause: a `select` key is strict, a plural category the target language
 * requires is a warning when missing (and a category it does not require is
 * a warning when present), and `other` is an error when missing. Elements
 * inside a dropped clause are not compared — the clause itself is the
 * finding — so a `{name}` or `%s` in a legitimately dropped plural clause is
 * not falsely missing.
 */
function compareMessages(
  source: string,
  target: string,
  targetLocale?: string
): StructuralComparison {
  const acc: ComparisonAccumulator = {
    missing: [],
    extra: [],
    warnings: [],
    missingCategories: [],
    extraCategories: [],
  };
  compareElementLists(parseIcuMessage(source), parseIcuMessage(target), targetLocale, acc);
  // `#` appears once per clause that uses it. When the locale-aware check
  // applies, its count legitimately differs between languages (e.g. 6 Arabic
  // clauses vs 2 English ones), so it is compared by presence inside matched
  // clauses only. Otherwise (no locale, or an unsupported one) the total
  // count is compared, so a different number of `#` is a mismatch.
  const srcHashCount = countHashElements(parseIcuMessage(source));
  const tgtHashCount = countHashElements(parseIcuMessage(target));
  const localeAware =
    !!targetLocale &&
    (srcHashCount > 0 || tgtHashCount > 0) &&
    getPluralCategoriesForLocale(targetLocale, 'cardinal') !== null;
  if (!localeAware) {
    if (tgtHashCount < srcHashCount && !acc.missing.includes('#')) acc.missing.push('#');
    if (tgtHashCount > srcHashCount && !acc.extra.includes('#')) acc.extra.push('#');
  }
  return {
    missing: Array.from(new Set(acc.missing)),
    extra: Array.from(new Set(acc.extra)),
    warnings: Array.from(new Set(acc.warnings)),
    missingCategories: acc.missingCategories,
    extraCategories: acc.extraCategories,
  };
}

function compareElementLists(
  srcElements: IcuElement[],
  tgtElements: IcuElement[],
  targetLocale: string | undefined,
  acc: ComparisonAccumulator
): void {
  const used = new Array<boolean>(tgtElements.length).fill(false);
  for (const srcEl of srcElements) {
    const key = elementToken(srcEl);
    let matchIdx = -1;
    for (let k = 0; k < tgtElements.length; k++) {
      if (!used[k] && elementToken(tgtElements[k]) === key) {
        matchIdx = k;
        break;
      }
    }
    if (matchIdx === -1) {
      // A dropped block takes its contents with it: report them too, so the
      // missing list names what was inside the block, not just the block.
      acc.missing.push(...collectElementTokens(srcEl));
      continue;
    }
    used[matchIdx] = true;
    const tgtEl = tgtElements[matchIdx];
    if (srcEl.kind === 'block' && tgtEl.kind === 'block') {
      compareBlocks(srcEl, tgtEl, targetLocale, acc);
    }
  }
  for (let k = 0; k < tgtElements.length; k++) {
    if (used[k]) continue;
    const tgtEl = tgtElements[k];
    acc.extra.push(...collectElementTokens(tgtEl));
    // An added block without `other` is invalid ICU, even though the block
    // itself is extra: ICU requires `other` in every block.
    if (tgtEl.kind === 'block' && !tgtEl.clauses.some((c) => c.selector === 'other')) {
      acc.missing.push(`other:{${tgtEl.name}}`);
    }
  }
}

function compareBlocks(
  srcBlock: IcuBlockElement,
  tgtBlock: IcuBlockElement,
  targetLocale: string | undefined,
  acc: ComparisonAccumulator
): void {
  // The offset changes the count, so a different offset is a mismatch.
  if ((srcBlock.offset || '') !== (tgtBlock.offset || '')) {
    if (srcBlock.offset) acc.missing.push(`offset:${srcBlock.offset}`);
    if (tgtBlock.offset) acc.extra.push(`offset:${tgtBlock.offset}`);
  }

  const isPluralLike = srcBlock.type === 'plural' || srcBlock.type === 'selectordinal';
  const expected =
    targetLocale && isPluralLike
      ? getPluralCategoriesForLocale(
          targetLocale,
          srcBlock.type === 'plural' ? 'cardinal' : 'ordinal'
        )
      : null;

  const srcBySelector = new Map<string, IcuClause>();
  for (const c of srcBlock.clauses) srcBySelector.set(c.selector, c);
  const tgtBySelector = new Map<string, IcuClause>();
  for (const c of tgtBlock.clauses) tgtBySelector.set(c.selector, c);

  for (const [selector, srcClause] of srcBySelector) {
    const tgtClause = tgtBySelector.get(selector);
    if (!tgtClause) {
      if (isPluralLike && ICU_LOCALE_PLURAL_CATEGORIES.has(selector)) {
        // A locale category the target dropped. Without a locale-aware check
        // (no locale, or an unsupported one) it is a plain missing token;
        // with one, whether it is a warning depends on the target language,
        // which is checked against the expected set below.
        if (!expected) {
          acc.missing.push(`${srcBlock.type}:${selector}`);
        }
      } else if (selector === 'other') {
        // `other` is required by every locale.
        acc.missing.push(`other:{${srcBlock.name}}`);
      } else if (srcBlock.type === 'select' && ICU_LOCALE_PLURAL_CATEGORIES.has(selector)) {
        // A `select` key named like a plural category: namespaced, so it is
        // never confused with a plural category.
        acc.missing.push(`select:${selector}`);
      } else {
        // A `select` key, an `=N` match, or any other selector: strict.
        acc.missing.push(selector);
      }
      continue;
    }
    // The clause exists on both sides: compare its sub-elements.
    compareElementLists(srcClause.elements, tgtClause.elements, targetLocale, acc);
  }

  for (const [selector] of tgtBySelector) {
    if (srcBySelector.has(selector)) continue;
    if (isPluralLike && ICU_LOCALE_PLURAL_CATEGORIES.has(selector)) {
      // A locale category the target added. Without a locale-aware check it
      // is a plain extra token; with one, whether it is a warning depends on
      // the target language, checked against the expected set below.
      if (!expected) {
        acc.extra.push(`${tgtBlock.type}:${selector}`);
      }
    } else if (tgtBlock.type === 'select' && ICU_LOCALE_PLURAL_CATEGORIES.has(selector)) {
      acc.extra.push(`select:${selector}`);
    } else {
      acc.extra.push(selector);
    }
  }

  // Plural categories are checked against what the target language requires
  // (CLDR), not against the source language: a correct Arabic translation
  // needs zero/two/few/many even though the English source only has
  // one/other, and a correct Japanese translation needs only `other`.
  // A missing or extra category is a warning, not an error: ICU only
  // mandates `other` (a missing category falls back to it).
  if (isPluralLike && expected) {
    const targetSelectors = new Set(tgtBlock.clauses.map((c) => c.selector));
    const missingCats: string[] = [];
    const extraCats: string[] = [];
    for (const category of PLURAL_CATEGORY_ORDER) {
      if (category === 'other') continue;
      if (expected.includes(category) && !targetSelectors.has(category)) {
        missingCats.push(category);
      }
      if (targetSelectors.has(category) && !expected.includes(category)) {
        extraCats.push(category);
      }
    }
    if (missingCats.length > 0) {
      acc.missingCategories.push({ variable: srcBlock.name, categories: missingCats });
      acc.warnings.push(...missingCats);
    }
    if (extraCats.length > 0) {
      acc.extraCategories.push({ variable: srcBlock.name, categories: extraCats });
      acc.warnings.push(...extraCats);
    }
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
  // The structural comparison reports every finding in the block and clause
  // where it belongs: a type swap, a deleted `select` key, a dropped
  // placeholder outside a plural branch, a missing `other`, and a category
  // the target language requires (as a warning, not an error).
  const { missing, extra, warnings } = compareMessages(source, target, targetLocale);
  const missingInTarget = [...missing];
  const extraInTarget = [...extra];
  // An unbalanced target (when the source is balanced) is an error here too,
  // not just in QA: an appended `{` is malformed ICU (`U_UNMATCHED_BRACES`)
  // even though the token counts are unchanged, so the AI-reply check would
  // otherwise pass it silently. A lone `}` in a target with no `{` at all is
  // ordinary literal text in a non-ICU message, not a broken block.
  const unbalanced = firstUnbalancedBrace(target);
  if (unbalanced && !hasUnbalancedBraces(source) && target.includes('{')) {
    missingInTarget.push(unbalanced);
  }

  // Extra tokens are errors too when they are structure the app would choke on:
  // an added placeholder (`{name}`), format (`{amount, date}`) or printf
  // specifier (`%s`) is a runtime crash, not a harmless addition — and a doubled
  // brace (`{{name}}`) is malformed ICU. Lenient by design: an added whole block
  // (`{n:plural}`) is a legitimate translation technique, an added HTML tag or
  // `%%` is cosmetic, an extra `#` or plural category is legitimate when the
  // target language needs more forms (Arabic has six), an added `offset:` harms
  // nothing, and an added `select` key is dead code at worst, never a crash.
  const structuralExtra = extraInTarget.some((t) => {
    if (t.startsWith('%')) return t !== '%%';
    if (!t.startsWith('{')) return false;
    return !/^\{[A-Za-z0-9_-]+:(plural|select|selectordinal)\}$/.test(t);
  });

  return {
    valid: missingInTarget.length === 0 && !structuralExtra,
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

  // 1. Placeholder checks (%s, %d, %1$s, {0}, etc.), compared structurally:
  // the source and target messages are parsed into trees of elements
  // (arguments, blocks with clauses, printf specifiers, HTML tags, `#`,
  // `%%`) and compared by structure, so every finding is reported in the
  // block and clause where it actually belongs.
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
    const {
      missing: missingPlaceholders,
      extra: extraPlaceholders,
      missingCategories: missingByBlock,
      extraCategories: extraByBlock,
    } = compareMessages(source, target, targetLocale);

    // A missing `other` clause gets its own issue (it is a distinct ICU
    // error, `U_DEFAULT_KEYWORD_MISSING`); the rest are plain placeholders.
    const otherTokens = missingPlaceholders.filter((t) => t.startsWith('other:{'));
    const plainMissing = missingPlaceholders.filter((t) => !t.startsWith('other:{'));

    if (plainMissing.length > 0) {
      issues.push({
        id: `${itemId}_${subKey || 'main'}_missing_ph`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'error',
        messageEn: `${prefix}Missing placeholder${plainMissing.length > 1 ? 's' : ''}: ${plainMissing.join(', ')}`,
        messageAr: `${prefix}عنصر نائب مفقود: ${plainMissing.join(', ')}`,
        tokens: plainMissing,
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
    // a missing `other` is already an error via the check above. Each
    // block is checked on its own, so a category in one block never hides its
    // absence in another block of the same type; the warning names the block.
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
    // selectordinal block (`U_DEFAULT_KEYWORD_MISSING`).
    if (otherTokens.length > 0) {
      const variables = otherTokens.map((t) => t.slice('other:{'.length, -1));
      issues.push({
        id: `${itemId}_${subKey || 'main'}_missing_other`,
        itemId,
        itemName,
        subKey,
        category: 'placeholder',
        severity: 'error',
        messageEn: `${prefix}Missing 'other' clause in ICU block${variables.length > 1 ? 's' : ''}: ${variables.map((v) => `{${v}}`).join(', ')}`,
        messageAr: `${prefix}فرع 'other' مفقود في بلوك ICU: ${variables.map((v) => `{${v}}`).join(', ')}`,
        tokens: otherTokens,
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

/**
 * The ICU structural errors of an item: a translation that breaks an ICU block throws at
 * runtime (`String.format` / `MessageFormat`), the same reason a line-break mismatch is
 * unsaveable. The translation pipeline already refuses to produce such a reply; this is
 * the matching gate for text the user types or pastes, so what the app will not generate
 * it will not save either. Only strings whose source actually contains an ICU block are
 * reported, so ordinary placeholder repair is unaffected.
 */
export function getIcuStructureIssues(item: ResourceItem, targetLocale?: string): QaIssue[] {
  const parts: Array<{ source: string; target: string; subKey?: string }> = [];
  if (item.type === 'string') {
    parts.push({ source: item.source || '', target: item.target || '' });
  } else if (item.type === 'plural') {
    for (const q of item.items || []) parts.push({ source: q.source || '', target: q.target || '', subKey: q.quantity });
  } else if (item.type === 'array') {
    for (const el of item.items || []) {
      parts.push({ source: el.source || '', target: el.target || '', subKey: `#${(el.index ?? 0) + 1}` });
    }
  }

  return parts
    .filter((p) => findClauseBodyOpens(p.source).size > 0 && p.target.trim())
    .filter((p) => !validatePlaceholders(p.source, p.target, targetLocale).valid)
    .map((p) => {
      const prefix = p.subKey ? `${p.subKey}: ` : '';
      return {
        id: `${item.id}_${p.subKey || 'main'}_icu_structure`,
        itemId: item.id,
        itemName: item.name,
        subKey: p.subKey,
        category: 'placeholder' as QaIssueCategory,
        severity: 'error' as const,
        messageEn: `${prefix}The ICU MessageFormat block is damaged (a clause, a brace or the # was changed), so this string would crash at runtime.`,
        messageAr: `${prefix}كتلة ICU تالفة (فرع أو قوس أو # تغيّر)، وهذا النص سيتعطّل وقت التشغيل.`,
        tokens: [],
      };
    });
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

