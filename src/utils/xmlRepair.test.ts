// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  repairAndroidXml,
  isEntryExclusion,
  checkTargetFileIcu,
  applyReviewDecisions,
  RESOURCE_TYPE_BY_TAG,
  RESOURCE_TAG_BY_TYPE,
} from './xmlRepair';

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
    expect(found?.resourceType).toBe('string');
    expect(found?.params?.count).toBe(2);
  });

  it('gives an unescaped-apostrophe issue a range and suggestedFix that round-trips through fixedXml', () => {
    const xml = wrap(`<string name="quoted_message">'{username}' said hi</string>`);
    const result = repairAndroidXml(xml);
    const found = result.reviewIssues.find((i) => i.category === 'unescaped-apostrophe')!;
    expect(found.resourceType).toBe('string');
    expect(found.range).toBeTruthy();
    expect(result.fixedXml.slice(found.range!.start, found.range!.end)).toBe(`'{username}' said hi`);
    expect(found.suggestedFix).toBe(`\\'{username}\\' said hi`);
  });
});

describe('repairAndroidXml / plurals and string-array resources', () => {
  it('flags an unescaped apostrophe inside a <plurals> item, naming its quantity', () => {
    const xml = wrap(
      '<plurals name="price">\n' +
        '  <item quantity="one">%d dollar</item>\n' +
        "  <item quantity=\"other\">%d dollars, that's all</item>\n" +
        '</plurals>'
    );
    const result = repairAndroidXml(xml);
    const found = result.reviewIssues.find((i) => i.category === 'unescaped-apostrophe')!;
    expect(found.stringName).toBe('price');
    expect(found.resourceType).toBe('plural');
    expect(found.itemQualifier).toBe('other');
    expect(result.fixedXml.slice(found.range!.start, found.range!.end)).toBe("%d dollars, that's all");
  });

  it('flags an unescaped apostrophe inside a <string-array> item, naming its index', () => {
    const xml = wrap(
      '<string-array name="flavors">\n' +
        '  <item>vanilla</item>\n' +
        "  <item>rocky road's special</item>\n" +
        '</string-array>'
    );
    const result = repairAndroidXml(xml);
    const found = result.reviewIssues.find((i) => i.category === 'unescaped-apostrophe')!;
    expect(found.stringName).toBe('flavors');
    expect(found.resourceType).toBe('array');
    expect(found.itemQualifier).toBe('1');
  });

  it('flags a duplicate <plurals> name separately from a duplicate <string> name', () => {
    const xml = wrap(
      '<plurals name="dup"><item quantity="one">a</item></plurals>\n' +
        '<plurals name="dup"><item quantity="one">b</item></plurals>'
    );
    const result = repairAndroidXml(xml);
    const found = result.reviewIssues.find((i) => i.category === 'duplicate-name');
    expect(found?.stringName).toBe('dup');
    expect(found?.resourceType).toBe('plural');
  });

  it('does not treat a <string> and a <plurals> sharing the same name as duplicates', () => {
    const xml = wrap('<string name="shared">one</string>\n<plurals name="shared"><item quantity="other">%d</item></plurals>');
    const result = repairAndroidXml(xml);
    expect(result.reviewIssues.some((i) => i.category === 'duplicate-name')).toBe(false);
  });

  it('a self-closed <plurals/> does not swallow the block that follows it', () => {
    const xml = wrap(
      '<plurals name="empty"/>\n' +
        '<plurals name="apples">\n' +
        "  <item quantity=\"other\">%d apples, that's plenty</item>\n" +
        '</plurals>\n' +
        '<plurals name="apples">\n' +
        '  <item quantity="other">%d more apples</item>\n' +
        '</plurals>'
    );
    const result = repairAndroidXml(xml);
    // The apostrophe belongs to the real "apples" block, not to the self-closed "empty" one.
    const apostrophe = result.reviewIssues.find((i) => i.category === 'unescaped-apostrophe');
    expect(apostrophe?.stringName).toBe('apples');
    // And both real "apples" blocks are counted, so the duplicate is still reported.
    const duplicate = result.reviewIssues.find((i) => i.category === 'duplicate-name' && i.resourceType === 'plural');
    expect(duplicate?.stringName).toBe('apples');
  });

  it('a self-closed <string-array/> does not swallow the block that follows it', () => {
    const xml = wrap(
      '<string-array name="empty"/>\n' +
        '<string-array name="flavors">\n' +
        "  <item>rocky road's special</item>\n" +
        '</string-array>'
    );
    const result = repairAndroidXml(xml);
    const apostrophe = result.reviewIssues.find((i) => i.category === 'unescaped-apostrophe');
    expect(apostrophe?.stringName).toBe('flavors');
    expect(apostrophe?.resourceType).toBe('array');
  });
});

