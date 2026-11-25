import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loadSample, mockProviderApi, openAppWithProvider, openDrawer, trackErrors } from './helpers';

test('loads the sample, keeps edits after a reload, and logs no errors', async ({ page }) => {
  const errors = trackErrors(page);
  await openAppWithProvider(page);
  await loadSample(page);

  await page.locator('textarea').first().fill('اختبار الحفظ 123');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(1200); // writes are debounced
  await page.reload();
  await expect(page.locator('body')).toContainText('اختبار الحفظ 123');
  expect(errors).toEqual([]);
});

test('a legacy plain-text API key is encrypted, and the decrypted key reaches the batch request', async ({ page }) => {
  const hits: string[] = [];
  await mockProviderApi(page, hits);
  await openAppWithProvider(page, 'SECRET-KEY-123');
  await page.reload(); // migration runs on startup

  const stored = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('strings_translator_db');
        open.onsuccess = () => {
          const db = open.result;
          const dump: Record<string, unknown[]> = {};
          const stores = Array.from(db.objectStoreNames);
          let left = stores.length;
          for (const name of stores) {
            const req = db.transaction(name).objectStore(name).getAll();
            req.onsuccess = () => {
              dump[name] = req.result;
              if (--left === 0) resolve(JSON.stringify(dump) + JSON.stringify(Object.assign({}, localStorage)));
            };
          }
        };
      })
  );
  expect(stored).not.toContain('SECRET-KEY-123');

  await loadSample(page);
  await page.getByText(/تحديد غير المترجم/).first().click();
  await page.click('#stringlist-bulk-translate-btn');
  await page.click('#bulk-provider-start'); // the provider picker opens first (the saved provider is preselected)
  await expect.poll(() => hits.some((h) => h.startsWith('batch:'))).toBe(true);
  expect(hits.every((h) => h.endsWith(':SECRET-KEY-123'))).toBe(true);
});

test('"?" opens the shortcuts dialog and Escape closes it', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: /اختصارات|shortcuts/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('export is blocked on placeholder errors until the user acknowledges them', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-export-btn');
  const download = page.locator('#export-save-btn');
  await expect(page.locator('#export-allow-broken')).toBeVisible();
  await expect(download).toBeDisabled();
  await page.locator('#export-allow-broken').check();
  await expect(download).toBeEnabled();
});

test('exports a zip named <project>-values-<lang> containing strings.xml', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-export-btn');
  // The sample has placeholder warnings that block export until acknowledged.
  await page.locator('#export-allow-broken').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-save-btn')]);
  expect(download.suggestedFilename()).toBe('XML_Translator-values-ar.zip');
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const zipPath = join(dir, 'out.zip');
  await download.saveAs(zipPath);
  const listing = execFileSync('unzip', ['-Z1', zipPath]).toString().split('\n').filter((l) => l && !l.endsWith('/'));
  expect(listing).toEqual(['strings.xml']);
});

test('the share button falls back to a download when the browser cannot share a zip', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-export-btn');
  await page.locator('#export-allow-broken').check();
  // Desktop Chromium cannot share an application/zip file; the share click must not error out,
  // it quietly downloads the same zip instead.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-share-btn')]);
  expect(download.suggestedFilename()).toBe('XML_Translator-values-ar.zip');
  await expect(page.locator('#export-save-btn')).toBeEnabled();
});

test('updating the source file keeps translations and reports what changed', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-update-source-btn');
  await page.fill(
    '#update-source-text',
    '<resources><string name="app_name">OmniTask 2</string><string name="action_save">Save Changes</string><string name="brand_new">Brand new text</string></resources>'
  );
  await expect(page.getByText(/1 جديد · 1 متغيّر · 16 محذوف · 1 دون تغيير/)).toBeVisible();
  await page.click('#update-source-apply');
  await expect(page.locator('#string-item-brand_new')).toBeVisible();
  await expect(page.locator('#string-item-action_cancel')).toHaveCount(0);
});

test('translates several languages and downloads a ZIP with one values folder each', async ({ page }) => {
  const errors = trackErrors(page);
  await mockProviderApi(page);
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-multilang-btn');
  await page.locator('input[data-lang="fr"]').check();
  await page.locator('input[data-lang="pt-rBR"]').check();
  await expect(page.locator('#multilang-provider option')).not.toHaveCount(0);
  await page.click('#multilang-start');
  await expect(page.getByText(/2 جاهزة/)).toBeVisible({ timeout: 30_000 });

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#multilang-download')]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const zipPath = join(dir, 'out.zip');
  await download.saveAs(zipPath);
  const listing = execFileSync('unzip', ['-Z1', zipPath]).toString().split('\n').filter((l) => l && !l.endsWith('/')).sort();
  expect(listing).toEqual(['values-fr/strings.xml', 'values-pt-rBR/strings.xml']);
  expect(execFileSync('unzip', ['-p', zipPath, 'values-fr/strings.xml']).toString()).toContain('fr ');
  expect(errors).toEqual([]);
});

test('the editor buttons move through the strings', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  const counter = page.locator('text=/^\\d+ \\/ \\d+$/').first();
  // The Arabic sample pre-merges 6 translated strings, which sort first, so the editor
  // opens on the first untranslated string at position 7 of 18.
  await expect(counter).toHaveText('7 / 18');
  await page.locator('textarea').first().fill('نص تجريبي');
  await page.getByText('حفظ ومتابعة').click();
  await expect(counter).toHaveText('8 / 18');
  await page.locator('#weblate-skip-btn').click();
  await expect(counter).toHaveText('9 / 18');
});

test('server health endpoint answers and metrics stay hidden without a token', async ({ request }) => {
  const health = await request.get('/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ status: 'ok' });
  expect((await request.get('/metrics')).status()).toBe(404);
});

test('quick filters: multi-select, count badge, hide/show, and they are remembered', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await page.setViewportSize({ width: 390, height: 800 });

  const btn = page.locator('[data-quick-filters-btn]:visible');
  await expect(page.locator('[data-quick-filters-bar]')).toHaveCount(0);
  await btn.click();
  await expect(page.locator('[data-quick-filters-bar]:visible')).toBeVisible();

  await page.locator('[data-filter="untranslated"]:visible').click();
  await expect(btn).toContainText('1');
  await page.locator('[data-filter="manual"]:visible').click();
  await expect(btn).toContainText('2');
  await page.locator('[data-filter="manual"]:visible').click(); // toggling again disables it
  await expect(btn).toContainText('1');

  await btn.click(); // hides the bar but keeps the filter
  await expect(page.locator('[data-quick-filters-bar]')).toHaveCount(0);
  await expect(btn).toContainText('1');

  await page.reload();
  await expect(page.locator('[data-quick-filters-btn]:visible')).toContainText('1');
});

