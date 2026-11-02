import { describe, expect, it } from 'vitest';
import { generateEnglishUiXml, parseUiXml } from './stringsXml';

describe('UI strings.xml', () => {
  it('round-trips the generated English file', () => {
    const xml = generateEnglishUiXml();
    const { found, unknown } = parseUiXml(xml);
    expect(found).toBeGreaterThan(300);
    expect(unknown).toBe(0);
  });
  it('keeps empty values empty and ignores unknown keys', () => {
    const { strings, unknown } = parseUiXml(
      '<resources><string name="keyboard_shortcuts"></string><string name="nope">x</string><string name="add_lang_title">It\\\'s &amp; ok</string></resources>'
    );
    expect(strings.keyboard_shortcuts).toBe('');
    expect(strings.add_lang_title).toBe("It's & ok");
    expect(unknown).toBe(1);
  });
});
