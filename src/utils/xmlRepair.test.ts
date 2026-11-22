// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { repairAndroidXml } from './xmlRepair';

function wrap(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}\n</resources>\n`;
}

describe('repairAndroidXml / silent fixes', () => {
  it('strips a leading BOM', () => {
    const result = repairAndroidXml('\uFEFF' + wrap('<string name="a">hi</string>'));
    expect(result.fixedXml.charCodeAt(0)).not.toBe(0xfeff);
    expect(result.silentFixes.some((f) => f.category === 'bom')).toBe(true);
  });

  it('normalizes CRLF and lone CR to LF', () => {
    const xml = wrap('<string name="a">hi</string>').replace(/\n/g, '\r\n');
    const result = repairAndroidXml(xml);
    expect(result.fixedXml.includes('\r')).toBe(false);
    expect(result.silentFixes.some((f) => f.category === 'line-endings')).toBe(true);
  });

  it('strips zero-width characters', () => {
    const xml = wrap('<string name="a">hi\u200Bthere</string>');
    const result = repairAndroidXml(xml);
    expect(result.fixedXml.includes('\u200B')).toBe(false);
    expect(result.silentFixes.some((f) => f.category === 'zero-width-chars')).toBe(true);
  });

  it('escapes a bare ampersand without double-escaping an existing entity', () => {
    const xml = wrap('<string name="a">Tom & Jerry &amp; friends</string>');
    const result = repairAndroidXml(xml);
    expect(result.fixedXml).toContain('Tom &amp; Jerry &amp; friends');
    expect(result.silentFixes.some((f) => f.category === 'bare-ampersand')).toBe(true);
  });

  it('keeps ZWJ and ZWNJ, which carry meaning (emoji sequences, Persian/Indic spelling)', () => {
    const xml = wrap('<string name="family">\u{1F468}\u200D\u{1F469}\u200D\u{1F467}</string>\n<string name="fa">\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645</string>');
    const result = repairAndroidXml(xml);
    expect(result.fixedXml).toBe(xml);
    expect(result.silentFixes).toEqual([]);
  });

  it('leaves a raw "&" inside comments and CDATA untouched', () => {
    const xml = wrap('<!-- Tom & Jerry -->\n<string name="a"><![CDATA[<b>Tom & Jerry</b>]]></string>');
    const result = repairAndroidXml(xml);
    expect(result.fixedXml).toBe(xml);
    expect(result.silentFixes.some((f) => f.category === 'bare-ampersand')).toBe(false);
  });

  it('keeps entities declared in the DOCTYPE', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE resources [\n  <!ENTITY appname "My App">\n]>\n' +
      '<resources>\n<string name="title">Welcome to &appname;</string>\n</resources>\n';
    const result = repairAndroidXml(xml);
    expect(result.fixedXml).toBe(xml);
    expect(result.silentFixes).toEqual([]);
    expect(result.blockingIssues.some((i) => i.category === 'undefined-entity')).toBe(false);
  });

  it('rewrites common HTML entities as equivalent numeric references', () => {
    const result = repairAndroidXml(wrap('<string name="a">Wait&hellip; 5&nbsp;km</string>'));
    expect(result.fixedXml).toContain('Wait&#8230; 5&#160;km');
    expect(result.silentFixes.some((f) => f.category === 'html-entity')).toBe(true);
    expect(result.blockingIssues).toEqual([]);
  });

  it('gives ids that are unique within one result and restart for each call', () => {
    const xml = '\uFEFF' + wrap('<string name="a">A & B\u200B</string>').replace(/\n/g, '\r\n');
    const first = repairAndroidXml(xml);
    const ids = first.silentFixes.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(repairAndroidXml(xml).silentFixes.map((f) => f.id)).toEqual(ids);
  });

  it('reports no silent fixes for an already-clean file', () => {
    const result = repairAndroidXml(wrap('<string name="a">hello</string>'));
    expect(result.silentFixes).toEqual([]);
  });
});

describe('repairAndroidXml / review issues', () => {
  it('flags a raw unescaped apostrophe', () => {
    const xml = wrap(`<string name="quoted_message">'{username}' said: ''Hello!''</string>`);
    const result = repairAndroidXml(xml);
    const found = result.reviewIssues.find((i) => i.category === 'unescaped-apostrophe');
    expect(found?.stringName).toBe('quoted_message');
  });

  it('does not flag a backslash-escaped apostrophe', () => {
    const xml = wrap(`<string name="a">it\\'s fine</string>`);
    const result = repairAndroidXml(xml);
    expect(result.reviewIssues.some((i) => i.category === 'unescaped-apostrophe')).toBe(false);
  });

  it('does not flag a whole value wrapped in double quotes', () => {
    const xml = wrap(`<string name="a">"it's fine"</string>`);
    const result = repairAndroidXml(xml);
    expect(result.reviewIssues.some((i) => i.category === 'unescaped-apostrophe')).toBe(false);
  });

  it('flags an apostrophe that follows an escaped backslash, as in a Windows path', () => {
    const xml = wrap(String.raw`<string name="a">C:\\'s drive</string>`);
    const result = repairAndroidXml(xml);
    expect(result.reviewIssues.find((i) => i.category === 'unescaped-apostrophe')?.params?.count).toBe(1);
  });

  it('ignores apostrophes inside inline tag attributes', () => {
    const xml = wrap(`<string name="a">Open <a href='https://example.com'>the site</a></string>`);
    const result = repairAndroidXml(xml);
    expect(result.reviewIssues.some((i) => i.category === 'unescaped-apostrophe')).toBe(false);
  });

  it('does not count commented-out entries as duplicates', () => {
    const xml = wrap('<!-- <string name="dup">old</string> -->\n<string name="dup">new</string>');
    const result = repairAndroidXml(xml);
    expect(result.reviewIssues.some((i) => i.category === 'duplicate-name')).toBe(false);
  });

  it('flags duplicate string names', () => {
    const xml = wrap('<string name="dup">one</string>\n<string name="dup">two</string>');
    const result = repairAndroidXml(xml);
    const found = result.reviewIssues.find((i) => i.category === 'duplicate-name');
    expect(found?.stringName).toBe('dup');
    expect(found?.params?.count).toBe(2);
  });
});

