import { describe, it, expect } from 'vitest';
import { fixTargetEnding, fixItemEndings, sourceEnding } from './endPunctuation';
import type { ResourceItem } from '../types';

describe('fixTargetEnding (editor form)', () => {
  it('appends a missing final mark from the source', () => {
    expect(fixTargetEnding('You finished first!', 'لقد أنهيت أولاً')).toEqual({
      text: 'لقد أنهيت أولاً!',
      changed: true,
    });
  });

  it('replaces a different final mark', () => {
    expect(fixTargetEnding('Really?', 'حقًا.')).toEqual({ text: 'حقًا؟', changed: true });
  });

  it('uses the Arabic question mark for Arabic-script text', () => {
    expect(fixTargetEnding('Really?', 'حقًا')).toEqual({ text: 'حقًا؟', changed: true });
  });

  it('matches equivalent marks: "…" equals "..."', () => {
    expect(fixTargetEnding('Wait...', 'انتظر…').changed).toBe(false);
  });

  it('removes trailing whitespace the source does not have', () => {
    expect(fixTargetEnding('Hello!', 'مرحبا!  ')).toEqual({ text: 'مرحبا!', changed: true });
  });

  it('keeps trailing whitespace the source also has (pretty-print formatting)', () => {
    expect(fixTargetEnding('Hello!\n    ', 'مرحبا!\n    ')).toEqual({ text: 'مرحبا!\n    ', changed: false });
  });

  it('leaves an empty target alone', () => {
    expect(fixTargetEnding('Hello!', '')).toEqual({ text: '', changed: false });
    expect(fixTargetEnding('Hello!', '   ')).toEqual({ text: '   ', changed: false });
  });
});

describe('fixItemEndings (stored target, editor source)', () => {
  const makeString = (source: string, target: string): ResourceItem =>
    ({ id: 'ranking', type: 'string', key: 'ranking', name: 'ranking', order: 0, source, target, status: 'translated' }) as ResourceItem;

  it('regression: no extra "!" when a stored `!\\n` tail already matches the source ending', () => {
    // pretty-printed ranking string: source in editor form, target in stored form (save pipeline shape)
    const source = '\n        You finished {position, selectordinal,\n            one {#st}\n            other {#th}\n        }!\n    ';
    const target = '\\n        لقد أنهيت {position, selectordinal,\\n            one {#st}\\n            other {#th}\\n        }!\\n    ';
    const r = fixItemEndings(makeString(source, target));
    expect(r.changed).toBe(false);
    expect(r.item.type === 'string' && r.item.target).toBe(target);
  });

  it('appends a genuinely missing mark and returns stored form', () => {
    const source = '\n        You finished {position, selectordinal,\n            other {#th}\n        }!\n    ';
    const target = '\\n        لقد أنهيت {position, selectordinal,\\n            other {#th}\\n        }\\n    ';
    const r = fixItemEndings(makeString(source, target));
    expect(r.changed).toBe(true);
    expect(r.item.type === 'string' && r.item.target).toBe(
      '\\n        لقد أنهيت {position, selectordinal,\\n            other {#th}\\n        }!'
    );
  });

  it('sourceEnding ignores trailing whitespace', () => {
    expect(sourceEnding('Done!\n    ')).toBe('!');
    expect(sourceEnding('Done')).toBeNull();
  });
});
