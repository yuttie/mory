import { expect, test } from '@playwright/test';
import { mockBackend } from './backend';

const PATH = 'research/programming-learning/codewalker.md';

const NOTES = {
    [PATH]: [
        '---',
        'tags: [\'home:Research\']',
        '---',
        '',
        '# Codewalker',
        '',
    ].join('\n'),
};

// A path param given as one string has its slashes encoded as %2F, and the route only joins the
// segments of an array with the slash a path is made of.
test('links a note listed by category with literal slashes', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/');

    const link = page.locator('.notes-section').getByRole('link', { name: 'Codewalker' });
    await expect(link).toHaveAttribute('href', `/note/${PATH}`);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/note/${PATH}$`));
});
