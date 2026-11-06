// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAndroidXml } from './xmlParser';
import { generateAndroidXml, defaultExportOptions } from './xmlExporter';
import { getItemQaIssues, validatePlaceholders } from './placeholderCheck';
import type { ResourceItem } from '../types';

// Real-world file (Shizuku) with many edge cases: CDATA + HTML, \" \' \n escapes,
// %1$s placeholders, plurals, translatable="false", self-closing and quoted values.
const xml = readFileSync('src/test/fixtures/strings_shizuku.xml', 'utf8');

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
const byName = (items: ResourceItem[], n: string) => items.find((i) => i.name === n)!;

function translate(items: ResourceItem[]): ResourceItem[] {
  return items.map((it) => {
    if (!it.translatable) return it;
    if (it.type === 'string') return { ...it, target: it.source ? 'ترجمة: ' + it.source : '', status: 'translated' as const };
    if (it.type === 'plural') return { ...it, items: it.items.map((q) => ({ ...q, target: 'ترجمة: ' + q.source })), status: 'translated' as const };
    return it;
  });
}

describe('Shizuku strings.xml', () => {
  it('parses every resource without errors', () => {
    const { parsed } = load();
    expect(parsed.errors).toEqual([]);
    const expected = (xml.match(/<(string|plurals|string-array)\s/g) || []).length;
    expect(parsed.items).toHaveLength(expected);
    expect(new Set(parsed.items.map((i) => i.name)).size).toBe(expected);
  });

  it('keeps raw source text: CDATA, escapes, entities and quotes', () => {
    const { parsed } = load();
    const items = parsed.items;
    expect((byName(items, 'home_adb_description') as { source: string }).source).toContain('<![CDATA[');
    expect((byName(items, 'home_adb_description') as { source: string }).source).toContain('href=\\"%1$s\\"');
    expect((byName(items, 'cannot_connect_port') as { source: string }).source).toBe("Can\\'t connect to wireless debugging service.");
    expect((byName(items, 'dialog_adb_discovery_message') as { source: string }).source).toContain('\\n\\nNote');
    expect((byName(items, 'grant_dialog_button_deny') as { source: string }).source).toBe('"Deny"');
    expect((byName(items, 'notification_service_starting') as { source: string }).source).toBe('Shizuku service is starting…');
    expect((byName(items, 'rish_description') as { source: string }).source.startsWith('<![CDATA[\n')).toBe(true);
  });

  it('marks translatable="false" strings and reads the self-closing empty string', () => {
    const { parsed } = load();
    for (const n of ['app_name', 'permission_group_label', 'permission_group_description', 'starting_root_shell']) {
      expect(byName(parsed.items, n).translatable).toBe(false);
    }
    expect(byName(parsed.items, 'permission_label').translatable).toBe(true);
    expect((byName(parsed.items, 'translation_contributors') as { source: string }).source).toBe('');
  });

  it('reads plurals with CDATA items', () => {
    const p = byName(load().parsed.items, 'home_app_management_authorized_apps_count');
    expect(p.type).toBe('plural');
    if (p.type !== 'plural') return;
    expect(p.items.map((q) => q.quantity)).toEqual(['one', 'other']);
    expect(p.items[1].source).toBe('<![CDATA[Authorized %d applications]]>');
  });

  it('exports the untouched file byte-for-byte when nothing is translated', () => {
    const { parsed, project } = load();
    expect(generateAndroidXml(parsed.items, defaultExportOptions, project)).toBe(xml);
  });

  it('exports a well-formed file with all translations, preserving structure', () => {
    const { parsed, project } = load();
    const out = generateAndroidXml(translate(parsed.items), defaultExportOptions, project);
    const doc = new DOMParser().parseFromString(out, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();

    const again = parseAndroidXml(out);
    expect(again.errors).toEqual([]);
    expect(again.items.map((i) => i.name)).toEqual(parsed.items.map((i) => i.name));
    // comments kept, non-translatable strings untouched
    expect(out).toContain('<!-- Home - Status -->');
    expect(out).toContain('<string name="app_name" translatable="false">Shizuku</string>');
    // CDATA wrapper and escapes survive in the translated file
    const adb = byName(again.items, 'home_adb_description') as { source: string };
    expect(adb.source).toBe('ترجمة: ' + (byName(parsed.items, 'home_adb_description') as { source: string }).source);
    expect(out).toContain('ترجمة: <![CDATA[Start by connecting to a computer]]>');
    // plural items exported
    expect(out).toContain('<item quantity="one">ترجمة: <![CDATA[Authorized %d application]]></item>');
  });

  it('QA: accepts placeholder-preserving translations and flags broken ones', () => {
    const { parsed } = load();
    const ver = byName(parsed.items, 'home_status_service_version') as ResourceItem & { source: string; target: string };
    expect(validatePlaceholders(ver.source, 'الإصدار %2$s، %1$s').valid).toBe(true);
    expect(validatePlaceholders(ver.source, 'الإصدار %2$s').missingInTarget).toEqual(['%1$s']);

    const upd = byName(parsed.items, 'home_status_service_version_update') as ResourceItem & { source: string; target: string };
    const ok = { ...upd, target: '<![CDATA[الإصدار %2$s، %1$s<br>أعد التشغيل للتحديث إلى %3$s]]>', status: 'translated' as const };
    const bad = { ...upd, target: '<![CDATA[الإصدار %2$s، %1$s<br>أعد التشغيل]]>', status: 'translated' as const };
    expect(getItemQaIssues(ok)).toEqual([]);
    expect(getItemQaIssues(bad).length).toBeGreaterThan(0);
  });
});

describe('CDATA in translations (regression)', () => {
  it('keeps CDATA sections literal when exporting', () => {
    const { parsed, project } = load();
    const items = parsed.items.map((i) =>
      i.name === 'home_adb_title' && i.type === 'string'
        ? { ...i, target: '<![CDATA[ابدأ بالاتصال بحاسوب]]>', status: 'translated' as const }
        : i.name === 'home_status_service_version_update' && i.type === 'string'
          ? { ...i, target: '<![CDATA[الإصدار %2$s، %1$s<br>أعد التشغيل للتحديث إلى %3$s]]>', status: 'translated' as const }
          : i
    );
    const out = generateAndroidXml(items, defaultExportOptions, project);
    expect(out).toContain('<string name="home_adb_title"><![CDATA[ابدأ بالاتصال بحاسوب]]></string>');
    expect(out).toContain('<![CDATA[الإصدار %2$s، %1$s<br>أعد التشغيل للتحديث إلى %3$s]]>');
    expect(new DOMParser().parseFromString(out, 'application/xml').querySelector('parsererror')).toBeNull();
  });
  it('still encodes & and < outside CDATA', () => {
    const { parsed, project } = load();
    const items = parsed.items.map((i) =>
      i.name === 'home_adb_button_view_help' && i.type === 'string' ? { ...i, target: 'A & B < C', status: 'translated' as const } : i
    );
    expect(generateAndroidXml(items, defaultExportOptions, project)).toContain('>A &amp; B &lt; C<');
  });
});
