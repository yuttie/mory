import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { API_URL, TOKEN, mockBackend } from './backend';

// A request that fails says so, rather than leave the view looking as if it had worked.

// Shown, and as what went wrong: the response itself carries the request's headers, the session
// token among them.
async function reported(page: Page): Promise<void> {
    const snackbar = page.locator('.v-snackbar__content');
    await expect(snackbar).toBeVisible();
    await expect(snackbar).toContainText('status code 500');
    await expect(snackbar).not.toContainText(TOKEN);
}

test('says so when a note cannot be renamed', async ({ context, page }) => {
    await mockBackend(context, { 'notes/old.md': '# Old\n' });
    await page.route(`${API_URL}notes/**`, (route) => route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, json: {} })
        : route.fallback());
    await page.goto('/note/notes/old.md');
    await expect(page.getByRole('heading', { name: 'Old' })).toBeVisible();

    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('New path').fill('notes/new.md');
    await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();

    await reported(page);
    await expect(page).toHaveURL(/\/note\/notes\/old\.md$/);
});

// Saving first reads the note again, to see whether it changed elsewhere.
test('says so when a note cannot be checked before it is saved', async ({ context, page }) => {
    await mockBackend(context, { 'notes/note.md': '# Note\n' });
    let failing = false;
    await page.route(`${API_URL}notes/notes/note.md`, (route) => failing && route.request().method() === 'GET'
        ? route.fulfill({ status: 500, json: {} })
        : route.fallback());
    await page.goto('/note/notes/note.md');
    await expect(page.getByRole('heading', { name: 'Note' })).toBeVisible();

    await page.getByRole('button', { name: 'Editor and viewer' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.type('More text.');
    failing = true;
    await page.getByTitle('Save').click();

    await reported(page);
});

test('says so when a file cannot be deleted', async ({ context, page }) => {
    const repository = await mockBackend(context, { 'notes/note.md': '# Note\n' });
    await page.route(`${API_URL}notes/**`, (route) => route.request().method() === 'DELETE'
        ? route.fulfill({ status: 500, json: {} })
        : route.fallback());
    await page.goto('/files');

    await page.getByRole('row').filter({ hasText: 'Note' }).getByRole('checkbox').check();
    await page.locator('.file-table .v-toolbar button').click();

    await reported(page);
    expect(repository.deletes).toEqual([]);
});

test('says so when a note cannot be read', async ({ context, page }) => {
    await mockBackend(context, { 'notes/broken.md': '# Broken\n' });
    await page.route(`${API_URL}notes/notes/broken.md`, (route) => route.fulfill({ status: 500, json: {} }));
    await page.goto('/note/notes/broken.md');

    await reported(page);
});

for (const address of ['/files', '/']) {
    test(`says so when ${address} cannot list the notes`, async ({ context, page }) => {
        await mockBackend(context, {});
        await page.route(`${API_URL}v2/entries**`, (route) => route.fulfill({ status: 500, json: {} }));
        await page.goto(address);

        await reported(page);
    });
}

test('says what failed when a note cannot be saved', async ({ context, page }) => {
    await mockBackend(context, { 'notes/note.md': '# Note\n' });
    await page.route(`${API_URL}notes/**`, (route) => route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, json: {} })
        : route.fallback());
    await page.goto('/note/notes/note.md');
    await expect(page.getByRole('heading', { name: 'Note' })).toBeVisible();

    await page.getByRole('button', { name: 'Editor and viewer' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.type('More text.');
    await page.getByTitle('Save').click();

    await reported(page);
});

test('says what failed when the calendar cannot list the notes', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.route(`${API_URL}v2/entries**`, (route) => route.fulfill({ status: 500, json: {} }));
    await page.goto('/calendar');

    await reported(page);
});
