import { describe, it, expect } from 'vitest';
import { abortable } from '../src/utils/nativeHttp';

describe('abortable (native request abort)', () => {
  it('rejects with AbortError when the signal aborts first', async () => {
    const c = new AbortController();
    const p = abortable(new Promise(() => {}), c.signal);
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects at once when already aborted', async () => {
    const c = new AbortController();
    c.abort();
    await expect(abortable(Promise.resolve(1), c.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('passes the value through and works without a signal', async () => {
    expect(await abortable(Promise.resolve(7))).toBe(7);
    expect(await abortable(Promise.resolve(8), new AbortController().signal)).toBe(8);
  });
});
