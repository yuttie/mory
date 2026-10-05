import { expect, test } from '@playwright/test';
import { mockBackend } from './backend';

// Typed key by key, as a person types: a shortcut listens for `keydown`, which `fill` never sends.
test('types a slash into the Files search rather than jumping to it', async ({ context, page }) => {
    await mockBackend(context, { 'projects/plan.md': '# Plan\n' });
    await page.goto('/files');
    const search = page.getByRole('textbox', { name: 'Search' });
    await search.click();
    await search.pressSequentially('projects/plan');
    await expect(search).toHaveValue('projects/plan');
});
