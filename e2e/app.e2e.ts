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
  for (let i = 0; i < 14; i++) await page.locator('#weblate-skip-btn').click();
  await expect(counter).toHaveText('15 / 17');
  await page.setViewportSize({ width: 390, height: 520 });

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

  await page.locator('#string-item-action_save').click();
  await expect(page.locator('[data-source-diff]')).toBeVisible();
  await expect(page.locator('[data-source-diff] mark')).toContainText('all');
  await page.getByText('حفظ ومتابعة').click();
  await page.locator('#string-item-action_save').click();
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
