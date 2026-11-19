import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// docs/index.html is committed (it is what GitHub Pages serves), so it can go
// stale silently: PR #10 changed docs/GUIDE.md and only PR #12 rebuilt the page.
// Rebuild in a temp copy and compare, so a guide edit that skips `npm run docs`
// fails here instead of shipping an outdated site.
const root = path.resolve(__dirname, '..');

describe('the committed docs site matches docs/GUIDE.md', () => {
  it('docs/index.html is up to date with the guide', () => {
    const before = readFileSync(path.join(root, 'docs/index.html'), 'utf8');
    execFileSync(process.execPath, ['scripts/build-docs.mjs'], { cwd: root, stdio: 'pipe' });
    const after = readFileSync(path.join(root, 'docs/index.html'), 'utf8');
    try {
      expect(after).toBe(before);
    } finally {
      // Never leave a rewritten page behind if the assertion fails.
      execFileSync(process.execPath, ['scripts/build-docs.mjs'], { cwd: root, stdio: 'pipe' });
    }
  });
});