test('the strings list and the table open on the string being translated', async ({ page }) => {
  await mockProviderApi(page);
  await openAppWithProvider(page);
  await loadSample(page);
  const counter = page.locator('text=/^\\d+ \\/ \\d+$/').first();
  // Reopen at phone size: the strings list remembers where it was left, and the desktop list must not set that
  await page.setViewportSize({ width: 390, height: 520 });
  await page.reload();
  await expect(counter).toBeVisible();
  for (let i = 0; i < 20 && (await counter.textContent()) !== '15 / 18'; i++) await page.locator('#weblate-skip-btn').click();
  await expect(counter).toHaveText('15 / 18');

  const inView = async (sel: string) =>
    page.evaluate((s) => {
      const el = Array.from(document.querySelectorAll<HTMLElement>(s)).find((e) => e.offsetParent !== null);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    }, sel);

  await page.locator('#mobile-drawer-btn').click();
  await expect.poll(() => inView('[data-item-id].ring-1')).toBe(true);
  const selectedItemId = await page.locator('[data-item-id].ring-1').first().getAttribute('data-item-id');
  await page.locator('button[title="إغلاق القائمة"]').click();
  await page.waitForTimeout(400);

  await page.locator('#header-mobile-view-toggle-btn').click();
  await page.waitForTimeout(500);
  await expect.poll(() => inView(`[data-item-id="${selectedItemId}"]`)).toBe(true);
});

test('quick filters drive the editor and hide filters that have no strings', async ({ page }) => {
  await mockProviderApi(page);
  await openAppWithProvider(page);
  await loadSample(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('[data-quick-filters-btn]:visible').click();

  // The sample has no AI-translated strings, so that filter is hidden
  await expect(page.locator('[data-filter="ai"]')).toHaveCount(0);
  await expect(page.locator('[data-filter="review"]')).toHaveCount(0); // nothing to review: the filter is hidden
  await expect(page.locator('[data-filter="untranslated"]:visible')).toBeEnabled();

  const counter = page.locator('text=/^\\d+ \\/ \\d+$/').first();
  // The editor opens on the first untranslated string, which sorts at position 7
  // (the 6 pre-merged Arabic translations sort first).
  await expect(counter).toHaveText('7 / 18');
  await page.locator('[data-filter="translated"]:visible').click();
  const total = Number((await counter.innerText()).split('/')[1]);
  expect(total).toBeLessThan(18);
  await page.locator('[data-filter="translated"]:visible').click();
  await expect(counter).toHaveText(/\/ 18$/);
});

test('a string saved under the "untranslated" filter stays reachable', async ({ page }) => {
  await mockProviderApi(page);
  await openAppWithProvider(page);
  await loadSample(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('[data-quick-filters-btn]:visible').click();
  await page.locator('[data-filter="untranslated"]:visible').click();

  const counter = page.locator('text=/^\\d+ \\/ \\d+$/').first();
  await expect(counter).toHaveText(/^1 \/ \d+$/);
  const total = (await counter.innerText()).split('/')[1].trim();
  await page.locator('textarea').first().fill('نص تجريبي');
  await page.getByText('حفظ ومتابعة').click();
  await expect(counter).toHaveText(`2 / ${total}`); // total unchanged: the saved string wasn't dropped
  await page.getByText('السابق').click();
  await expect(counter).toHaveText(`1 / ${total}`);
  await expect(page.locator('textarea').first()).toHaveValue('نص تجريبي');
});

/** The row's key line opens the string (tapping the texts below it expands the row instead). */
const openFromList = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`#string-item-${name}`).click({ position: { x: 60, y: 12 } });

test('after a source update the "new" filter turns on, changed strings show a diff, and saving removes the old text', async ({ page }) => {
  await mockProviderApi(page);
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-update-source-btn');
  await page.fill(
    '#update-source-text',
    '<resources><string name="app_name">OmniTask 2</string><string name="action_save">Save all the Changes</string><string name="brand_new">Brand new text</string></resources>'
  );
  await page.click('#update-source-apply');

  await expect(page.locator('[data-filter="new"]:visible')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-filter="review"]:visible')).toBeVisible(); // the changed string needs review
  await expect(page.locator('[data-source-change="added"]:visible').first()).toBeVisible();
  // Only the strings from the update are listed
  await expect(page.locator('#string-item-brand_new')).toBeVisible();
  await expect(page.locator('#string-item-action_cancel')).toHaveCount(0);

  await openFromList(page, 'action_save');
  await expect(page.locator('[data-source-diff]')).toBeVisible();
  await expect(page.locator('[data-source-diff] mark')).toContainText('all');
  await page.getByText('حفظ ومتابعة').click();
  await openFromList(page, 'action_save');
  await expect(page.locator('[data-source-diff]')).toHaveCount(0);
  await expect(page.locator('#string-item-action_save')).toBeVisible(); // still listed under "new"
});

test('bulk translation asks which provider to use first', async ({ page }) => {
  const hits: string[] = [];
  await mockProviderApi(page, hits);
  await openAppWithProvider(page, 'BULK-KEY-1');
  await loadSample(page);

  await page.getByText(/تحديد غير المترجم/).first().click();
  await page.click('#stringlist-bulk-translate-btn');
  const dialog = page.getByRole('dialog', { name: /اختر مزوّد الترجمة/ });
  await expect(dialog).toBeVisible();
  expect(hits).toEqual([]); // nothing is sent before a provider is confirmed
  await expect(dialog.locator('input[type="radio"]')).toHaveCount(4); // Google, MyMemory, the saved DeepL provider and the external-AI option
  await dialog.locator('input[data-provider-id="t1"]').check();
  await page.click('#bulk-provider-start');
  await expect.poll(() => hits.some((h) => h.endsWith(':BULK-KEY-1'))).toBe(true);
});

test('external AI flow: request files, paste a reply, validate, review and apply', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await page.getByText(/تحديد غير المترجم/).first().click();
  await page.click('#stringlist-bulk-translate-btn');
  await page.locator('input[data-provider-id="__external_ai__"]').check();
  await page.click('#bulk-provider-start');

  const dialog = page.getByRole('dialog', { name: /الترجمة عبر تطبيق ذكاء اصطناعي/ });
  await expect(dialog).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.locator('[data-ext="download"]').click()]);
  expect(download.suggestedFilename()).toBe('strings-to-translate.json');

  // A reply wrapped in chatter and a code fence, answering only the first string, with a lost placeholder-free text
  await page.fill('#ext-reply', 'Sure!\n```json\n{"translations":[{"id":1,"text":"ترجمة تجريبية"}]}\n```');
  await page.click('#ext-check');
  await expect(dialog.locator('[data-ext="summary"]')).toContainText(/^1 من \d+ مترجمة/);
  await expect(dialog.locator('[data-ext="review-list"] li').first()).toBeVisible();
  await page.click('#ext-apply');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('body')).toContainText('ترجمة تجريبية');
});

