// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAndroidXml } from './xmlParser';
import { generateAndroidXml, defaultExportOptions } from './xmlExporter';
import { getItemQaIssues, validatePlaceholders } from './placeholderCheck';
import type { ResourceItem } from '../types';

// A realistic strings.xml full of edge cases: CDATA + HTML, \" \' \n escapes, %1$s placeholders in any order,
// plurals with CDATA, translatable="false", references, a self-closing empty string, quoted values, entities.
const xml = readFileSync('src/test/fixtures/edge-cases.xml', 'utf8');

function load() {
  const parsed = parseAndroidXml(xml);
  return {
    parsed,
    project: {
      rawSourceXml: xml,
      resourcesAttributes: parsed.resourcesAttributes,
      indentStyle: parsed.indentStyle,
      itemIndentStyle: parsed.itemIndentStyle,
      items: parsed.items,
    },
  };
}
const find = (items: ResourceItem[], n: string) => items.find((i) => i.name === n)!;
const src = (items: ResourceItem[], n: string) => (find(items, n) as { source: string }).source;
const wellFormed = (out: string) => new DOMParser().parseFromString(out, 'application/xml').querySelector('parsererror') === null;

function translateAll(items: ResourceItem[]): ResourceItem[] {
  return items.map((it) => {
    if (!it.translatable) return it;
    if (it.type === 'string') return { ...it, target: it.source ? 'ترجمة: ' + it.source : '', status: 'translated' as const };
    if (it.type === 'plural') return { ...it, items: it.items.map((q) => ({ ...q, target: 'ترجمة: ' + q.source })), status: 'translated' as const };
    return it;
  });
}
function withTarget(items: ResourceItem[], name: string, target: string): ResourceItem[] {
  return items.map((i) => (i.name === name && i.type === 'string' ? { ...i, target, status: 'translated' as const } : i));
}

describe('edge-case strings.xml: parsing', () => {
  it('parses every resource without errors', () => {
    const { parsed } = load();
    expect(parsed.errors).toEqual([]);
    const expected = (xml.match(/<(string|plurals|string-array)\s/g) || []).length;
    expect(parsed.items).toHaveLength(expected);
    expect(new Set(parsed.items.map((i) => i.name)).size).toBe(expected);
  });

  it('keeps raw source text: CDATA, escapes, entities and quotes', () => {
    const { items } = load().parsed;
    expect(src(items, 'intro_description')).toContain('<![CDATA[');
    expect(src(items, 'intro_description')).toContain('href=\\"%1$s\\"');
    expect(src(items, 'cannot_connect')).toBe("Can\\'t connect to the service.");
    expect(src(items, 'enable_notice')).toContain('\\n\\nNote');
    expect(src(items, 'button_deny')).toBe('"Deny"');
    expect(src(items, 'notification_starting')).toBe('Service is starting…');
    expect(src(items, 'terms_notice')).toBe('Terms &amp; conditions apply, see &lt;docs&gt;.');
    expect(src(items, 'help_text').startsWith('<![CDATA[\n')).toBe(true);
  });

  it('marks translatable="false" strings', () => {
    const { items } = load().parsed;
    for (const n of ['app_name', 'permission_group', 'root_shell']) expect(find(items, n).translatable).toBe(false);
    expect(find(items, 'permission_label').translatable).toBe(true);
  });

  it('reads a self-closing string as empty without swallowing the next string', () => {
    const { items } = load().parsed;
    expect(src(items, 'translation_contributors')).toBe('');
    expect(src(items, 'status_running')).toBe('%1$s is running');
  });

  it('reads plurals with CDATA items and string arrays', () => {
    const { items } = load().parsed;
    const p = find(items, 'authorized_apps');
    expect(p.type).toBe('plural');
    if (p.type === 'plural') {
      expect(p.items.map((q) => q.quantity)).toEqual(['one', 'other']);
      expect(p.items[1].source).toBe('<![CDATA[Authorized %d applications]]>');
    }
    const a = find(items, 'levels');
    expect(a.type === 'array' && a.items.map((e) => e.source)).toEqual(['Low', 'High']);
  });
});

