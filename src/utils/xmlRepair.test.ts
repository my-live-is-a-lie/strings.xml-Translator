// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { repairAndroidXml } from './xmlRepair';

function wrap(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}\n</resources>\n`;
}

describe('repairAndroidXml / silent fixes', () => {
  it('strips a leading BOM', () => {
    const result = repairAndroidXml('﻿' + wrap('<string name="a">hi</string>'));
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
    const xml = wrap('<string name="a">hi​there</string>');
    const result = repairAndroidXml(xml);
    expect(result.fixedXml.includes('​')).toBe(false);
    expect(result.silentFixes.some((f) => f.category === 'zero-width-chars')).toBe(true);
  });

  it('escapes a bare ampersand without double-escaping an existing entity', () => {
    const xml = wrap('<string name="a">Tom & Jerry &amp; friends</string>');
    const result = repairAndroidXml(xml);
    expect(result.fixedXml).toContain('Tom &amp; Jerry &amp; friends');
    expect(result.silentFixes.some((f) => f.category === 'bare-ampersand')).toBe(true);
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

  it('flags duplicate string names', () => {
    const xml = wrap('<string name="dup">one</string>\n<string name="dup">two</string>');
    const result = repairAndroidXml(xml);
    const found = result.reviewIssues.find((i) => i.category === 'duplicate-name');
    expect(found?.stringName).toBe('dup');
    expect(found?.message).toContain('2');
  });
});

describe('repairAndroidXml / blocking issues', () => {
  it('surfaces a parse error for truly malformed XML', () => {
    const xml = wrap('<string name="a">unterminated');
    const result = repairAndroidXml(xml);
    expect(result.blockingIssues.length).toBeGreaterThan(0);
    expect(result.blockingIssues[0].category).toBe('xml-parse-error');
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
