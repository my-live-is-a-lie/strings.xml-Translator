import { describe, expect, it } from 'vitest';
import { diffWords } from '../src/utils/textDiff';

describe('diffWords', () => {
  it('marks removed words in the old text and added words in the new text', () => {
    const { old, next } = diffWords('Save the file now', 'Save your file');
    expect(old.filter((s) => s.kind === 'del').map((s) => s.text.trim())).toEqual(['the', 'now']);
    expect(next.filter((s) => s.kind === 'add').map((s) => s.text.trim())).toEqual(['your']);
    expect(old.map((s) => s.text).join('')).toBe('Save the file now');
    expect(next.map((s) => s.text).join('')).toBe('Save your file');
  });
  it('identical text has no changes', () => {
    const { old, next } = diffWords('Same text', 'Same text');
    expect(old).toEqual([{ text: 'Same text', kind: 'same' }]);
    expect(next).toEqual([{ text: 'Same text', kind: 'same' }]);
  });
});
