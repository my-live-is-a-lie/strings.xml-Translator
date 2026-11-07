// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseAndroidXml } from './xmlParser';
import { generateAndroidXml, defaultExportOptions } from './xmlExporter';
import { toEditorText, toStoredText } from './newlines';
import { getLineBreakIssues } from './placeholderCheck';
import type { ResourceItem } from '../types';

// Line breaks written in the three habits found in real files: a real line break before every \n (formatting),
// a plain \n, and an escaped backslash + n (not a line break).
const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="steps">Import from takeout:
\\n
\\n1. Go to this URL: %1$s
\\n2. Log in when asked</string>
    <string name="plain">Needs permission\\nto open the popup</string>
    <string name="labels">What:\\\\nRequest:\\\\nOS:</string>
    <string name="double">First.\\n\\nSecond.</string>
</resources>`;

const load = () => {
  const parsed = parseAndroidXml(xml);
  return { parsed, project: { rawSourceXml: xml, resourcesAttributes: parsed.resourcesAttributes, indentStyle: parsed.indentStyle, itemIndentStyle: parsed.itemIndentStyle, items: parsed.items } };
};
const skeleton = (raw: string) => {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && raw[i + 1] === 'n') { out += 'T'; i++; }
    else if (raw[i] === '\\' && raw[i + 1] === '\\') { out += 'B'; i++; }
    else if (raw[i] === '\n') out += 'R';
  }
  return out;
};
const get = (items: ResourceItem[], name: string) => items.find((i) => i.name === name) as { source: string; target: string };

describe('line breaks through the editor and back out', () => {
  it('a translation made with the same number of breaks exports with the source structure', () => {
    const { parsed, project } = load();
    const items = parsed.items.map((it): ResourceItem => {
      if (it.type !== 'string') return it;
      // what the editor does: real breaks are shown and typed, the stored text writes them as \n
      const edited = toEditorText(it.source).replace(/[A-Za-z]+/g, 'كلمة');
      return { ...it, target: toStoredText(edited), status: 'translated' };
    });
    for (const it of items) expect(getLineBreakIssues(it)).toEqual([]);
    const out = generateAndroidXml(items, defaultExportOptions, { ...project, items });
    const back = parseAndroidXml(out).items;
    for (const name of ['steps', 'plain', 'labels', 'double']) {
      expect(skeleton(get(back, name).source)).toBe(skeleton(get(parsed.items, name).source));
    }
  });

  it('a translation identical to the source reproduces the file exactly', () => {
    const { parsed, project } = load();
    const items = parsed.items.map((it): ResourceItem =>
      it.type === 'string' ? { ...it, target: toStoredText(toEditorText(it.source)), status: 'translated' } : it
    );
    expect(generateAndroidXml(items, defaultExportOptions, { ...project, items })).toBe(xml);
  });

  it('refuses a different number of line breaks and says how many are missing or extra', () => {
    const { parsed } = load();
    const steps = get(parsed.items, 'steps');
    const lacking = { ...(parsed.items.find((i) => i.name === 'steps') as ResourceItem), target: 'one\\ntwo', status: 'translated' } as ResourceItem;
    const [missing] = getLineBreakIssues(lacking);
    expect(missing.severity).toBe('error');
    expect(missing.messageEn).toContain('2 line breaks missing');
    expect(missing.messageAr).toContain('ينقص سطران جديدان');
    const tooMany = { ...lacking, target: 'a\\nb\\nc\\nd\\ne\\nf', status: 'translated' } as ResourceItem;
    expect(getLineBreakIssues(tooMany)[0].messageEn).toContain('2 extra line breaks');
    const exact = { ...lacking, target: toStoredText('a\nb\nc\nd'), status: 'translated' } as ResourceItem;
    expect(getLineBreakIssues(exact)).toEqual([]);
    expect(steps.source).toContain('%1$s');
  });

  it('does not count an escaped backslash + n, and ignores empty translations', () => {
    const { parsed } = load();
    const labels = parsed.items.find((i) => i.name === 'labels') as ResourceItem;
    expect(getLineBreakIssues({ ...labels, target: 'ما:\\\\nالطلب:', status: 'translated' } as ResourceItem)).toEqual([]);
    expect(getLineBreakIssues({ ...labels, target: '', status: 'untranslated' } as ResourceItem)).toEqual([]);
  });
});