test('external AI request can also include the strings that need review', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-update-source-btn');
  await page.fill(
    '#update-source-text',
    '<resources><string name="app_name">OmniTask</string><string name="action_save">Save all the Changes</string><string name="brand_new">Brand new text</string></resources>'
  );
  await page.click('#update-source-apply'); // action_save changed -> needs review, brand_new -> untranslated

  await page.getByText(/تحديد غير المترجم/).first().click();
  await page.click('#stringlist-bulk-translate-btn');
  await page.locator('input[data-provider-id="__external_ai__"]').check();
  await page.click('#bulk-provider-start');
  const dialog = page.getByRole('dialog', { name: /الترجمة عبر تطبيق ذكاء اصطناعي/ });
  const count = async () => Number(((await dialog.locator('[data-ext="part-count"]').first().innerText()).match(/\d+/) || [])[0]);
  const before = await count();
  await dialog.locator('#ext-include-review').check();
  expect(await count()).toBeGreaterThan(before);
});

test('the top area slides away only when the keyboard leaves too little room, and returns afterwards', async ({ page }) => {
  await page.goto('/');
  await loadSample(page);
  await page.setViewportSize({ width: 390, height: 800 });
  const top = page.locator('#mobile-drawer-btn');
  const box = page.locator('textarea').first();
  // plenty of room: typing does not hide anything
  await box.focus();
  await page.waitForTimeout(500);
  await expect(top).toBeVisible();
  await box.blur();
  // a long text genuinely leaves too little room once the keyboard is up
  await box.fill('سطر طويل للاختبار\n'.repeat(25));
  // keyboard-sized viewport: the content no longer fits, so the top area collapses
  await page.setViewportSize({ width: 390, height: 380 });
  await box.focus();
  await expect(top).toBeHidden({ timeout: 3000 });
  await expect(box).toBeInViewport();
  // closing the keyboard brings it back
  await box.blur();
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(top).toBeVisible({ timeout: 3000 });
});

