import { expect, test } from '@playwright/test';
import { API_URL, mockBackend } from './backend';

const NOTES = {
    'retried.md': '# Retried\n\nLoaded after the login.\n',
    'template.md': '# Template\n\nCopied after the login.\n',
};

// What failed for want of a token is retried once the user has logged in again, in the view that
// asked, rather than left for the user to reload.
test('retries a note that failed for want of a token once the user logs in', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    // Registered last, so it answers first: the session expires once, on the note's first request.
    let expired = true;
    await context.route(`${API_URL}notes/retried.md`, async (route) => {
        if (expired) {
            expired = false;
            await route.fulfill({ status: 401, json: {} });
            return;
        }
        await route.fallback();
    });

    await page.goto('/note/retried.md');
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Username' }).fill('test');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Login' }).click();

    // The rendered paragraph: the editor, hidden in this mode, holds the same text.
    await expect(page.getByRole('paragraph').filter({ hasText: 'Loaded after the login.' })).toBeVisible();
});

// Retried as a template, not as the note it names: read as a note, it would be taken for one already
// saved, so the new note would be saved without its creation time, and only once edited.
test('retries a template that failed for want of a token once the user logs in', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    let expired = true;
    await context.route(`${API_URL}notes/template.md`, async (route) => {
        if (expired) {
            expired = false;
            await route.fulfill({ status: 401, json: {} });
            return;
        }
        await route.fallback();
    });

    await page.goto('/note/new.md?mode=create&template=template.md');
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Username' }).fill('test');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page.getByRole('paragraph').filter({ hasText: 'Copied after the login.' })).toBeVisible();
    await page.getByTitle('Save').click();
    await expect.poll(() => repository.writes.map((write) => write.path)).toEqual(['new.md']);
    expect(repository.writes[0].content).toMatch(/^---\ncreated_at: /);
});
