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
  const download = page.locator('button:has-text("strings.xml")').last();
  await expect(page.locator('#export-allow-broken')).toBeVisible();
  await expect(download).toBeDisabled();
  await page.locator('#export-allow-broken').check();
  await expect(download).toBeEnabled();
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
  await expect(page.getByText(/1 جديد · 1 متغيّر · 15 محذوف · 1 دون تغيير/)).toBeVisible();
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
  await expect(counter).toHaveText('1 / 17');
  await page.locator('textarea').first().fill('نص تجريبي');
  await page.getByText('حفظ ومتابعة').click();
  await expect(counter).toHaveText('2 / 17');
  await page.locator('#weblate-skip-btn').click();
  await expect(counter).toHaveText('3 / 17');
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
  for (let i = 0; i < 20 && (await counter.textContent()) !== '15 / 17'; i++) await page.locator('#weblate-skip-btn').click();
  await expect(counter).toHaveText('15 / 17');

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

test('quick filters drive the editor and dim filters that have no strings', async ({ page }) => {
  await mockProviderApi(page);
  await openAppWithProvider(page);
  await loadSample(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('[data-quick-filters-btn]:visible').click();

  // The sample has no AI-translated strings, so that filter is dimmed and can't be switched on
  const ai = page.locator('[data-filter="ai"]:visible');
  await expect(ai).toBeDisabled();
  await expect(page.locator('[data-filter="review"]')).toHaveCount(0); // nothing to review: the filter is hidden
  await expect(page.locator('[data-filter="untranslated"]:visible')).toBeEnabled();

  const counter = page.locator('text=/^\\d+ \\/ \\d+$/').first();
  await expect(counter).toHaveText('1 / 17');
  await page.locator('[data-filter="translated"]:visible').click();
  const total = Number((await counter.innerText()).split('/')[1]);
  expect(total).toBeLessThan(17);
  await page.locator('[data-filter="translated"]:visible').click();
  await expect(counter).toHaveText(/\/ 17$/);
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
  const count = async () => Number(((await dialog.locator('h2').innerText()).match(/\((\d+) نص/) || [])[1]);
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