describe('repairAndroidXml / blocking issues', () => {
  it('surfaces a parse error for truly malformed XML', () => {
    const xml = wrap('<string name="a">unterminated');
    const result = repairAndroidXml(xml);
    expect(result.blockingIssues.length).toBeGreaterThan(0);
    expect(result.blockingIssues[0].category).toBe('xml-parse-error');
  });

  it('blocks an entity reference XML does not define, naming it', () => {
    const result = repairAndroidXml(wrap('<string name="a">&foo; bar</string>'));
    const found = result.blockingIssues.find((i) => i.category === 'undefined-entity');
    expect(found?.params?.names).toBe('&foo;');
  });

  it('blocks a well-formed file that has no strings, instead of failing after the report', () => {
    const result = repairAndroidXml('\uFEFF<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n');
    expect(result.blockingIssues.map((i) => i.category)).toEqual(['no-strings']);
  });

  it('returns the parsed result so the caller does not parse again', () => {
    const result = repairAndroidXml(wrap('<string name="a">hello</string>'));
    expect(result.parsed.items).toHaveLength(1);
    expect(result.parsed.errors).toEqual([]);
  });

  it('has no blocking issues for a well-formed file', () => {
    const result = repairAndroidXml(wrap('<string name="a">hello</string>'));
    expect(result.blockingIssues).toEqual([]);
  });
});

describe('repairAndroidXml / the reported ICU test file', () => {
  it('flags exactly the apostrophe issue in quoted_message and nothing else', () => {
    const xml = wrap(`
      <string name="welcome_message">Welcome, {username}!</string>
      <string name="notification_count">
        {count, plural,
            =0 {No notifications}
            one {# notification}
            other {# notifications}
        }
      </string>
      <string name="quoted_message">
        '{username}' said: ''Hello!''
      </string>
    `);
    const result = repairAndroidXml(xml);
    expect(result.silentFixes).toEqual([]);
    expect(result.blockingIssues).toEqual([]);
    expect(result.reviewIssues).toHaveLength(1);
    expect(result.reviewIssues[0].stringName).toBe('quoted_message');
  });
});
