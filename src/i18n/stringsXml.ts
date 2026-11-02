import { ALL_STRINGS as UI_STRINGS } from './allStrings';

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');

/** The app's English interface texts as an Android strings.xml, ready to be handed to a translator (or an AI). */
export function generateEnglishUiXml(): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<resources>'];
  for (const [key, v] of Object.entries(UI_STRINGS)) lines.push(`    <string name="${key}">${escapeXml(v.en)}</string>`);
  lines.push('</resources>', '');
  return lines.join('\n');
}

const unescapeXml = (raw: string): string => {
  let s = raw.trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) s = cdata[1];
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\(['"@?])/g, '$1')
    .replace(/\\\\/g, '\\')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
};

/**
 * Tolerant reader for a translated UI file. Keys that are missing stay missing (English is used), keys that are
 * present but empty stay empty (the text is removed from the interface). Unknown keys are ignored.
 */
export function parseUiXml(xml: string): { strings: Record<string, string>; found: number; unknown: number } {
  const strings: Record<string, string> = {};
  let found = 0;
  let unknown = 0;
  const re = /<string\b[^>]*?\bname\s*=\s*(["'])(.*?)\1[^>]*?(?:\/>|>([\s\S]*?)<\/string\s*>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const key = m[2];
    if (!(key in UI_STRINGS)) {
      unknown++;
      continue;
    }
    strings[key] = unescapeXml(m[3] ?? '');
    found++;
  }
  return { strings, found, unknown };
}
