import { describe, expect, it } from 'vitest';
import { autoCloseOnDoubleSpace } from './autoCloseBracket';

const type = (before: string) => {
  const next = before + '  ';
  return autoCloseOnDoubleSpace(before + ' ', next, next.length)?.text;
};

describe('autoCloseOnDoubleSpace', () => {
  it('closes brackets and quotes', () => {
    expect(type('هذا (نص')).toBe('هذا (نص) ');
    expect(type('قال "مرحبا')).toBe('قال "مرحبا" ');
    expect(type("say 'hi")).toBe("say 'hi' ");
    expect(type('آية ﴿قل هو الله')).toBe('آية ﴿قل هو الله﴾ ');
    expect(type('قال ‘نعم')).toBe('قال ‘نعم’ ');
  });
  it('ignores closed quotes and apostrophes inside words', () => {
    expect(type('قال "نعم" ثم')).toBeUndefined();
    expect(type("don't stop")).toBeUndefined();
    expect(type('<a href="x">link')).toBeUndefined();
  });
});

describe('keyboards that turn a double space into ". "', () => {
  it('drops the added period and closes', () => {
    const prev = 'قال "نعم ';
    const next = 'قال "نعم. ';
    expect(autoCloseOnDoubleSpace(prev, next, next.length)?.text).toBe('قال "نعم" ');
  });
  it('leaves a typed period alone', () => {
    expect(autoCloseOnDoubleSpace('قال "نعم.', 'قال "نعم. ', 10)).toBeNull();
  });
});