test('a long source gets a short window that follows the translation; short texts and big screens are untouched', async ({ page }) => {
  const para = (n: number) => `Paragraph ${n} says something fairly long so that it wraps across a few lines on a phone screen.`;
  const source = [1, 2, 3, 4, 5, 6].map(para).join('\\n\\n');
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="long_one">${source}</string>\n</resources>`;
  await page.goto('/');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  const src = page.locator('[data-src-text]');
  const box = page.locator('textarea#weblate-translation-input');
  await expect(src).toBeVisible();

  // a big screen: nothing is limited, even while typing
  await box.focus();
  await page.waitForTimeout(600);
  expect(await src.evaluate((el) => el.style.maxHeight)).toBe('');
  await box.blur();

  // keyboard-sized viewport: the source is limited to a window and stays fully inside the screen
  await page.setViewportSize({ width: 390, height: 430 });
  await box.focus();
  await expect.poll(() => src.evaluate((el) => el.style.maxHeight), { timeout: 4000 }).not.toBe('');
  const inScreen = async (sel: string) =>
    page.evaluate((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight + 1;
    }, sel);
  expect(await inScreen('[data-src-text]')).toBe(true);
  expect(await inScreen('#weblate-translation-input')).toBe(true);
  const lines = await src.evaluate((el) => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight));
  expect(lines).toBeGreaterThanOrEqual(2.9);
  expect(lines).toBeLessThanOrEqual(12.1); // the space is shared with the translation box, not a fixed cap

  // typing paragraph by paragraph moves the window down the source
  const at = () => src.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(500);
  const start = await at();
  const typed = [1, 2, 3, 4, 5, 6].map((n) => `الفقرة ${n} تقول شيئًا طويلًا إلى حد ما حتى تلتف عبر عدة أسطر.`).join('\\n\\n');
  await box.pressSequentially(typed, { delay: 2 });
  await expect.poll(at, { timeout: 4000 }).toBeGreaterThan(start + 20);

  // both boxes get the same number of lines (the space is shared), and the box still shows its last lines
  await page.waitForTimeout(500);
  const sizes = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-src-text]')!;
    const t = document.querySelector<HTMLElement>('textarea#weblate-translation-input')!;
    const cs = getComputedStyle(t);
    const pad = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((a, k) => a + (parseFloat(cs[k as 'paddingTop']) || 0), 0);
    return { src: s.clientHeight / parseFloat(getComputedStyle(s).lineHeight), box: (t.clientHeight - pad) / parseFloat(cs.lineHeight) };
  });
  expect(Math.abs(sizes.src - sizes.box)).toBeLessThanOrEqual(1.2);

  // a swipe on the capped translation box scrolls it: the box never resizes
  const snap = (el: Element) => { const t = el as HTMLElement; return `${t.offsetHeight}|${t.style.height}|${t.style.minHeight}`; };
  const h0 = await box.evaluate(snap);
  const mid = await box.evaluate((el) => {
    const mk = (y: number) => new Touch({ identifier: 1, target: el, clientX: 150, clientY: y });
    const fire = (type: string, y: number) =>
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [mk(y)], changedTouches: [mk(y)] }));
    fire('touchstart', 300);
    for (let y = 300; y <= 380; y += 10) fire('touchmove', y);
    const t = el as HTMLElement;
    const during = `${t.offsetHeight}|${t.style.height}|${t.style.minHeight}`; // while the finger is still down
    fire('touchend', 380);
    return during;
  });
  expect(mid).toBe(h0);
  expect(await box.evaluate(snap)).toBe(h0);

  // the two boxes scroll together, aligned at the start and at the end
  const range = (loc: typeof src) => loc.evaluate((el) => el.scrollHeight - el.clientHeight);
  const frac = async (loc: typeof src) => (await loc.evaluate((el) => el.scrollTop)) / (await range(loc));
  await page.waitForTimeout(900);
  await box.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => frac(src), { timeout: 3000 }).toBeLessThan(0.05);
  await page.waitForTimeout(900);
  await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => frac(src), { timeout: 3000 }).toBeGreaterThan(0.95);
  await page.waitForTimeout(900);
  await src.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => frac(box), { timeout: 3000 }).toBeLessThan(0.05);
  await page.waitForTimeout(900);
  await src.evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) / 2));
  await expect.poll(async () => Math.abs((await frac(box)) - 0.5), { timeout: 3000 }).toBeLessThan(0.08);

  // going back to the very start of the translation puts the source at its very start (not part-way)
  await page.waitForTimeout(900);
  await box.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => src.evaluate((el) => el.scrollTop), { timeout: 3000 }).toBeLessThan(2);
  await page.waitForTimeout(900);
  await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => frac(src), { timeout: 3000 }).toBeGreaterThan(0.95);
  await page.waitForTimeout(900);
  await box.evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => src.evaluate((el) => el.scrollTop), { timeout: 3000 }).toBeLessThan(2);

  // closing the keyboard removes every limit
  await box.blur();
  await page.setViewportSize({ width: 390, height: 800 });
  await expect.poll(() => src.evaluate((el) => el.style.maxHeight), { timeout: 4000 }).toBe('');
  expect(await box.evaluate((el) => (el as HTMLElement).style.maxHeight)).toBe('');
});

test('line breaks show as ↵, Enter writes them, and a different count cannot be saved', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="two_breaks">This video is age restricted.\\n\\nTurn on it in the settings.</string>\n</resources>`;
  await page.goto('/');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  const box = page.locator('textarea#weblate-translation-input');
  const guard = page.locator('[role=alert]');
  await expect(box).toBeVisible();

  // the source shows each \n as a ↵ mark followed by a real break (no \n text)
  const source = page.locator('[data-src-text]');
  expect(await source.innerText()).toBe('This video is age restricted.↵\n↵\nTurn on it in the settings.');

  // no breaks at all: refused, 2 missing
  await box.fill('تم تقييد هذا الفيديو. شغّله من الإعدادات.');
  await page.click('#weblate-save-stay-btn');
  await expect(guard).toContainText('ينقص سطران جديدان');
  // one break: 1 missing, and the message follows the text while typing
  await box.fill('تم تقييد هذا الفيديو.\nشغّله من الإعدادات.');
  await expect(guard).toContainText('ينقص سطر جديد واحد');
  // Enter once more and a hand-typed \n: now there are 3, one too many
  await box.press('Control+End');
  await box.press('Enter');
  await box.pressSequentially('\\n');
  expect(await box.inputValue()).toBe('تم تقييد هذا الفيديو.\nشغّله من الإعدادات.\n\n');
  await expect(guard).toHaveCount(0); // it went away while the count matched (2)...
  await page.click('#weblate-save-stay-btn');
  await expect(guard).toContainText('يزيد سطر جديد واحد'); // ...and saving with 3 is refused again

  // exactly two breaks: the message goes away and saving works
  await box.fill('تم تقييد هذا الفيديو.\n\nشغّله من الإعدادات.');
  await expect(guard).toHaveCount(0);
  await page.click('#weblate-save-stay-btn');
  await expect(guard).toHaveCount(0);
  await expect(page.getByText(/100%|\(1\/1\)/).first()).toBeVisible();
});

