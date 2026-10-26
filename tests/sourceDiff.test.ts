// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseAndroidXml } from '../src/utils/xmlParser';
import { diffSources, mergeSourceUpdate } from '../src/utils/sourceDiff';
import type { SingleStringItem } from '../src/types';

const parse = (body: string) => parseAndroidXml(`<resources>${body}</resources>`).items;

describe('source diff', () => {
  const current = parse('<string name="a">Hello</string><string name="b">Bye</string><string name="c">Old</string>').map((i) =>
    i.type === 'string' ? ({ ...i, target: `ar-${i.name}`, status: 'translated' } as SingleStringItem) : i
  );
  const incoming = parse('<string name="a">Hello</string><string name="b">Goodbye</string><string name="d">New</string>');

  it('classifies added, removed, changed and unchanged by name', () => {
    expect(diffSources(current, incoming)).toEqual({ added: ['d'], removed: ['c'], changed: ['b'], unchanged: ['a'] });
  });

  it('keeps translations, flags changed sources for review and drops removed strings', () => {
    const merged = mergeSourceUpdate(current, incoming) as SingleStringItem[];
    expect(merged.map((i) => i.name)).toEqual(['a', 'b', 'd']);
    expect(merged[0]).toMatchObject({ target: 'ar-a', status: 'translated', id: current[0].id });
    expect(merged[1]).toMatchObject({ source: 'Goodbye', target: 'ar-b', status: 'needs_review' });
    expect(merged[2]).toMatchObject({ source: 'New', target: '', status: 'untranslated' });
  });
});
