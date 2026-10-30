import type { ResourceItem } from '../types';

export interface FixNote {
  en: string;
  ar: string;
}

const FORMAT_RE = /%(?:\d+\$)?[+-]?\d*(?:\.\d+)?[bcdefgopsx]/gi;
const BRACKET_RE = /\{[a-zA-Z0-9_-]+\}/g;
const END_RUN = /[.!?؟…。۔]+$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tokensOf(text: string): string[] {
  return [...(text.match(FORMAT_RE) || []), ...(text.match(BRACKET_RE) || [])];
}

function countMap(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/** Tokens the source has more of than the target (one entry per missing occurrence), in source order. */
function missingTokens(source: string, target: string): string[] {
  const t = countMap(tokensOf(target));
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const tok of tokensOf(source)) {
    const n = (seen.get(tok) || 0) + 1;
    seen.set(tok, n);
    if (n > (t.get(tok) || 0)) out.push(tok);
  }
  return out;
}

/** Tokens the target has more of than the source (one entry per surplus occurrence). */
function extraTokens(source: string, target: string): string[] {
  return missingTokens(target, source);
}

// ---------- text projection (ignores HTML tags so words can be located) ----------

interface Projection {
  plain: string;
  map: number[]; // plain index -> original index
}

function project(text: string): Projection {
  const tag = /<\/?[a-zA-Z][^>]*>/y;
  let plain = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] === '<') {
      tag.lastIndex = i;
      const m = tag.exec(text);
      if (m) {
        i += m[0].length;
        continue;
      }
    }
    plain += text[i];
    map.push(i);
    i++;
  }
  return { plain, map };
}

interface Word {
  start: number;
  end: number;
}
const wordsOf = (plain: string): Word[] =>
  [...plain.matchAll(/\S+/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));

const origStart = (p: Projection, i: number) => (i < p.map.length ? p.map[i] : p.map.length ? p.map[p.map.length - 1] + 1 : 0);
const origEnd = (p: Projection, i: number) => (i > 0 ? p.map[i - 1] + 1 : 0);
const plainIndexOfOrig = (p: Projection, orig: number) => p.map.filter((o) => o < orig).length;

/** Plain-text index where a trailing run of sentence punctuation starts. */
const beforeTrailingPunct = (plain: string) => {
  const t = plain.trimEnd();
  const m = t.match(END_RUN);
  return m ? t.length - m[0].length : t.length;
};

// ---------- placeholders ----------

function looseRegex(token: string): RegExp {
  if (token.startsWith('{')) return new RegExp('\\{\\s*' + esc(token.slice(1, -1)) + '\\s*\\}', 'gi');
  const m = token.match(/^%(?:(\d+)\$)?([+-]?\d*(?:\.\d+)?)([a-z])$/i);
  if (!m) return new RegExp(esc(token), 'gi');
  const digit = (d: string) => `[${d}${String.fromCharCode(0x660 + +d)}${String.fromCharCode(0x6f0 + +d)}]`;
  let src = '%\\s*';
  if (m[1]) src += [...m[1]].map(digit).join('') + '\\s*\\$\\s*';
  src += esc(m[2]) + '\\s*' + m[3];
  return new RegExp(src, 'gi');
}

/** Incomplete copies of a placeholder the user started typing: "%1$", "%1", "{name", "name}", a lone "%". */
function partialRegexes(token: string): RegExp[] {
  if (token.startsWith('{')) {
    const name = esc(token.slice(1, -1));
    return [new RegExp('\\{\\s*' + name + '(?![\\w}\\s])', 'gi'), new RegExp('(?<![\\w{])' + name + '\\s*\\}', 'gi')];
  }
  const m = token.match(/^%(?:(\d+)\$)?([+-]?\d*(?:\.\d+)?)([a-z])$/i);
  if (!m) return [];
  const digit = (d: string) => `[${d}${String.fromCharCode(0x660 + +d)}${String.fromCharCode(0x6f0 + +d)}]`;
  if (m[1]) {
    const idx = [...m[1]].map(digit).join('');
    return [
      new RegExp('%\\s*' + idx + '\\s*\\$(?![a-z])', 'gi'), // "%1$"
      new RegExp('%\\s*' + idx + '(?![\\d$a-z])', 'gi'), // "%1"
      new RegExp('(?<![\\w%])%(?![\\w%$])', 'g'), // a lone "%"
    ];
  }
  return [new RegExp('(?<![\\w%])%(?![\\w%$])', 'g')]; // a lone "%" that is not part of another token
}

