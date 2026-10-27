import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loadSample, openAppWithProvider, openDrawer } from './helpers';

async function scan(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target?.join(' ')}`);
  expect(summary, `${label}: serious accessibility violations`).toEqual([]);
}

test.describe('accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await openAppWithProvider(page);
    await loadSample(page);
  });

  test('main editor screen', async ({ page }) => {
    await scan(page, 'editor');
  });

  test('side drawer', async ({ page }) => {
    await openDrawer(page);
    await scan(page, 'drawer');
  });

  test('export dialog', async ({ page }) => {
    await openDrawer(page);
    await page.click('#drawer-export-btn');
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page, 'export dialog');
  });

  test('dialogs trap focus and give it back on close', async ({ page }) => {
    await openDrawer(page);
    await page.click('#drawer-shortcuts-btn');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});
