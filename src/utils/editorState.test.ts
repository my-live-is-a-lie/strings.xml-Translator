import { describe, it, expect } from 'vitest';
import { dropPreviousSourceWhenSaved } from './editorState';
import type { ResourceItem } from '../types';

const mk = (o: Record<string, unknown>) => ({ id: 'a', name: 'a', type: 'string', source: 's', target: 't', ...o }) as unknown as ResourceItem;

describe('dropPreviousSourceWhenSaved', () => {
  it('clears the new/updated flag once the string is translated and saved', () => {
    const out = dropPreviousSourceWhenSaved(mk({ status: 'translated', sourceChange: 'added' }));
    expect(out.sourceChange).toBeUndefined();
  });
  it('keeps the flag while the string is not translated yet', () => {
    const out = dropPreviousSourceWhenSaved(mk({ status: 'untranslated', sourceChange: 'added' }));
    expect(out.sourceChange).toBe('added');
  });
});