function insertPlaceholder(source: string, target: string, token: string, occurrence: number): string {
  // locate the occurrence-th (0-based) instance of this token in the source
  let idx = -1;
  for (let n = 0, from = 0; n <= occurrence; n++) {
    idx = source.indexOf(token, from);
    if (idx < 0) break;
    from = idx + token.length;
  }
  if (idx < 0) return target;
  const before = source.slice(0, idx);
  const after = source.slice(idx + token.length);
  const affixBefore = before.match(/["'“‘\[(«]*$/)![0];
  const affixAfter = after.match(/^[)"'”’\]»%]*/)![0];
  const beforeCore = before.slice(0, before.length - affixBefore.length);
  const afterCore = after.slice(affixAfter.length);

  const proj = project(target);
  const words = wordsOf(proj.plain);
  const srcPlain = project(source.replace(token, '')).plain;
  const srcWordsBefore = wordsOf(project(before).plain).length;
  const srcWordsAll = Math.max(1, wordsOf(srcPlain).length);

  let plainPos: number;
  let atEnd = false;
  if (!beforeCore.trim() && !affixBefore) {
    plainPos = 0; // placeholder opens the sentence
  } else if (!afterCore.replace(/[\s.!?؟…,:;،؛]/g, '')) {
    plainPos = beforeTrailingPunct(proj.plain); // placeholder closes the sentence
    atEnd = true;
  } else {
    const k = Math.max(0, Math.min(words.length, Math.round((srcWordsBefore / srcWordsAll) * words.length)));
    plainPos = k === 0 ? 0 : words[k - 1].end;
  }
  let pos = plainPos === 0 ? origStart(proj, 0) : origEnd(proj, plainPos);
  // the translation already ends with spaces: put the placeholder after them, so no extra space is left behind
  if (atEnd && /^\s*$/.test(target.slice(pos))) pos = target.length;
  const prev = target[pos - 1];
  const next = target[pos];
  const spaceBefore = /\s$/.test(beforeCore) && prev !== undefined && !/\s/.test(prev);
  const spaceAfter = /^\s/.test(afterCore) && next !== undefined && !/\s/.test(next);
  const ins = (spaceBefore ? ' ' : '') + affixBefore + token + affixAfter + (spaceAfter ? ' ' : '');
  return target.slice(0, pos) + ins + target.slice(pos);
}

function fixPlaceholders(source: string, target: string, notes: FixNote[]): string {
  let text = target;

  // 1) malformed copies of a missing placeholder: "% s", "%1 $s", "%١$s", "{ 0 }", "%S" ...
  for (let pass = 0; pass < 6; pass++) {
    const before = text;
    for (const tok of [...new Set(missingTokens(source, text))]) {
      const candidates = [looseRegex(tok), ...partialRegexes(tok)];
      let m: RegExpMatchArray | undefined;
      for (const re of candidates) {
        m = [...text.matchAll(re)].find((x) => x[0] !== tok);
        if (m) break;
      }
      if (m) {
        text = text.slice(0, m.index!) + tok + text.slice(m.index! + m[0].length);
        notes.push({ en: `Fixed malformed placeholder "${m[0]}" → ${tok}`, ar: `صُحّح العنصر النائب المكتوب خطأً "${m[0]}" إلى ${tok}` });
      }
    }
    if (text === before) break;
  }

  // 2) a placeholder with the wrong index/type, e.g. "%s" where the source has "%1$s"
  for (const miss of missingTokens(source, text)) {
    const isBr = miss.startsWith('{');
    const conv = miss.slice(-1).toLowerCase();
    const extra = extraTokens(source, text).find((e) => (e.startsWith('{') === isBr) && (isBr || e.slice(-1).toLowerCase() === conv));
    if (extra) {
      text = text.replace(extra, miss);
      notes.push({ en: `Replaced placeholder ${extra} with ${miss}`, ar: `استُبدل العنصر النائب ${extra} بـ ${miss}` });
    }
  }

  // 3) still missing: insert where the source has it
  const seen = new Map<string, number>();
  const stillMissing = missingTokens(source, text);
  for (const tok of stillMissing) {
    const total = countMap(tokensOf(source)).get(tok) || 0;
    const have = countMap(tokensOf(text)).get(tok) || 0;
    const occurrence = Math.max(0, Math.min(total - 1, have));
    seen.set(tok, (seen.get(tok) || 0) + 1);
    text = insertPlaceholder(source, text, tok, occurrence);
    notes.push({ en: `Added missing placeholder ${tok}`, ar: `أُضيف العنصر النائب المفقود ${tok}` });
  }
  return text;
}

// ---------- HTML tags ----------

interface Tag {
  raw: string;
  name: string;
  kind: 'open' | 'close' | 'self';
  idx: number;
}

function parseTags(text: string): Tag[] {
  const out: Tag[] = [];
  for (const m of text.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)(?:\s+[^>]*)?\s*(\/?)>/g)) {
    const name = m[2].toLowerCase();
    out.push({
      raw: m[0],
      name,
      idx: m.index!,
      kind: m[3] === '/' || name === 'br' ? 'self' : m[1] ? 'close' : 'open',
    });
  }
  return out;
}

interface Pair {
  open: Tag;
  close: Tag | null;
}

function pairUp(tags: Tag[]): { pairs: Pair[]; unmatchedCloses: Tag[] } {
  const stack: Pair[] = [];
  const pairs: Pair[] = [];
  const unmatchedCloses: Tag[] = [];
  for (const t of tags) {
    if (t.kind === 'open') {
      const p = { open: t, close: null };
      stack.push(p);
      pairs.push(p);
    } else if (t.kind === 'close') {
      let i = stack.length - 1;
      while (i >= 0 && stack[i].open.name !== t.name) i--;
      if (i >= 0) {
        stack[i].close = t;
        stack.splice(i, 1);
      } else unmatchedCloses.push(t);
    }
  }
  return { pairs, unmatchedCloses };
}

const closeOf = (t: Tag) => `</${t.name}>`;

function fixTags(source: string, target: string, notes: FixNote[]): string {
  let text = target;

  // normalise spacing/case inside simple tags: "< /b >" -> "</b>"
  const normalised = text.replace(/<\s*(\/?)\s*([a-zA-Z][\w:-]*)\s*>/g, (all, slash, name) => {
    const fixed = `<${slash}${name}>`;
    if (fixed !== all) notes.push({ en: `Fixed malformed tag "${all}" → ${fixed}`, ar: `صُحّح الوسم المكتوب خطأً "${all}" إلى ${fixed}` });
    return fixed;
  });
  text = normalised;

  const srcProj = project(source);
  const srcWords = wordsOf(srcProj.plain);
  const srcTags = parseTags(source);
  const srcPairs = pairUp(srcTags).pairs;
  const total = Math.max(1, srcWords.length);
  const wordsBeforeOrig = (orig: number) => srcWords.filter((w) => w.start < plainIndexOfOrig(srcProj, orig)).length;

  for (let guard = 0; guard < 30; guard++) {
    const tgtTags = parseTags(text);
    const { pairs: tgtPairs, unmatchedCloses } = pairUp(tgtTags);
    const proj = project(text);
    const words = wordsOf(proj.plain);
    const T = words.length;
    if (T === 0) break;
    const wordsBeforeTarget = (orig: number) => words.filter((w) => w.start < plainIndexOfOrig(proj, orig)).length;
    const openAt = (k: number) => origStart(proj, words[Math.max(0, Math.min(T - 1, k))].start);
    const closeAt = (k: number, srcPunctInside: boolean) => {
      const kk = Math.max(1, Math.min(T, k));
      if (kk === T && !srcPunctInside) return origEnd(proj, beforeTrailingPunct(proj.plain));
      return origEnd(proj, words[kk - 1].end);
    };
    const insertAt = (pos: number, s: string) => (text = text.slice(0, pos) + s + text.slice(pos));
    let changed = false;

    for (const sp of srcPairs) {
      const name = sp.open.name;
      const srcIdx = srcPairs.filter((p) => p.open.name === name).indexOf(sp);
      const tOpens = tgtPairs.filter((p) => p.open.name === name);
      const tClosesAll = tgtTags.filter((t) => t.name === name && t.kind === 'close').length;
      const ratioOpen = wordsBeforeOrig(sp.open.idx + sp.open.raw.length) / total;
      const closeOrig = sp.close ? sp.close.idx : source.length;
      const ratioClose = wordsBeforeOrig(closeOrig) / total;
      const punctInside = sp.close ? END_RUN.test(source.slice(0, closeOrig).trimEnd()) : false;
      const kOpenFor = () => (ratioOpen === 0 ? 0 : Math.min(T - 1, Math.round(ratioOpen * T)));

      if (tOpens.length <= srcIdx) {
        // opening tag missing
        const hasClose = sp.close && tClosesAll > srcIdx;
        const kOpen = kOpenFor();
        if (!sp.close || hasClose) {
          // insert only the opening tag before the unmatched closing one (or alone for tags without a close)
          const uc = unmatchedCloses.find((t) => t.name === name);
          const kClose = uc ? wordsBeforeTarget(uc.idx) : T;
          const kO = uc ? Math.min(kOpen, Math.max(0, kClose - 1)) : kOpen;
          insertAt(openAt(kO), sp.open.raw);
          notes.push({ en: `Added missing tag ${sp.open.raw}`, ar: `أُضيف الوسم المفقود ${sp.open.raw}` });
        } else {
          const kClose = ratioClose >= 1 ? T : Math.max(kOpen + 1, Math.round(ratioClose * T));
          const cPos = closeAt(kClose, punctInside);
          insertAt(cPos, closeOf(sp.open)); // later index first so the opening position stays valid
          insertAt(openAt(kOpen), sp.open.raw);
          notes.push({ en: `Added missing tags ${sp.open.raw}…${closeOf(sp.open)}`, ar: `أُضيفت الوسوم المفقودة ${sp.open.raw}…${closeOf(sp.open)}` });
        }
        changed = true;
        break;
      }
      const tp = tOpens[srcIdx];
      if (sp.close && !tp.close) {
        // closing tag missing for an open one
        const kOpenT = wordsBeforeTarget(tp.open.idx + tp.open.raw.length);
        const kClose = ratioClose >= 1 ? T : Math.max(kOpenT + 1, Math.round(ratioClose * T));
        insertAt(closeAt(kClose, punctInside), closeOf(sp.open));
        notes.push({ en: `Added missing closing tag ${closeOf(sp.open)}`, ar: `أُضيف وسم الإغلاق المفقود ${closeOf(sp.open)}` });
        changed = true;
        break;
      }
    }
    if (changed) continue;

    // self-closing tags such as <br/> that the translation dropped
    const srcSelf = srcTags.filter((t) => t.kind === 'self');
    for (const s of srcSelf) {
      const have = tgtTags.filter((t) => t.kind === 'self' && t.name === s.name).length;
      const need = srcSelf.filter((x) => x.name === s.name).indexOf(s) + 1;
      if (have < need) {
        const k = Math.round((wordsBeforeOrig(s.idx) / total) * T);
        const pos = k <= 0 ? origStart(proj, 0) : k >= T ? origEnd(proj, beforeTrailingPunct(proj.plain)) : origEnd(proj, words[k - 1].end);
        insertAt(pos, s.raw);
        notes.push({ en: `Added missing tag ${s.raw}`, ar: `أُضيف الوسم المفقود ${s.raw}` });
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return text;
}

// ---------- brackets ----------

const BRACKET_PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '«': '»', '“': '”' };
const CLOSERS = new Set(Object.values(BRACKET_PAIRS));
const CLOSER_TO_OPENER: Record<string, string> = Object.fromEntries(Object.entries(BRACKET_PAIRS).map(([o, c]) => [c, o]));

/** Same-length copy of the text where placeholders, HTML tags and entities can't be mistaken for brackets. */
function maskSyntax(text: string): string {
  return text.replace(/%(?:\d+\$)?[+-]?\d*(?:\.\d+)?[bcdefgopsx]|\{[a-zA-Z0-9_-]+\}|<\/?[a-zA-Z][^>]*>|&[a-zA-Z#0-9]+;/g, (m) => '_'.repeat(m.length));
}

export interface BracketScan {
  unclosed: { idx: number; ch: string }[];
  pairs: { open: number; close: number; ch: string }[];
}

/** Finds the opening brackets that are never closed (stack scan, per bracket type). */
export function scanBrackets(text: string): BracketScan {
  const masked = maskSyntax(text);
  const stack: { idx: number; ch: string }[] = [];
  const pairs: BracketScan['pairs'] = [];
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (BRACKET_PAIRS[ch]) stack.push({ idx: i, ch });
    else if (CLOSERS.has(ch)) {
      const opener = CLOSER_TO_OPENER[ch];
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].ch === opener) {
          pairs.push({ open: stack[j].idx, close: i, ch: opener });
          stack.splice(j, 1);
          break;
        }
      }
    }
  }
  return { unclosed: stack, pairs };
}

function fixBrackets(source: string, target: string, notes: FixNote[]): string {
  let text = target;
  const src = scanBrackets(source);
  for (let guard = 0; guard < 10; guard++) {
    const tgt = scanBrackets(text);
    const extra = tgt.unclosed.find((u) => {
      const need = tgt.unclosed.filter((x) => x.ch === u.ch).length - src.unclosed.filter((x) => x.ch === u.ch).length;
      return need > 0 && tgt.unclosed.filter((x) => x.ch === u.ch).indexOf(u) >= tgt.unclosed.filter((x) => x.ch === u.ch).length - need;
    });
    if (!extra) break;
    const closer = BRACKET_PAIRS[extra.ch];
    const proj = project(text);
    const words = wordsOf(proj.plain);
    // which opener of this type is it (in order), and where does the source close the matching one?
    const k = tgt.pairs.filter((p) => p.ch === extra.ch && p.open < extra.idx).length + tgt.unclosed.filter((u) => u.ch === extra.ch && u.idx < extra.idx).length;
    const srcOpeners = [...src.pairs.filter((p) => p.ch === extra.ch).map((p) => p.open), ...src.unclosed.filter((u) => u.ch === extra.ch).map((u) => u.idx)].sort((a, b) => a - b);
    const sp = src.pairs.find((p) => p.ch === extra.ch && p.open === srcOpeners[k]);
    let pos = origEnd(proj, beforeTrailingPunct(proj.plain));
    if (sp && !/^[\s.!?؟…,:;،؛]*$/.test(source.slice(sp.close + 1)) && words.length) {
      const srcProj = project(source);
      const srcWords = wordsOf(srcProj.plain);
      const before = srcWords.filter((w) => w.start < plainIndexOfOrig(srcProj, sp.close)).length;
      const kk = Math.max(1, Math.min(words.length, Math.round((before / Math.max(1, srcWords.length)) * words.length)));
      pos = origEnd(proj, words[kk - 1].end);
    }
    pos = Math.max(pos, extra.idx + 1);
    text = text.slice(0, pos) + closer + text.slice(pos);
    notes.push({ en: `Closed the unclosed bracket ${extra.ch}`, ar: `أُغلق القوس غير المنغلق ${extra.ch}` });
  }
  return text;
}

// ---------- public API ----------

export function fixTargetSyntax(source: string, target: string): { text: string; notes: FixNote[] } {
  const notes: FixNote[] = [];
  if (!target.trim() || !source) return { text: target, notes };
  let text = fixPlaceholders(source, target, notes);
  text = fixTags(source, text, notes);
  text = fixBrackets(source, text, notes);
  return { text, notes };
}

/** Repairs placeholders and HTML tags of every translated entry of an item, using its source text as the reference. */
export function fixItemSyntax(item: ResourceItem): { item: ResourceItem; notes: FixNote[] } {
  const notes: FixNote[] = [];
  const run = (source: string, target: string, label?: string) => {
    const r = fixTargetSyntax(source, target);
    for (const n of r.notes) notes.push(label ? { en: `[${label}] ${n.en}`, ar: `[${label}] ${n.ar}` } : n);
    return r.text;
  };
  if (item.type === 'string') {
    const target = run(item.source, item.target);
    return { item: target === item.target ? item : { ...item, target }, notes };
  }
  if (item.type === 'plural') {
    const items = item.items.map((pi) => {
      const target = run(pi.source, pi.target, pi.quantity);
      return target === pi.target ? pi : { ...pi, target };
    });
    return { item: notes.length ? { ...item, items } : item, notes };
  }
  const items = item.items.map((ai) => {
    const target = run(ai.source, ai.target, `#${ai.index + 1}`);
    return target === ai.target ? ai : { ...ai, target };
  });
  return { item: notes.length ? { ...item, items } : item, notes };
}
