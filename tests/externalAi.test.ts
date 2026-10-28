// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseAndroidXml } from '../src/utils/xmlParser';
import { applyTranslations, buildSegments, checkReply, parseReply, splitParts } from '../src/utils/externalAi';

const items = parseAndroidXml(
  '<resources><string name="a">Hello %s</string><string name="b">Save</string><plurals name="p"><item quantity="one">%d file</item><item quantity="other">%d files</item></plurals></resources>'
).items;

describe('external AI flow', () => {
  const segs = buildSegments(items, 'en');

  it('numbers strings and plural parts', () => {
    expect(segs.map((s) => s.key)).toEqual(['a', 'b', 'p#one', 'p#other']);
    expect(segs.map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });

  it('splits into parts', () => {
    expect(splitParts([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(splitParts([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });

  it('reads replies with fences, chatter, arrays and maps', () => {
    const fenced = 'Sure!\n```json\n{"translations":[{"id":1,"text":"مرحبا %s"},{"id":2,"text":"حفظ"}]}\n```\nDone.';
    expect([...parseReply(fenced).entries()]).toEqual([[1, 'مرحبا %s'], [2, 'حفظ']]);
    expect(parseReply('[{"id":3,"text":"x"}]').get(3)).toBe('x');
    expect(parseReply('{"1":"أ","2":"ب"}').get(2)).toBe('ب');
    expect(() => parseReply('no json here')).toThrow('NO_JSON');
    expect(() => parseReply('{"translations": [oops]}')).toThrow('BAD_JSON');
  });

  it('flags missing ids, lost placeholders, untranslated and unknown ids', () => {
    const reply = parseReply('{"translations":[{"id":1,"text":"مرحبا"},{"id":2,"text":"Save"},{"id":3,"text":"%d ملف"},{"id":99,"text":"?"}]}');
    const { rows, unknownIds } = checkReply(segs, reply);
    expect(rows.map((r) => r.issues)).toEqual([['placeholder'], ['same'], [], ['missing']]);
    expect(unknownIds).toEqual([99]);
  });

  it('applies accepted rows as AI translations and keeps incomplete plurals unchanged in status', () => {
    const reply = parseReply('{"translations":[{"id":1,"text":"مرحبا %s"},{"id":3,"text":"%d ملف"}]}');
    const { rows } = checkReply(segs, reply);
    const applied = applyTranslations(items, 'en', rows.filter((r) => r.issues.length === 0));
    expect(applied.map((i) => i.name)).toEqual(['a', 'p']);
    expect(applied[0]).toMatchObject({ target: 'مرحبا %s', status: 'translated', translationSource: 'ai', translationEngine: 'external-ai' });
    expect(applied[1].status).toBe('untranslated'); // only one of two quantities answered
  });

  it('reads a reply that was copied with Markdown backslash-escaping', () => {
    const escaped = '{ "translations": \\[ { "id": 1, "text": "سطر\\\\\\\\nثان" }, { "id": 2, "text": "قال \\\\\\\\\\\\"نعم\\\\\\\\\\\\"" }, \\] }';
    const r = parseReply(escaped);
    expect(r.get(1)).toBe('سطر\\nثان');
    expect(r.get(2)).toBe('قال \\"نعم\\"');
  });

  it('tolerates a trailing comma', () => {
    expect(parseReply('{"translations":[{"id":1,"text":"a"},]}').get(1)).toBe('a');
  });
});