describe('edge-case strings.xml: export', () => {
  it('returns the untouched file byte-for-byte when nothing is translated', () => {
    const { parsed, project } = load();
    expect(generateAndroidXml(parsed.items, defaultExportOptions, project)).toBe(xml);
  });

  it('exports a well-formed file with every translation and keeps the structure', () => {
    const { parsed, project } = load();
    const out = generateAndroidXml(translateAll(parsed.items), defaultExportOptions, project);
    expect(wellFormed(out)).toBe(true);
    const again = parseAndroidXml(out);
    expect(again.errors).toEqual([]);
    expect(again.items.map((i) => i.name)).toEqual(parsed.items.map((i) => i.name));
    expect(out).toContain('<!-- Status: placeholders in different orders -->');
    expect(out).toContain('<string name="app_name" translatable="false">Sample App</string>');
    expect(out).toContain('ترجمة: <![CDATA[Start by connecting to a computer]]>');
    expect(out).toContain('<item quantity="one">ترجمة: <![CDATA[Authorized %d application]]></item>');
    expect(src(again.items, 'status_version')).toBe('ترجمة: Version %2$s, %1$s');
  });

  it('keeps CDATA sections literal when a translation is a CDATA section', () => {
    const { parsed, project } = load();
    let items = withTarget(parsed.items, 'intro_title', '<![CDATA[ابدأ بالاتصال بحاسوب]]>');
    items = withTarget(items, 'status_version_update', '<![CDATA[الإصدار %2$s، %1$s<br>ابدأ مرة أخرى للتحديث إلى %3$s]]>');
    const out = generateAndroidXml(items, defaultExportOptions, project);
    expect(out).toContain('<string name="intro_title"><![CDATA[ابدأ بالاتصال بحاسوب]]></string>');
    expect(out).toContain('<![CDATA[الإصدار %2$s، %1$s<br>ابدأ مرة أخرى للتحديث إلى %3$s]]>');
    expect(wellFormed(out)).toBe(true);
  });

  it('still encodes & and < outside CDATA', () => {
    const { parsed, project } = load();
    const out = generateAndroidXml(withTarget(parsed.items, 'intro_title', 'A & B < C'), defaultExportOptions, project);
    expect(out).toContain('>A &amp; B &lt; C<');
  });

  it('expands a translated self-closing string and leaves the rest untouched', () => {
    const { parsed, project } = load();
    const out = generateAndroidXml(withTarget(parsed.items, 'translation_contributors', 'مساهمون'), defaultExportOptions, project);
    expect(out).toContain('<string name="translation_contributors">مساهمون</string>');
    expect(out).not.toContain('<string name="translation_contributors" />');
    expect(out).toBe(xml.replace('<string name="translation_contributors" />', '<string name="translation_contributors">مساهمون</string>'));
    expect(wellFormed(out)).toBe(true);
    expect(src(parseAndroidXml(out).items, 'translation_contributors')).toBe('مساهمون');
  });

  it('encodes a self-closing string translation and keeps it untouched when untranslated', () => {
    const { parsed, project } = load();
    const encoded = generateAndroidXml(withTarget(parsed.items, 'translation_contributors', 'A & B'), defaultExportOptions, project);
    expect(encoded).toContain('<string name="translation_contributors">A &amp; B</string>');
    expect(generateAndroidXml(parsed.items, defaultExportOptions, project)).toContain('<string name="translation_contributors" />');
    const omitted = generateAndroidXml(parsed.items, { ...defaultExportOptions, fallbackToSource: false }, project);
    expect(omitted).not.toContain('translation_contributors');
    expect(wellFormed(omitted)).toBe(true);
  });

  it('handles self-closing strings with extra attributes and no space before the slash', () => {
    const small = '<resources>\n    <string name="a" translatable="true"/>\n    <string name="b">B</string>\n</resources>\n';
    const parsed = parseAndroidXml(small);
    const items = withTarget(parsed.items, 'a', 'أ');
    const out = generateAndroidXml(items, defaultExportOptions, { rawSourceXml: small, resourcesAttributes: '', indentStyle: '    ', itemIndentStyle: '        ', items: parsed.items });
    expect(out).toContain('<string name="a" translatable="true">أ</string>');
    expect(out).toContain('<string name="b">B</string>');
  });

  it('exports the same translation without the original file (fallback builder)', () => {
    const { parsed } = load();
    const out = generateAndroidXml(withTarget(parsed.items, 'translation_contributors', 'مساهمون'), defaultExportOptions);
    expect(out).toContain('<string name="translation_contributors">مساهمون</string>');
  });
});

describe('edge-case strings.xml: quality checks', () => {
  it('accepts placeholder-preserving translations and flags broken ones', () => {
    const { parsed } = load();
    const ver = find(parsed.items, 'status_version') as ResourceItem & { source: string };
    expect(validatePlaceholders(ver.source, 'الإصدار %2$s، %1$s').valid).toBe(true);
    expect(validatePlaceholders(ver.source, 'الإصدار %2$s').missingInTarget).toEqual(['%1$s']);

    const upd = find(parsed.items, 'status_version_update') as ResourceItem & { source: string };
    const ok = { ...upd, target: '<![CDATA[الإصدار %2$s، %1$s<br>أعد التشغيل للتحديث إلى %3$s]]>', status: 'translated' as const };
    const bad = { ...upd, target: '<![CDATA[الإصدار %2$s، %1$s<br>أعد التشغيل]]>', status: 'translated' as const };
    expect(getItemQaIssues(ok)).toEqual([]);
    expect(getItemQaIssues(bad).length).toBeGreaterThan(0);
  });
});
