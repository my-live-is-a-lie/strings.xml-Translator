import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loadSample, openAppWithProvider } from './helpers';

test('external AI dialog matches the mobile Arabic layout', async ({ page }, testInfo) => {
  const screenshotPath = (name: string) => process.env.DIALOG_SCREENSHOT_DIR
    ? join(process.env.DIALOG_SCREENSHOT_DIR, name)
    : testInfo.outputPath(name);
  await openAppWithProvider(page);
  await loadSample(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: /قائمة النصوص/ }).click();
  await page.getByText(/تحديد غير المترجم/).first().click();
  await page.click('#stringlist-bulk-translate-btn');
  await page.locator('input[data-provider-id="__external_ai__"]').check();
  await page.click('#bulk-provider-start');

  const dialog = page.getByRole('dialog', { name: /الترجمة عبر تطبيق ذكاء اصطناعي/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2 > span').first()).toHaveText('الترجمة عبر تطبيق ذكاء اصطناعي');
  await expect(dialog.locator('h2 > span').last()).toContainText('للعربية');
  await expect(dialog.locator('#ext-step1')).toHaveText('١ جهّز الطلب وأرسله');
  await expect(dialog.locator('#ext-step2')).toHaveText('٢ الصق الرد أو ارفع ملفه');
  await expect(dialog.locator('[data-ext="part-count"]')).toHaveText(/\d+ نص/);
  await expect(dialog.locator('#ext-reply')).toHaveAttribute('dir', 'rtl');
  await expect(dialog.locator('#ext-reply')).toHaveCSS('text-align', 'right');
  const titleLines = await dialog.locator('h2 > span').first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  });
  expect(titleLines).toBe(1);
  const cancel = await dialog.getByRole('button', { name: 'إلغاء', exact: true }).boundingBox();
  const apply = await dialog.locator('#ext-apply').boundingBox();
  const bounds = await dialog.boundingBox();
  expect(cancel!.x).toBeGreaterThan(apply!.x);
  expect(bounds!.x + bounds!.width - cancel!.x - cancel!.width).toBeLessThan(25);
  await page.screenshot({ path: screenshotPath('external-ai-dialog-verification.png') });

  await dialog.locator('#ext-reply').fill('نص عربي للتأكد من اتجاه الكتابة');
  await expect(dialog.locator('#ext-reply')).toHaveCSS('direction', 'rtl');
  await page.screenshot({ path: screenshotPath('external-ai-dialog-rtl-input.png') });
});