test('ICU branch editor: fields view edits each clause, raw view shows the same string, a broken block is still refused', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="msgs">{count, plural, one {# message} other {# messages}}</string>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  // an untranslated ICU string opens in the fields view: one field per clause, no raw textarea
  const fields = page.getByTestId('icu-fields');
  await expect(fields).toBeVisible();
  await expect(page.locator('textarea#weblate-translation-input')).toHaveCount(0);

  // typing in the clause fields rebuilds the whole message
  // (the default target is Arabic, so the plural block has the six Arabic categories)
  await page.getByTestId('icu-field-0:1').fill('# رسالة');
  await page.getByTestId('icu-field-0:5').fill('# رسائل');
  await page.click('#weblate-save-stay-btn');

  // the raw view shows exactly the reassembled string
  await page.getByTestId('icu-view-raw').click();
  const box = page.locator('textarea#weblate-translation-input');
  // the empty categories the editor shows are not saved: ICU would render an empty branch as nothing
  await expect(box).toHaveValue('{count, plural, one {# رسالة} other {# رسائل}}');

  // a broken block typed in raw mode is still blocked by the save gate
  await box.fill('{count, plural, one {# رسالة} other {# رسائل}');
  await page.click('#weblate-save-stay-btn');
  await expect(page.locator('[role=alert]')).toBeVisible();
  // and the fields view is not offered for a broken block
  await expect(page.getByTestId('icu-view-fields')).toHaveCount(0);

  // the raw view of a repaired block can go back to the fields view
  await box.fill('{count, plural, one {# رسالة} other {# رسائل}}');
  await page.getByTestId('icu-view-fields').click();
  await expect(page.getByTestId('icu-field-0:1')).toHaveValue('# رسالة');
});

test('the # warning is shown without blocking the save, and never replaces a real refusal', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="msgs">{count, plural, one {# message} other {# messages}}</string>\n    <string name="plain">Hello {name}</string>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  const warning = page.getByTestId('icu-hash-warning');
  // nothing typed yet: no warning, nothing to say
  await expect(warning).toHaveCount(0);

  // type an Arabic plural that spells one/two out: the number is still shown in few/many/other
  // (the default target is Arabic, so the plural block has the six Arabic categories)
  await page.getByTestId('icu-field-0:1').fill('# رسالة');
  await page.getByTestId('icu-field-0:5').fill('# رسائل');
  await expect(warning).toHaveCount(0);

  // a clause that drops the number entirely: the warning appears, and it is not an error
  await page.getByTestId('icu-field-0:1').fill('رسالة');
  await page.getByTestId('icu-field-0:5').fill('رسائل');
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute('role', 'status');

  // and the save goes through: the warning never becomes a guard
  await page.click('#weblate-save-stay-btn');
  await expect(page.locator('[role=alert]')).toHaveCount(0);
  await expect(page.getByText(/100%|\(1\/2\)/).first()).toBeVisible();

  // a damaged block still refuses, with the warning next to it rather than instead of it
  const box = page.locator('textarea#weblate-translation-input');
  await page.getByTestId('icu-view-raw').click();
  await box.fill('{count, plural, one {رسالة} other {رسائل}');
  await page.click('#weblate-save-stay-btn');
  await expect(page.locator('[role=alert]')).toBeVisible();

  // a string that counts nothing never shows the warning
  await box.fill('{count, plural, one {# رسالة} other {# رسائل}}');
  await page.click('#weblate-save-stay-btn');
  await page.getByRole('button', { name: /التالي|Next/ }).first().click();
  await expect(warning).toHaveCount(0);
});

test('import requires a project name and suggests it from the file, skipping strings.xml', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="greeting">Hello</string>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');

  // A meaningful file name fills the project name without its .xml extension.
  await page.locator('input[type=file]').first().setInputFiles({ name: 'ICU.MessageFormat.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await expect(page.locator('#import-project-name')).toHaveValue('ICU.MessageFormat');
  // The generic strings.xml carries no project name: the field clears for the user to type one.
  await page.locator('input[type=file]').first().setInputFiles({ name: 'strings.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await expect(page.locator('#import-project-name')).toHaveValue('');

  // Starting with an empty name is refused with an inline hint instead of a silent default.
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  await expect(page.getByRole('alert')).toContainText(/اسم المشروع|project name/);
  await expect(page.getByRole('button', { name: /بدء الترجمة|Start Translating/ })).toBeVisible();

  await page.fill('#import-project-name', 'MyApp');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  await expect(page.locator('#string-item-greeting')).toBeVisible();
});

test('a second import in the same session takes its name from its own file', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="greeting">Hello</string>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'strings.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await page.fill('#import-project-name', 'AppA');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  await expect(page.locator('#string-item-greeting')).toBeVisible();

  // The name typed for the first project must not carry over to the second file.
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'OtherApp.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await expect(page.locator('#import-project-name')).toHaveValue('OtherApp');
});

test('the typed project name is saved as the file name and names later exports', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="greeting">Hello</string>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'strings.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await page.fill('#import-project-name', 'MyApp');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  await expect(page.locator('#string-item-greeting')).toBeVisible();

  // Files are stored once they have edits, so make one and let the debounced save run.
  await page.locator('textarea').first().fill('مرحباً');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(1200);

  // The projects window lists the file under the typed project name, not strings.xml.
  await page.click('#header-files-menu-btn');
  const filesDialog = page.getByRole('dialog', { name: /المشاريع|Projects/ }).last();
  await expect(filesDialog).toContainText('MyApp');
  await expect(filesDialog.getByTitle('strings.xml')).toHaveCount(0);
  await page.click('#close-files-modal-btn');

  // After a reload the stored project still exports under the saved name. This file is clean,
  // so there is no placeholder warning to acknowledge.
  await page.reload();
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-export-btn');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-save-btn')]);
  expect(download.suggestedFilename()).toBe('MyApp-values-ar.zip');
});

