import { describe, it, expect } from 'vitest';
import { sourceRatio } from './sourceSync';

const src = 'First paragraph here.\\n\\nSecond paragraph is a bit longer than the first.\\n\\nThird one.\\n\\nFourth and last paragraph.';

describe('sourceRatio', () => {
  it('is 0 for an empty translation or empty source', () => {
    expect(sourceRatio('', 0, src)).toBe(0);
    expect(sourceRatio('abc', 3, '')).toBe(0);
  });

  it('stays inside 0..1', () => {
    for (const c of [-5, 0, 10, 999]) {
      const r = sourceRatio('x'.repeat(40), c, src);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('follows the paragraph being typed, even when the translation is shorter so far', () => {
    const t1 = 'الفقرة الأولى هنا.\\n\\n';
    const atSecond = sourceRatio(t1 + 'الفقرة', t1.length + 6, src);
    const secondStart = src.indexOf('Second') / src.length;
    const thirdStart = src.indexOf('Third') / src.length;
    expect(atSecond).toBeGreaterThanOrEqual(secondStart);
    expect(atSecond).toBeLessThan(thirdStart);
  });

  it('moves forward monotonically while typing', () => {
    const full = 'الأولى هنا.\\n\\nالثانية أطول قليلًا من الأولى.\\n\\nالثالثة.\\n\\nالرابعة والأخيرة.';
    let last = -1;
    for (let c = 0; c <= full.length; c += 3) {
      const r = sourceRatio(full.slice(0, c), c, src);
      expect(r).toBeGreaterThanOrEqual(last - 1e-9);
      last = r;
    }
  });

  it('works with real newlines and with a different number of paragraphs', () => {
    const s = 'a one\nb two\nc three\nd four';
    const t = 'x\ny\nz\nw\nv\nu';
    const r = sourceRatio(t, t.length, s);
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThanOrEqual(1);
  });

  it('falls back to sentences, then to the plain ratio, when there are no breaks', () => {
    const sentences = 'One sentence here. Another sentence here. Third sentence here.';
    const t = 'جملة هنا. جملة أخرى هنا.';
    expect(sourceRatio(t, t.length, sentences)).toBeGreaterThan(0.3);
    const plain = 'word '.repeat(40).trim();
    const half = 'كلمة '.repeat(20);
    const r = sourceRatio(half, half.length, plain);
    expect(r).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(0.8);
  });
});
