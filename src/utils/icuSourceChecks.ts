import { findMatchingBrace, skipQuotedLiteral, ICU_CLAUSE_FORMAT_TYPES, ICU_FORMAT_TYPES } from './placeholderCheck';

/**
 * Issue #33 phase 4b: ICU structure checks for ONE already-decoded message (see `decodeBodyForIcuChecks`),
 * with no source/target pair involved. Every check here is deliberately narrow: the result decides whether an
 * entry is left out of an import (`blocking`) or only mentioned on the report (`review`), so when a pattern
 * could be ordinary prose, it is a review finding or nothing at all.
 *
 *  - #13 unbalanced braces: `blocking` only for a block that clearly *is* ICU (`{name, plural|select|
 *    selectordinal, ...` whose braces never close). A lone `{` that isn't ICU-shaped is `review`; a stray `}`
 *    (":-}") is ignored.
 *  - #15 misspelled keyword: a clause structure (`name {..}`) after `{arg, KEYWORD,` where KEYWORD isn't a
 *    known format type. `blocking` when it is within two edits of plural/select/selectordinal (plurall,
 *    selct), `review` otherwise. `choice` and every known type never count.
 *  - #16 missing `other`: `review` (see `missing-other-branch` for why it isn't blocking).
 *  - #17 duplicate clause key in one block: `review`.
 */
export type IcuFindingKind =
  | 'unbalanced-icu-block' // blocking
  | 'unknown-icu-keyword' // blocking
  | 'unmatched-brace' // review
  | 'suspect-icu-keyword' // review
  | 'missing-other-branch' // review
  | 'duplicate-icu-category'; // review

export interface IcuFinding {
  kind: IcuFindingKind;
  blocking: boolean;
  /** The offending keyword / category / argument, for the message. */
  detail: string;
  /** Block it belongs to (the variable name when there is one). */
  arg?: string;
}

const CLAUSE_TYPES = ['plural', 'select', 'selectordinal'];
// Types that are valid in some ICU dialects without being in ICU_FORMAT_TYPES: never a typo.
const EXTRA_OK_TYPES = new Set(['choice']);
const BLOCK_HEADER = /^\{\s*([A-Za-z0-9_-]+)\s*,\s*([A-Za-z]+)\s*,/;
const CLAUSE_STRUCTURE = /^\s*(?:offset\s*:\s*\d+\s*)?[=\w-]+\s*\{/;

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function parseClauses(src: string): Array<{ key: string; bodyStart: number; bodyEnd: number }> {
  const out: Array<{ key: string; bodyStart: number; bodyEnd: number }> = [];
  let j = 0;
  const offset = /^\s*offset\s*:\s*\d+/.exec(src);
  if (offset) j = offset[0].length;
  while (j < src.length) {
    while (j < src.length && /\s/.test(src[j])) j++;
    if (j >= src.length) break;
    if (src[j] === '{') {
      const close = findMatchingBrace(src, j);
      if (close === -1) break;
      j = close + 1;
      continue;
    }
    const kw = /^[=\w-]+/.exec(src.slice(j));
    if (!kw) {
      j++;
      continue;
    }
    j += kw[0].length;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== '{') continue;
    const close = findMatchingBrace(src, j);
    if (close === -1) break;
    out.push({ key: kw[0], bodyStart: j + 1, bodyEnd: close });
    j = close + 1;
  }
  return out;
}

function scan(text: string, findings: IcuFinding[]): void {
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
    const header = BLOCK_HEADER.exec(text.slice(i, i + 200));
    if (close === -1) {
      if (header && CLAUSE_TYPES.includes(header[2])) {
        findings.push({ kind: 'unbalanced-icu-block', blocking: true, detail: header[2], arg: header[1] });
      } else if (/^\{\s*[A-Za-z0-9_-]/.test(text.slice(i, i + 3))) {
        findings.push({ kind: 'unmatched-brace', blocking: false, detail: text.slice(i, i + 12).trim() });
      }
      i++;
      continue;
    }
    if (header) {
      const arg = header[1];
      const type = header[2];
      const afterHeader = text.slice(i + header[0].length, close);
      if (ICU_CLAUSE_FORMAT_TYPES.has(type)) {
        const clauses = parseClauses(afterHeader);
        const seen = new Set<string>();
        const reported = new Set<string>();
        for (const c of clauses) {
          if (seen.has(c.key) && !reported.has(c.key)) {
            reported.add(c.key);
            findings.push({ kind: 'duplicate-icu-category', blocking: false, detail: c.key, arg });
          }
          seen.add(c.key);
        }
        if (!seen.has('other')) findings.push({ kind: 'missing-other-branch', blocking: false, detail: type, arg });
        for (const c of clauses) scan(afterHeader.slice(c.bodyStart, c.bodyEnd), findings);
      } else if (!ICU_FORMAT_TYPES.has(type) && !EXTRA_OK_TYPES.has(type) && CLAUSE_STRUCTURE.test(afterHeader)) {
        const near = CLAUSE_TYPES.some((k) => editDistance(type.toLowerCase(), k) <= 2);
        findings.push({ kind: near ? 'unknown-icu-keyword' : 'suspect-icu-keyword', blocking: near, detail: type, arg });
        for (const c of parseClauses(afterHeader)) scan(afterHeader.slice(c.bodyStart, c.bodyEnd), findings);
      }
    }
    i = close + 1;
  }
}

export function findIcuFindings(decoded: string): IcuFinding[] {
  if (!decoded.includes('{')) return [];
  const findings: IcuFinding[] = [];
  scan(decoded, findings);
  return findings;
}