test('import report: an unterminated ICU quote is left out and a mixed-placeholder value is flagged for review', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="greeting">Hello</string>\n    <string name="mixed">Hi %1$s, you have {count} new items</string>\n    <string name="broken_quote">'{username} said hi</string>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('mixed');
  await expect(dialog).toContainText('broken_quote');
  await expect(dialog).toContainText('%1$s');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/import-report-${process.env.SHOT_NAME ?? 'ar'}.png` });
});

test('import report: ICU structure findings on the source and on the merged translation file', async ({ page }) => {
  const source = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="greeting">Hello</string>\n    <string name="no_other">{count, plural, one {# item}}</string>\n    <string name="dup_key">{n, plural, one {#} other {a} other {b}}</string>\n    <string name="typo_keyword">{count, plurall, one {# a} other {# b}}</string>\n    <string name="unclosed_block">{count, plural, one {# a} other {# b}</string>\n</resources>`;
  const target = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="greeting">مرحبا</string>\n    <string name="no_other">{count, plural, one {# عنصر}}</string>\n    <string name="typo_keyword">{count, plurall, one {# أ} other {# ب}}</string>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  const inputs = page.locator('input[type=file]');
  await inputs.nth(0).setInputFiles({ name: 'strings.xml', mimeType: 'text/xml', buffer: Buffer.from(source) });
  await inputs.nth(1).setInputFiles({ name: 'strings-ar.xml', mimeType: 'text/xml', buffer: Buffer.from(target) });
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  const dialog = page.getByRole('dialog');
  // source: the two blocking entries are left out; the two review findings are listed
  await expect(dialog).toContainText('typo_keyword');
  await expect(dialog).toContainText('unclosed_block');
  await expect(dialog).toContainText('no_other');
  await expect(dialog).toContainText('dup_key');
  // target file: reported as review, in a clearly labelled line, and nothing was dropped
  await expect(dialog).toContainText('ملف الترجمة الذي أضفته');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/import-report-4b4c.png` });
});

test('import report: an escaped apostrophe before a brace is listed for review and the string is still imported', async ({ page }) => {
  const source = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="greeting">Hello</string>\n    <string name="escaped_quote">Hello \\'{name}</string>\n</resources>`;
  const target = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="greeting">مرحبا</string>\n    <string name="escaped_quote">مرحبا \\'{name}</string>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  const inputs = page.locator('input[type=file]');
  await inputs.nth(0).setInputFiles({ name: 'strings.xml', mimeType: 'text/xml', buffer: Buffer.from(source) });
  await inputs.nth(1).setInputFiles({ name: 'strings-ar.xml', mimeType: 'text/xml', buffer: Buffer.from(target) });
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('escaped_quote');
  await expect(dialog).toContainText('مُهرَّبة');
  await expect(dialog).toContainText('ملف الترجمة الذي أضفته');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/import-report-escaped-apos.png` });
});

test('plural categories follow the target language, not Arabic', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="msgs">{count, plural, one {# message} other {# messages}}</string>\n    <plurals name="files">\n        <item quantity="one">%d file</item>\n        <item quantity="other">%d files</item>\n    </plurals>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.locator('select').first().selectOption('hi');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  // Hindi uses one and other only: two fields, never the six Arabic categories
  await expect(page.getByTestId('icu-field-0:1')).toBeVisible();
  await expect(page.getByTestId('icu-field-0:2')).toHaveCount(0);
});

test('plural clone and paste act on the picked form only, and hint when none is picked', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <plurals name="files">\n        <item quantity="one">%d file</item>\n        <item quantity="other">%d files</item>\n    </plurals>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.locator('select').first().selectOption('ar');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  const fields = page.locator('textarea:visible');
  const count = await fields.count();
  const hint = page.getByTestId('plural-pick-hint');

  // The source section always shows the singular and the plural source, each with its own copy and clone
  await expect(page.getByTestId('plural-source-one')).toContainText('%d file');
  await expect(page.getByTestId('plural-source-other')).toContainText('%d files');
  await expect(page.getByTestId('plural-source-label-one')).toHaveText(/مفرد|Singular/);
  await expect(page.getByTestId('plural-source-label-other')).toHaveText(/الجمع|Plural/);
  // The label sits on the right of its box (opposite the English text direction), the same on every screen size
  for (const q of ['one', 'other']) {
    const label = (await page.getByTestId(`plural-source-label-${q}`).boundingBox())!;
    const box = (await page.getByTestId(`plural-source-label-${q}`).locator('xpath=..').boundingBox())!;
    expect(box.x + box.width - (label.x + label.width)).toBeLessThan(20);
    expect(await page.getByTestId(`plural-source-label-${q}`).evaluate((e) => getComputedStyle(e).textAlign)).toBe('right');
    // Clone button sits at the same level as the copy button
    const cl = (await page.locator(`#weblate-clone-source-${q}-btn`).boundingBox())!;
    const cp = (await page.getByTestId(`plural-source-copy-${q}`).boundingBox())!;
    expect(Math.abs((cl.y + cl.height / 2) - (cp.y + cp.height / 2))).toBeLessThan(2.5);
  }
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/plural-source-forms.png` });

  // Nothing picked: clone fills nothing and shows the hint
  await page.click('#weblate-clone-source-one-btn');
  await expect(hint).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/plural-pick-hint.png` });
  for (let i = 0; i < count; i++) await expect(fields.nth(i)).toHaveValue('');

  // Clone mode is on: a press anywhere else cancels it, and nothing is filled
  await page.locator('[data-src-text]').click();
  await expect(hint).toHaveCount(0);
  for (let i = 0; i < count; i++) await expect(fields.nth(i)).toHaveValue('');

  // Clone mode, then a click on a form fills that form only
  await page.click('#weblate-clone-source-one-btn');
  await expect(hint).toBeVisible();
  const highlighted = (i: number) => fields.nth(i).locator('xpath=ancestor::div[contains(@class,"cursor-pointer")]').count();
  expect(await highlighted(1)).toBeGreaterThan(0);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/plural-pick-mode.png` });
  await fields.nth(1).click();
  expect(await highlighted(1)).toBe(0);
  await expect(fields.nth(1)).toHaveValue('%d file');
  for (let i = 0; i < count; i++) if (i !== 1) await expect(fields.nth(i)).toHaveValue('');
  await expect(hint).toHaveCount(0);

  // A form clicked earlier but left again (focus moved away) is no longer picked: clone shows the hint
  await fields.nth(0).click();
  await page.locator('[data-src-text]').click();
  await page.click('#weblate-clone-source-one-btn');
  await expect(hint).toBeVisible();
  await page.locator('[data-src-text]').click();
  await expect(hint).toHaveCount(0);
  await expect(fields.nth(0)).toHaveValue('');

  // With a form already picked, clone fills it straight away
  await fields.nth(count - 1).click();
  await page.click('#weblate-clone-source-other-btn');
  await expect(fields.nth(count - 1)).toHaveValue('%d files');
  await expect(hint).toHaveCount(0);

  // Paste with a form clicked earlier but not focused now: hint and highlight, nothing written
  await page.evaluate(() => navigator.clipboard.writeText('نص ملصوق'));
  await fields.nth(0).click();
  await page.locator('[data-src-text]').click();
  await page.click('#paste-target-text-btn');
  await expect(hint).toBeVisible();
  await expect(fields.nth(0)).toHaveValue('');
  await page.locator('[data-src-text]').click();
  await expect(hint).toHaveCount(0);

  // Paste goes to the picked form only
  await page.evaluate(() => navigator.clipboard.writeText('نص ملصوق'));
  await fields.nth(2).click();
  await page.click('#paste-target-text-btn');
  await expect(fields.nth(2)).toHaveValue('نص ملصوق');
  await expect(fields.nth(1)).toHaveValue('%d file');
  await expect(fields.nth(0)).toHaveValue('');

  // Delete follows the same rule: nothing focused -> hint, a click on a form clears that form only
  await fields.nth(1).click();
  await page.click('#weblate-quick-delete-btn');
  await expect(fields.nth(1)).toHaveValue('');
  await expect(fields.nth(2)).toHaveValue('نص ملصوق');
  await page.locator('[data-src-text]').click();
  await page.click('#weblate-quick-delete-btn');
  await expect(hint).toBeVisible();
  expect(await highlighted(2)).toBeGreaterThan(0);
  // The resize capsule is hidden during pick mode
  await expect(page.locator('[data-resize-handle]:visible')).toHaveCount(0);
  // Delete pick mode is red
  await expect(hint).toHaveClass(/red/);
  expect(await fields.nth(2).locator('xpath=ancestor::div[contains(@class,"bg-red-500")]').count()).toBeGreaterThan(0);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/plural-pick-delete-red.png` });
  // A drag (scroll) must not cancel the mode
  const box = (await page.locator('[data-src-text]').boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 5, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(hint).toBeVisible();
  await fields.nth(2).click();
  await expect(fields.nth(2)).toHaveValue('');
  await expect(hint).toHaveCount(0);

  // "Delete all" under the delete hint clears every form at once
  await fields.nth(1).fill('واحد');
  await fields.nth(2).fill('اثنان');
  await page.locator('[data-src-text]').click();
  await page.click('#weblate-quick-delete-btn');
  await expect(page.getByTestId('plural-delete-all')).toBeVisible();
  await expect(page.getByTestId('plural-delete-all')).toHaveText(/حذف الكل|Delete all/);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/delete-all-plural.png` });
  await page.getByTestId('plural-delete-all').click();
  for (let i = 0; i < count; i++) await expect(fields.nth(i)).toHaveValue('');
  await expect(hint).toHaveCount(0);
});

test('an ICU message with an empty field is not saved until every field is filled', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="msgs">{count, plural, one {# message} other {# messages}}</string>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.locator('select').first().selectOption('hi');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  // Only `one` is filled: `other` stays empty and the save is refused, every time
  await page.getByTestId('icu-field-0:0').fill('# संदेश');
  const warning = page.getByText(/other/).filter({ hasText: /\{count\}/ });
  await page.click('#weblate-save-stay-btn');
  await expect(warning).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/empty-other-block.png` });
  await page.click('#weblate-save-stay-btn');
  await expect(warning).toBeVisible();

  // Filling `other` clears the message and the save goes through
  await page.getByTestId('icu-field-0:1').fill('# संदेश');
  await expect(warning).toHaveCount(0);
  await page.click('#weblate-save-stay-btn');
  await expect(warning).toHaveCount(0);
  await expect(page.getByText(/100%|\(1\/1\)/).first()).toBeVisible();
});

