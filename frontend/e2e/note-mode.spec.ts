import { expect, test } from '@playwright/test';
import { API_URL, mockBackend } from './backend';

test('keeps the mode picked while the note loads', async ({ context, page }) => {
    await mockBackend(context, { 'notes/slow.md': '# Slow\n' });
    let release = (): void => {};
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    let reads = 0;
    await page.route(`${API_URL}notes/notes/slow.md`, async (route) => {
        reads += 1;
        await released;
        await route.fallback();
    });
    await page.goto('/note/notes/slow.md');

    await expect.poll(() => reads).toBe(1);
    await page.getByRole('button', { name: 'Editor and viewer' }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    release();

    await expect(page.getByRole('heading', { name: 'Slow' })).toBeVisible();
    // The load is over once the spinner goes, so the editor is looked for after it.
    await expect(page.getByRole('progressbar')).toBeHidden();
    await expect(page.locator('.cm-content')).toBeVisible();
});
