import { expect, test } from '@playwright/test';
import { API_URL, mockBackend } from './backend';

// A path with the characters that end a URL's path early when they are not encoded: a fragment, a
// query and a percent sign.
const ODD_PATH = 'notes/name#draft?100%.md';
const ENCODED_ODD_PATH = 'notes/name%23draft%3F100%25.md';

// A request for the odd path left raw reaches the backend as this one, for the browser drops the
// fragment.
const TRUNCATED_PATH = 'notes/name';

test('reads the note a name with a fragment and a query names', async ({ context, page }) => {
    await mockBackend(context, {
        [ODD_PATH]: '# Odd name\n',
        [TRUNCATED_PATH]: '# Wrong note\n',
    });
    await page.goto(`/note/${ENCODED_ODD_PATH}`);

    await expect(page.getByRole('heading', { name: 'Odd name' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Wrong note' })).toHaveCount(0);
});

test('renames a note by the path it is renamed to', async ({ context, page }) => {
    await mockBackend(context, { 'notes/old.md': '# Old\n' });
    const writes: string[] = [];
    page.on('request', (request) => {
        if (request.method() === 'PUT') {
            writes.push(new URL(request.url()).pathname);
        }
    });
    await page.goto('/note/notes/old.md');

    await page.getByRole('button', { name: 'Rename' }).click();
    const field = page.getByLabel('New path');
    await field.fill(ODD_PATH);
    await field.press('Enter');

    await expect.poll(() => writes).toEqual([`${new URL(API_URL).pathname}notes/${ENCODED_ODD_PATH}`]);
});