test('a <plurals> resource with any empty quantity is not saved', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <plurals name="files">\n        <item quantity="one">%d file</item>\n        <item quantity="other">%d files</item>\n    </plurals>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.locator('select').first().selectOption('hi');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  const fields = page.locator('textarea:visible');
  await fields.first().fill('%d फ़ाइल');
  const warning = page.getByText(/Some quantities are empty|بعض الصيغ فارغة/);
  await page.click('#weblate-save-stay-btn');
  await expect(warning).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/plural-empty-other.png` });
  await page.click('#weblate-save-stay-btn');
  await expect(warning).toBeVisible();

  await fields.nth(1).fill('%d फ़ाइलें');
  await expect(warning).toHaveCount(0);
  await page.click('#weblate-save-stay-btn');
  await expect(warning).toHaveCount(0);
  await expect(page.getByText(/100%|\(1\/1\)/).first()).toBeVisible();
});

test('a <string-array> with any empty item is not saved', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string-array name="choices">\n        <item>First</item>\n        <item>Second</item>\n    </string-array>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.locator('select').first().selectOption('hi');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  const fields = page.locator('textarea:visible');
  await fields.first().fill('पहला');
  const warning = page.getByText(/Some items are empty|بعض العناصر فارغة/);
  await page.click('#weblate-save-stay-btn');
  await expect(warning).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/array-empty-item.png` });
  await page.click('#weblate-save-stay-btn');
  await expect(warning).toBeVisible();

  await fields.nth(1).fill('दूसरा');
  await expect(warning).toHaveCount(0);
  await page.click('#weblate-save-stay-btn');
  await expect(warning).toHaveCount(0);
  await expect(page.getByText(/100%|\(1\/1\)/).first()).toBeVisible();
});

test('string-array: per-item source line, copy and clone, and delete picks one item', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string-array name="choices">\n        <item>First choice</item>\n        <item>Second choice</item>\n        <item>Third choice</item>\n    </string-array>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.locator('select').first().selectOption('hi');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();

  const fields = page.locator('textarea:visible');
  const hint = page.getByTestId('plural-pick-hint');
  // No combined source box; every item shows its own source line, also after typing
  await expect(page.locator('[data-src-text]')).toHaveCount(0);
  await expect(page.getByTestId('array-source-0')).toContainText('First choice');
  await expect(page.getByTestId('array-source-2')).toContainText('Third choice');

  // Per-item clone fills that item only; copy puts its source on the clipboard
  await page.getByTestId('array-clone-1').click();
  await expect(fields.nth(1)).toHaveValue('Second choice');
  await expect(fields.nth(0)).toHaveValue('');
  await expect(fields.nth(2)).toHaveValue('');
  await page.getByTestId('array-copy-2').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Third choice');
  await expect(page.getByTestId('array-source-1')).toContainText('Second choice');

  await fields.nth(0).fill('पहला');
  await fields.nth(2).fill('तीसरा');
  await page.locator('[data-src-text], [data-key-name]').first().click();

  // Delete with nothing focused: red hint and tint, capsules hidden, tap outside cancels
  await page.click('#weblate-quick-delete-btn');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveClass(/red/);
  await expect(page.locator('[data-resize-handle]:visible')).toHaveCount(0);
  expect(await fields.nth(0).locator('xpath=ancestor::div[contains(@class,"bg-red-500")]').count()).toBeGreaterThan(0);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/array-delete-pick.png` });
  await page.locator('[data-key-name]').click();
  await expect(hint).toHaveCount(0);
  for (const [i, v] of ['पहला', 'Second choice', 'तीसरा'].entries()) await expect(fields.nth(i)).toHaveValue(v);

  // Delete, then a click on item 2 clears that item only
  await page.click('#weblate-quick-delete-btn');
  await expect(hint).toBeVisible();
  await fields.nth(1).click();
  await expect(fields.nth(1)).toHaveValue('');
  await expect(fields.nth(0)).toHaveValue('पहला');
  await expect(fields.nth(2)).toHaveValue('तीसरा');
  await expect(hint).toHaveCount(0);

  // "Delete all" under the delete hint clears every item
  await page.locator('[data-key-name]').click();
  await page.click('#weblate-quick-delete-btn');
  await expect(page.getByTestId('plural-delete-all')).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/delete-all-array.png` });
  await page.getByTestId('plural-delete-all').click();
  for (let i = 0; i < 3; i++) await expect(fields.nth(i)).toHaveValue('');
  await expect(hint).toHaveCount(0);
  await fields.nth(0).fill('पहला');
  await fields.nth(2).fill('तीसरा');
  await page.locator('[data-key-name]').click();

  // With an item focused, delete clears it straight away
  await fields.nth(2).click();
  await page.click('#weblate-quick-delete-btn');
  await expect(fields.nth(2)).toHaveValue('');
  await expect(fields.nth(0)).toHaveValue('पहला');
});

