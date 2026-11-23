import { expect, test } from '@playwright/test';
import { mockBackend } from './backend';

// Tags that are not a list, which the frontmatter schema refuses and no view the test opens shows.
const BROKEN = '---\ntags: 3\n---\n# Broken\n';

test('points at the health page when a check fails', async ({ context, page }) => {
    await mockBackend(context, { 'broken.md': BROKEN, 'fine.md': '# Fine\n' });
    await page.goto('/files');

    await page.getByRole('link', { name: '1 health error' }).click();

    await expect(page).toHaveURL(/\/health$/);
    await expect(page.getByRole('link', { name: /broken\.md/ })).toBeVisible();
});

test('shows no health notice while every check passes', async ({ context, page }) => {
    await mockBackend(context, { 'fine.md': '# Fine\n' });
    await page.goto('/health');

    // Nothing is listed until a check is recorded, and every label reads … while one reads again;
    // the notice is worked out from the same record.
    const labels = page.locator('.check .label');
    await expect(labels.first()).toHaveText('OK');
    await expect(labels.filter({ hasNotText: 'OK' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /health (error|warning)/ })).toHaveCount(0);
});

test('points at the drawer from the app bar on a phone', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBackend(context, { 'broken.md': BROKEN });
    await page.goto('/files');

    await page.getByRole('button', { name: '1 health error' }).click();
    await page.getByRole('link', { name: '1 health error' }).click();

    await expect(page).toHaveURL(/\/health$/);
});