describe('repairAndroidXml / blocking issues', () => {
  it('excludes multiple broken entries while importing b and d', () => {
    const result = repairAndroidXml(wrap(
      '<string name="a">unclosed\n<string name="b">fine</string>\n' +
      '<string name="c">mismatched</wrong>\n<string name="d">also fine</string>'
    ));
    expect(result.parsed.errors).toEqual([]);
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b', 'd']);
    expect(result.blockingIssues.map((i) => [i.category, i.stringName])).toEqual([
      ['malformed-entry', 'a'],
      ['malformed-entry', 'c'],
    ]);
  });

  it('excludes an unclosed plurals resource and keeps the next string', () => {
    const result = repairAndroidXml(wrap(
      '<plurals name="count"><item quantity="other">many</item>\n<string name="b">fine</string>'
    ));
    expect(result.parsed.errors).toEqual([]);
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b']);
    expect(result.blockingIssues).toEqual([
      expect.objectContaining({ category: 'malformed-entry', stringName: 'count', resourceType: 'plural' }),
    ]);
  });

  it('reports a broken entry and a nameless entry in the same file', () => {
    const result = repairAndroidXml(wrap(
      '<string name="a">unclosed\n<string>nameless</string>\n<string name="b">fine</string>'
    ));
    expect(result.parsed.errors).toEqual([]);
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b']);
    expect(result.blockingIssues).toEqual([
      expect.objectContaining({ category: 'malformed-entry', stringName: 'a' }),
      expect.objectContaining({ category: 'missing-name', resourceType: 'string' }),
    ]);
  });

  it('keeps the whole-file parse failure for a dangling tag after the resources root', () => {
    const xml = wrap('<string name="b">fine</string>') + '\n<string name="late">unclosed';
    const result = repairAndroidXml(xml);
    expect(result.fixedXml).toBe(xml);
    expect(result.parsed.errors.length).toBeGreaterThan(0);
    expect(result.blockingIssues.map((i) => i.category)).toEqual(['xml-parse-error']);
  });
  it('surfaces a parse error for XML broken in a way that is not just one dangling resource tag', () => {
    // Two sibling <resources> roots: not something excludeMalformedEntries's single-entry heuristic can
    // repair, so this still surfaces the raw parser error exactly as before Phase 3.
    const xml = '<resources><string name="a">one</string></resources><resources></resources>';
    const result = repairAndroidXml(xml);
    expect(result.blockingIssues.length).toBeGreaterThan(0);
    expect(result.blockingIssues[0].category).toBe('xml-parse-error');
  });

  it('excludes a single unclosed <string>, naming it, instead of failing the whole file (Phase 3)', () => {
    const xml = wrap('<string name="a">unterminated\n<string name="b">fine</string>');
    const result = repairAndroidXml(xml);
    const malformed = result.blockingIssues.find((i) => i.category === 'malformed-entry');
    expect(malformed?.stringName).toBe('a');
    expect(result.parsed.errors).toEqual([]);
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b']);
  });

  it('reports no-strings alongside the malformed-entry issue when the only entry was the broken one', () => {
    const xml = wrap('<string name="a">unterminated');
    const result = repairAndroidXml(xml);
    expect(result.blockingIssues.map((i) => i.category)).toEqual(
      expect.arrayContaining(['malformed-entry', 'no-strings'])
    );
    expect(result.parsed.items).toEqual([]);
  });

  it('excludes a <string> closed with a mismatched tag name, naming it', () => {
    const xml = wrap(
      '<string name="a">oops</strong>\n<string name="b">fine</string>'
    );
    const result = repairAndroidXml(xml);
    const malformed = result.blockingIssues.find((i) => i.category === 'malformed-entry');
    expect(malformed?.stringName).toBe('a');
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b']);
  });

  it('reports a <string> missing its name attribute, without excluding or touching anything else', () => {
    const xml = wrap('<string>no name here</string>\n<string name="b">fine</string>');
    const result = repairAndroidXml(xml);
    const missingName = result.blockingIssues.find((i) => i.category === 'missing-name');
    expect(missingName).toBeTruthy();
    expect(missingName?.resourceType).toBe('string');
    expect(result.parsed.errors).toEqual([]);
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b']);
    // Nothing was excised for this case - fixedXml is unchanged apart from earlier silent fixes.
    expect(result.fixedXml).toContain('<string>no name here</string>');
  });

  it('does not treat a self-closed resource as dangling regardless of a missing name', () => {
    const xml = wrap('<string-array/>\n<string name="b">fine</string>');
    const result = repairAndroidXml(xml);
    expect(result.blockingIssues).toEqual([]);
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b']);
  });

  it('labels an unclosed <string-array> as an array, not a <string>', () => {
    const xml = wrap('<string-array name="arr">\n  <item>x</item>\n<string name="b">fine</string>');
    const result = repairAndroidXml(xml);
    const malformed = result.blockingIssues.find((i) => i.category === 'malformed-entry');
    expect(malformed?.stringName).toBe('arr');
    expect(malformed?.resourceType).toBe('array');
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b']);
  });

  it('reports nothing for a valid file whose CDATA contains literal <string> markup', () => {
    const xml = wrap(
      '<string name="html"><![CDATA[<p>Use <string> tags</p>]]></string>\n<string name="b">fine</string>'
    );
    const result = repairAndroidXml(xml);
    expect(result.blockingIssues).toEqual([]);
    expect(result.parsed.items.map((i) => i.name)).toEqual(['html', 'b']);
  });

  it('keeps a comment on its own line between an excluded entry and the next one', () => {
    const xml = wrap('<string name="a">oops\n    <!-- Settings screen -->\n    <string name="b">fine</string>');
    const result = repairAndroidXml(xml);
    expect(result.fixedXml).toContain('<!-- Settings screen -->');
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b']);
    expect(result.parsed.items[0].comment).toBe('Settings screen');
  });

  it('does not report an undefined entity that was only inside the excluded entry', () => {
    const xml = wrap('<string name="a">&foo; oops\n<string name="b">fine</string>');
    const result = repairAndroidXml(xml);
    expect(result.blockingIssues.map((i) => i.category)).toEqual(['malformed-entry']);
    expect(result.parsed.items.map((i) => i.name)).toEqual(['b']);
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

describe('applyReviewDecisions', () => {
  it('returns the identical string when nothing is accepted', () => {
    const xml = wrap(`<string name="a">it's fine</string>`);
    const result = repairAndroidXml(xml);
    expect(applyReviewDecisions(result.fixedXml, result.reviewIssues, new Set())).toBe(result.fixedXml);
  });

  it('applies only the accepted fix, leaving an unaccepted one untouched', () => {
    const xml = wrap(
      `<string name="a">it's fine</string>\n<string name="b">it's also fine</string>`
    );
    const result = repairAndroidXml(xml);
    const [first, second] = result.reviewIssues;
    const applied = applyReviewDecisions(result.fixedXml, result.reviewIssues, new Set([first.id]));

    expect(applied).toContain("it\\'s fine");
    expect(applied).toContain("it's also fine"); // second issue's fix was not accepted
    // Re-running the repair on the already-fixed text finds only the still-unfixed one.
    expect(repairAndroidXml(applied).reviewIssues).toHaveLength(1);
    expect(repairAndroidXml(applied).reviewIssues[0].stringName).toBe(second.stringName);
  });

  it('ignores an id with no safe suggested fix (e.g. duplicate-name)', () => {
    const xml = wrap('<string name="dup">one</string>\n<string name="dup">two</string>');
    const result = repairAndroidXml(xml);
    const dup = result.reviewIssues.find((i) => i.category === 'duplicate-name')!;
    expect(applyReviewDecisions(result.fixedXml, result.reviewIssues, new Set([dup.id]))).toBe(result.fixedXml);
  });

  it('applies two accepted fixes in the same file correctly, in either order', () => {
    const xml = wrap(`<string name="a">it's fine</string>\n<string name="b">that's ok</string>`);
    const result = repairAndroidXml(xml);
    const ids = new Set(result.reviewIssues.map((i) => i.id));
    const applied = applyReviewDecisions(result.fixedXml, result.reviewIssues, ids);
    // The title promises order-independence, so actually check it: same result with the issue list reversed.
    expect(applyReviewDecisions(result.fixedXml, [...result.reviewIssues].reverse(), ids)).toBe(applied);
    expect(applied).toContain("it\\'s fine");
    expect(applied).toContain("that\\'s ok");
    expect(repairAndroidXml(applied).reviewIssues).toEqual([]);
  });

  it('skips an out-of-bounds or overlapping range instead of corrupting the text', () => {
    const xml = wrap(`<string name="a">it's fine</string>`);
    const result = repairAndroidXml(xml);
    const real = result.reviewIssues[0];
    const outOfBounds = { ...real, id: 'oob', range: { start: 0, end: result.fixedXml.length + 10 } };
    expect(applyReviewDecisions(result.fixedXml, [outOfBounds], new Set(['oob']))).toBe(result.fixedXml);

    const overlapping = { ...real, id: 'overlap', range: { start: real.range!.start + 1, end: real.range!.end + 1 } };
    const both = applyReviewDecisions(result.fixedXml, [real, overlapping], new Set([real.id, 'overlap']));
    // Only one of the two overlapping fixes may land; never both spliced on top of each other.
    expect(both).toBe(applyReviewDecisions(result.fixedXml, [overlapping], new Set(['overlap'])));
  });
});

describe('repairAndroidXml / commented-out content', () => {
  it('skips a commented-out <item> inside a live <plurals>', () => {
    const xml = wrap(
      '<plurals name="price">\n' +
        "  <!-- <item quantity=\"few\">that's old</item> -->\n" +
        '  <item quantity="other">%d dollars</item>\n' +
        '</plurals>'
    );
    expect(repairAndroidXml(xml).reviewIssues).toEqual([]);
  });

  it('still scans a real <string> that follows a comment holding an unclosed <string> tag', () => {
    const xml = wrap('<!-- <string name="old">legacy value -->\n' + `<string name="greeting">it's here</string>`);
    const result = repairAndroidXml(xml);
    const found = result.reviewIssues.find((i) => i.category === 'unescaped-apostrophe');
    expect(found?.stringName).toBe('greeting');
    expect(result.fixedXml.slice(found!.range!.start, found!.range!.end)).toBe("it's here");
  });

  it('keeps a comment inside a value byte-for-byte in suggestedFix', () => {
    const xml = wrap(`<string name="a">it's <!-- don't touch --> ok</string>`);
    const found = repairAndroidXml(xml).reviewIssues[0];
    expect(found.params?.count).toBe(1);
    expect(found.suggestedFix).toBe("it\\'s <!-- don't touch --> ok");
  });
});

describe('RESOURCE_TYPE_BY_TAG / RESOURCE_TAG_BY_TYPE', () => {
  it('covers every resource tag with a unique kind', () => {
    expect(RESOURCE_TYPE_BY_TAG).toEqual({
      string: 'string',
      plurals: 'plural',
      'string-array': 'array',
    });
    const kinds = Object.values(RESOURCE_TYPE_BY_TAG);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('exports the inverse map that ImportModal uses for its localized messages', () => {
    expect(RESOURCE_TAG_BY_TYPE).toEqual({
      string: 'string',
      plural: 'plurals',
      array: 'string-array',
    });
    for (const [tag, kind] of Object.entries(RESOURCE_TYPE_BY_TAG)) {
      expect(RESOURCE_TAG_BY_TYPE[kind]).toBe(tag);
    }
  });
});

describe('issue #33 phase 4a: unterminated ICU quote (#14)', () => {
  const cats = (r: ReturnType<typeof repairAndroidXml>) => r.blockingIssues.map((i) => i.category);

  it('excludes a string whose quote before { never closes and keeps the rest', () => {
    const r = repairAndroidXml(wrap(`  <string name="bad">'{username} said hi</string>\n  <string name="ok">hello</string>`));
    expect(cats(r)).toEqual(['unterminated-icu-quote']);
    expect(r.blockingIssues[0]).toMatchObject({ stringName: 'bad', resourceType: 'string' });
    expect(r.fixedXml).not.toContain('bad');
    expect(r.parsed.items.map((i) => i.name)).toEqual(['ok']);
    expect(r.reviewIssues.some((i) => i.stringName === 'bad')).toBe(false);
  });

  it('is an entry exclusion, not a whole-file rejection', () => {
    const r = repairAndroidXml(wrap(`  <string name="bad">'{x</string>\n  <string name="ok">hi</string>`));
    expect(isEntryExclusion(r.blockingIssues[0])).toBe(true);
  });

  it('does not flag contractions or a properly closed quote', () => {
    const r = repairAndroidXml(wrap(`  <string name="a">it's and don't {name}</string>\n  <string name="b">Type '{' to open, '}' to close</string>\n  <string name="c">It''s {n}</string>`));
    expect(cats(r)).toEqual([]);
  });

  it('does not treat an escaped apostrophe before { as an ICU quote', () => {
    const r = repairAndroidXml(wrap(`  <string name="a">Say \\'{name}</string>\n  <string name="b">Say &apos;{name}</string>\n  <string name="c">Say &#39;{name}</string>`));
    expect(cats(r)).toEqual([]);
  });

  it('ignores <plurals> item bodies', () => {
    const r = repairAndroidXml(wrap(`  <plurals name="p">\n    <item quantity="one">'{one</item>\n    <item quantity="other">'{other</item>\n  </plurals>\n  <string name="ok">x</string>`));
    expect(cats(r)).toEqual([]);
  });

  it('excludes the whole array when one item has an open quote', () => {
    const r = repairAndroidXml(wrap(`  <string-array name="arr">\n    <item>a</item>\n    <item>'{b</item>\n    <item>c</item>\n  </string-array>\n  <string name="ok">x</string>`));
    expect(r.blockingIssues).toHaveLength(1);
    expect(r.blockingIssues[0]).toMatchObject({ resourceType: 'array', itemQualifier: '1', stringName: 'arr' });
    expect(r.parsed.items.map((i) => i.name)).toEqual(['ok']);
  });

  it('ignores a commented-out entry', () => {
    const r = repairAndroidXml(wrap(`  <!-- <string name="old">'{x</string> -->\n  <string name="ok">x</string>`));
    expect(cats(r)).toEqual([]);
  });

  it('leaves a file with every entry broken as no-strings', () => {
    const r = repairAndroidXml(wrap(`  <string name="bad">'{x</string>`));
    expect(cats(r)).toEqual(expect.arrayContaining(['unterminated-icu-quote', 'no-strings']));
  });
});

describe('issue #33 phase 4a: mixed placeholder systems (#18)', () => {
  const mixed = (r: ReturnType<typeof repairAndroidXml>) => r.reviewIssues.filter((i) => i.category === 'mixed-placeholders');

  it('reports %s together with {name} as an informational review issue', () => {
    const r = repairAndroidXml(wrap(`  <string name="m">Hi %1$s, you have {count} items</string>`));
    const found = mixed(r);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ tier: 'review', stringName: 'm', params: { printf: '%1$s', icu: '{count}' } });
    expect(found[0].suggestedFix).toBeUndefined();
    expect(found[0].range).toBeUndefined();
  });

  it('reports a mixed array item with its index', () => {
    const r = repairAndroidXml(wrap(`  <string-array name="a">\n    <item>ok</item>\n    <item>%s {x}</item>\n  </string-array>`));
    expect(mixed(r)[0]).toMatchObject({ resourceType: 'array', itemQualifier: '1' });
  });

  it('does not flag a single placeholder system', () => {
    const r = repairAndroidXml(wrap(`  <string name="a">Hi %1$s, %2$d left</string>\n  <string name="b">Hi {name}, {n} left</string>\n  <string name="c">100%% done {n}</string>\n  <string name="d">20%off {n}</string>`));
    expect(mixed(r)).toHaveLength(0);
  });

  it('does not flag a brace-free ICU-less %s, or a quoted literal brace', () => {
    const r = repairAndroidXml(wrap(`  <string name="a">%s '{literal}'</string>`));
    expect(mixed(r)).toHaveLength(0);
  });

  it('skips <plurals> item bodies', () => {
    const r = repairAndroidXml(wrap(`  <plurals name="p">\n    <item quantity="one">%d {x}</item>\n    <item quantity="other">%d {x}</item>\n  </plurals>`));
    expect(mixed(r)).toHaveLength(0);
  });

  it('does not stop the import or change fixedXml', () => {
    const xml = wrap(`  <string name="m">Hi %s {n}</string>`);
    const r = repairAndroidXml(xml);
    expect(r.blockingIssues).toEqual([]);
    expect(r.fixedXml).toBe(xml);
  });
});

describe('issue #33 phase 4b: ICU structure checks on the source', () => {
  const blocking = (r: ReturnType<typeof repairAndroidXml>) => r.blockingIssues.map((i) => `${i.category}:${i.stringName}`);
  const review = (r: ReturnType<typeof repairAndroidXml>, cat: string) => r.reviewIssues.filter((i) => i.category === cat);
  const ok = `  <string name="ok">fine</string>`;

  it('#13 excludes a clear ICU block that never closes, keeps the rest', () => {
    const r = repairAndroidXml(wrap(`  <string name="n">{count, plural, one {# item} other {# items}</string>\n${ok}`));
    expect(blocking(r)).toEqual(['unbalanced-icu-block:n']);
    expect(r.parsed.items.map((i) => i.name)).toEqual(['ok']);
  });

  it('#13 excludes a block missing an inner close too', () => {
    const r = repairAndroidXml(wrap(`  <string name="n">{count, plural, one {# item other {# items}}</string>\n${ok}`));
    expect(blocking(r)).toEqual(['unbalanced-icu-block:n']);
  });

  it('#13 does not touch a stray } in prose such as a smiley', () => {
    const r = repairAndroidXml(wrap(`  <string name="a">Thanks :-}</string>\n  <string name="b">Use } to close</string>`));
    expect(r.blockingIssues).toEqual([]);
    expect(r.reviewIssues.filter((i) => i.category === 'unmatched-brace')).toEqual([]);
  });

  it('#13 only reviews a lone { that is not ICU-shaped', () => {
    const r = repairAndroidXml(wrap(`  <string name="a">Hello {name</string>\n  <string name="b">function() {</string>`));
    expect(r.blockingIssues).toEqual([]);
    expect(review(r, 'unmatched-brace').map((i) => i.stringName)).toEqual(['a']);
  });

  it('#15 excludes a keyword one or two edits from plural/select', () => {
    const r = repairAndroidXml(wrap(`  <string name="p">{count, plurall, one {# a} other {# b}}</string>\n  <string name="s">{g, selct, male {He} other {They}}</string>\n${ok}`));
    expect(blocking(r)).toEqual(['unknown-icu-keyword:p', 'unknown-icu-keyword:s']);
  });

  it('#15 only reviews a far-off keyword that still has clause structure', () => {
    const r = repairAndroidXml(wrap(`  <string name="p">{x, banana, one {a} other {b}}</string>`));
    expect(r.blockingIssues).toEqual([]);
    const r2 = repairAndroidXml(wrap(`  <string name="p">{x, banana, one {a} other {b}}</string>\n${ok}`));
    expect(r2.blockingIssues).toEqual([]);
    expect(review(r2, 'suspect-icu-keyword')).toHaveLength(1);
  });

  it('#15 never flags valid types, skeletons, choice or plain prose pairs', () => {
    const r = repairAndroidXml(wrap([
      `  <string name="a">{0, number, #,##0.00}</string>`,
      `  <string name="b">{p, number, ::currency/USD}</string>`,
      `  <string name="c">{d, date, short}</string>`,
      `  <string name="d">{n, choice, 0#none|1#one|1&lt;many}</string>`,
      `  <string name="e">{red, green}</string>`,
      `  <string name="f">{n, ordinal}</string>`,
    ].join('\n')));
    expect(r.blockingIssues).toEqual([]);
    expect(r.reviewIssues).toEqual([]);
  });

  it('#16 reviews a plural/select with no other, including a nested one', () => {
    const r = repairAndroidXml(wrap([
      `  <string name="a">{count, plural, one {# item}}</string>`,
      `  <string name="b">{g, select, male {{n, plural, one {x} other {y}}} female {z}}</string>`,
      ok,
    ].join('\n')));
    expect(r.blockingIssues).toEqual([]);
    const found = review(r, 'missing-other-branch');
    expect(found.map((i) => `${i.stringName}:${i.params?.arg}`)).toEqual(['a:count', 'b:g']);
    expect(found[0].suggestedFix).toBeUndefined();
  });

  it('#16 does not require other inside <plurals> items or when other exists', () => {
    const r = repairAndroidXml(wrap(`  <plurals name="p">\n    <item quantity="one">{x, select, a {b}}</item>\n    <item quantity="other">y</item>\n  </plurals>\n  <string name="s">{c, plural, one {#} other {#}}</string>`));
    expect(r.reviewIssues).toEqual([]);
  });

  it('#17 reviews a repeated clause key', () => {
    const r = repairAndroidXml(wrap(`  <string name="a">{c, plural, one {#} other {x} other {y}}</string>`));
    const found = review(r, 'duplicate-icu-category');
    expect(found).toHaveLength(1);
    expect(found[0].params).toMatchObject({ detail: 'other', arg: 'c' });
  });

  it('does not flag normal valid ICU, offsets, nested blocks, quoted braces or escaped apostrophes', () => {
    const r = repairAndroidXml(wrap([
      `  <string name="a">{n, plural, offset:1 =0 {none} one {# more} other {# more}}</string>`,
      `  <string name="b">{g, select, male {{n, plural, one {a} other {b}}} other {c}}</string>`,
      `  <string name="c">Say '{'hi'}' and it''s {name}</string>`,
      `  <string name="d">Don\\'t {n, plural, one {x} other {y}}</string>`,
      `  <string name="e">{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}</string>`,
    ].join('\n')));
    expect(r.blockingIssues).toEqual([]);
    // (the raw-apostrophe review on `c` is the pre-existing check, not an ICU finding)
    expect(r.reviewIssues.map((i) => i.category)).toEqual(['unescaped-apostrophe']);
  });

  it('excludes the whole array for a blocking array item', () => {
    const r = repairAndroidXml(wrap(`  <string-array name="arr">\n    <item>a</item>\n    <item>{n, plural, one {x}</item>\n  </string-array>\n${ok}`));
    expect(r.blockingIssues).toHaveLength(1);
    expect(r.blockingIssues[0]).toMatchObject({ category: 'unbalanced-icu-block', resourceType: 'array', itemQualifier: '1' });
    expect(r.parsed.items.map((i) => i.name)).toEqual(['ok']);
  });

  it('ignores <plurals> bodies for blocking checks', () => {
    const r = repairAndroidXml(wrap(`  <plurals name="p">\n    <item quantity="one">{n, plurall, one {x}</item>\n    <item quantity="other">y</item>\n  </plurals>`));
    expect(r.blockingIssues).toEqual([]);
  });
});

describe('issue #33 phase 4c: merged target file is reported, never excluded', () => {
  it('turns every finding into a review issue and does not modify anything', () => {
    const target = wrap([
      `  <string name="a">'{x said</string>`,
      `  <string name="b">{count, plurall, one {#} other {#}}</string>`,
      `  <string name="c">{count, plural, one {#}</string>`,
      `  <string name="d">{count, plural, one {#}}</string>`,
      `  <string name="e">Hi %s {n}</string>`,
      `  <string name="f">fine</string>`,
    ].join('\n'));
    const issues = checkTargetFileIcu(target);
    expect(issues.every((i) => i.tier === 'review' && i.category === 'target-icu')).toBe(true);
    expect(issues.map((i) => `${i.stringName}:${i.params?.kind}`)).toEqual([
      'a:unterminated-icu-quote',
      'b:unknown-icu-keyword',
      'c:unbalanced-icu-block',
      'd:missing-other-branch',
      'e:mixed-placeholders',
    ]);
    expect(issues.every((i) => i.range === undefined && i.suggestedFix === undefined)).toBe(true);
  });

  it('reports nothing for a clean target, skips plurals bodies and an unparseable file', () => {
    expect(checkTargetFileIcu(wrap(`  <string name="a">{n, plural, one {#} other {#}}</string>`))).toEqual([]);
    expect(checkTargetFileIcu(wrap(`  <plurals name="p">\n    <item quantity="one">'{x</item>\n    <item quantity="other">y</item>\n  </plurals>`))).toEqual([]);
    expect(checkTargetFileIcu('<resources><string name="a">oops</resources>')).toEqual([]);
  });
});