test('plural source labels sit opposite the source text direction', async ({ page }) => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <plurals name="files">\n        <item quantity="one">%d ملف</item>\n        <item quantity="other">%d ملفات</item>\n    </plurals>\n</resources>`;
  await page.goto('/');
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.locator('select').first().selectOption('hi');
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  for (const q of ['one', 'other']) {
    expect(await page.getByTestId(`plural-source-label-${q}`).evaluate((e) => getComputedStyle(e).textAlign)).toBe('left');
    // RTL source: the label is beside the copy button on the same row, not under it
    const lb = (await page.getByTestId(`plural-source-label-${q}`).boundingBox())!;
    const cb = (await page.getByTestId(`plural-source-copy-${q}`).boundingBox())!;
    expect(Math.abs((lb.y + lb.height / 2) - (cb.y + cb.height / 2))).toBeLessThan(6);
    // Clone button sits at the same level as the copy button
    const cl2 = (await page.locator(`#weblate-clone-source-${q}-btn`).boundingBox())!;
    const cb2 = (await page.getByTestId(`plural-source-copy-${q}`).boundingBox())!;
    expect(Math.abs((cl2.y + cl2.height / 2) - (cb2.y + cb2.height / 2))).toBeLessThan(2.5);
    expect(lb.x).toBeGreaterThan(cb.x);
  }
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/plural-source-forms-rtl.png` });
});

test('Suggest fills every plural category of the target language in an ICU message', async ({ page }) => {
  await mockProviderApi(page);
  await openAppWithProvider(page);
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="notes">{count, plural, =0{No notifications} one{# notification} other{# notifications}}</string>\n</resources>`;
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  const fields = page.locator('[data-testid^="icu-field-"]');
  await expect(fields).toHaveCount(7); // =0, zero, one, two, few, many, other
  await page.click('#weblate-suggest-btn');
  await expect(fields.nth(0)).not.toHaveValue('');
  for (let i = 0; i < 7; i++) await expect(fields.nth(i)).not.toHaveValue('');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/suggest-all-plural-forms.png` });
});

const ICU_NOTES_XML = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="notes">{count, plural, =0{No notifications} one{# notification} other{# notifications}}</string>\n</resources>`;
async function importIcuNotes(page: import('@playwright/test').Page) {
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(ICU_NOTES_XML);
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
}

test('ICU fields get the delete hint and "delete all" like plural forms', async ({ page }) => {
  await mockProviderApi(page);
  await openAppWithProvider(page);
  await importIcuNotes(page);
  const fields = page.locator('[data-testid^="icu-field-"]');
  await expect(fields).toHaveCount(7);
  await page.click('#weblate-suggest-btn');
  for (let i = 0; i < 7; i++) await expect(fields.nth(i)).not.toHaveValue('');
  const hint = page.getByTestId('plural-pick-hint');
  // Nothing focused: the hint shows, a tap on a field clears that field only
  await page.locator('[data-src-text]').first().click();
  await page.click('#weblate-quick-delete-btn');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveClass(/red/);
  await expect(page.getByTestId('plural-delete-all')).toHaveText(/حذف الكل|Delete all/);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/icu-delete-hint.png` });
  await fields.nth(2).click();
  await expect(fields.nth(2)).toHaveValue('');
  await expect(fields.nth(1)).not.toHaveValue('');
  await expect(hint).toHaveCount(0);
  // "Delete all" clears every field
  await page.locator('[data-src-text]').first().click();
  await page.click('#weblate-quick-delete-btn');
  await page.getByTestId('plural-delete-all').click();
  for (let i = 0; i < 7; i++) await expect(fields.nth(i)).toHaveValue('');
  await expect(hint).toHaveCount(0);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/icu-delete-all-done.png` });
});

test('Suggest warns when the added plural forms could not be filled', async ({ page }) => {
  // Built-in engines: Google is blocked; MyMemory answers the first 3 requests (one per source clause), then hits its limit
  let calls = 0;
  await page.route('**/translate.googleapis.com/**', (route) => route.abort());
  await page.route('**/api.mymemory.translated.net/**', async (route) => {
    calls += 1;
    if (calls > 3) return route.fulfill({ status: 429, json: { responseStatus: 429, responseData: { translatedText: 'QUOTA' } } });
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    return route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: q.replace('notifications', 'إشعارات').replace('notification', 'إشعار') } } });
  });
  await page.goto('/');
  await expect(page.locator('#header-load-sample-btn')).toBeVisible();
  await importIcuNotes(page);
  await page.click('#weblate-suggest-btn');
  const warn = page.getByTestId('icu-unfilled-warning');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText(/zero|one|two|few|many|other/);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/suggest-unfilled-warning.png` });
});

test('Suggest shows the added plural forms for an indented multi-line ICU string', async ({ page }) => {
  await mockProviderApi(page);
  await openAppWithProvider(page);
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="notes">\n        {count, plural,\n            =0 {No notifications}\n            one {# notification}\n            other {# notifications}\n        }\n    </string>\n</resources>`;
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  const fields = page.locator('[data-testid^="icu-field-"]');
  await expect(fields).toHaveCount(7);
  await page.click('#weblate-suggest-btn');
  for (let i = 0; i < 7; i++) await expect(fields.nth(i)).not.toHaveValue('');
  await expect(page.getByTestId('icu-unfilled-warning')).toHaveCount(0);
  // Saving is not blocked by the line-break count: the added forms add no line breaks
  await page.getByRole('button', { name: /حفظ بدون متابعة|Save & Stay/ }).click();
  await expect(page.getByText(/عدد الأسطر الجديدة|line breaks/)).toHaveCount(0);
  await expect(page.locator('[data-testid^="icu-field-"]').first()).not.toHaveValue('');
});

test('Suggest on a nested multi-line ICU string keeps the line-break count so it can be saved', async ({ page }) => {
  await mockProviderApi(page);
  await openAppWithProvider(page);
  const inner = (w: string) => `{count, plural,\n                one {${w} sent one message}\n                other {${w} sent # messages}\n            }`;
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="act">\n        {gender, select,\n            male {${inner('He')}}\n            other {${inner('They')}}\n        }\n    </string>\n</resources>`;
  await page.click('#header-right-drawer-btn');
  await page.click('#drawer-import-btn');
  await page.fill('#import-project-name', 'Test App');
  await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
  await page.locator('textarea').last().fill(xml);
  await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
  const fields = page.locator('[data-testid^="icu-field-"]');
  await page.click('#weblate-suggest-btn');
  await expect(fields.first()).not.toHaveValue('');
  const n = await fields.count();
  for (let i = 0; i < n; i++) await expect(fields.nth(i)).not.toHaveValue('');
  await page.getByRole('button', { name: /حفظ بدون متابعة|Save & Stay/ }).click();
  await expect(page.getByText(/عدد الأسطر الجديدة|line breaks/)).toHaveCount(0);
});
