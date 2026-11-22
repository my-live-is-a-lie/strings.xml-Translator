import { expect, test } from '@playwright/test';

for (const kind of ['plural', 'array'] as const) {
  test(`shortcut bar follows ${kind} focus without stealing it`, async ({ page }) => {
    const xml = '<resources><plurals name="messages"><item quantity="one">One message</item><item quantity="other">Messages</item></plurals><string-array name="choices"><item>First</item><item>Second</item></string-array></resources>';
    await page.goto('/');
    await page.click('#header-right-drawer-btn');
    await page.click('#drawer-import-btn');
    await page.getByRole('button', { name: /لصق نص XML|Paste XML/ }).click();
    await page.locator('textarea').last().fill(xml);
    await page.getByRole('button', { name: /بدء الترجمة|Start Translating/ }).click();
    await page.locator(`#string-item-${kind === 'plural' ? 'messages' : 'choices'}`).click({ position: { x: 60, y: 12 } });

    const fields = page.locator('[data-editor-scroll] textarea');
    await expect(fields).toHaveCount(kind === 'plural' ? 6 : 2);
    const bar = page.locator('.kb-tools');
    const firstGroup = fields.first().locator('xpath=../..');
    const secondGroup = fields.nth(1).locator('xpath=../..');
    await expect(firstGroup.locator('.kb-tools')).toHaveCount(1);
    await fields.nth(1).fill('test');
    await expect(secondGroup.locator('.kb-tools')).toHaveCount(1);
    await expect(bar).toHaveCount(1);
    const before = await fields.nth(1).inputValue();
    await bar.getByRole('button', { name: '-', exact: true }).click();
    await expect(fields.nth(1)).toBeFocused();
    await expect(fields.nth(1)).toHaveValue(before + '-');
    await expect(secondGroup.locator('.kb-tools')).toHaveCount(1);
    if (!process.env.CI) await page.screenshot({ path: `/downloads/shortcut-${kind}-focused.png`, fullPage: true });
    await fields.nth(1).evaluate((el) => el.blur());
    await expect(firstGroup.locator('.kb-tools')).toHaveCount(1);
    await fields.nth(1).focus();
    await expect(secondGroup.locator('.kb-tools')).toHaveCount(1);
    await page.locator(`#string-item-${kind === 'plural' ? 'choices' : 'messages'}`).click({ position: { x: 60, y: 12 } });
    await expect(fields.first().locator('xpath=../..').locator('.kb-tools')).toHaveCount(1);
  });
}
