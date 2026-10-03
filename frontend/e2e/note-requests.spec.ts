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
    await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();

    await expect.poll(() => writes).toEqual([`${new URL(API_URL).pathname}notes/${ENCODED_ODD_PATH}`]);
});

test('checks the path typed in the rename dialog against the notes there are', async ({ context, page }) => {
    await mockBackend(context, {
        'notes/old.md': '# Old\n',
        [ODD_PATH]: '# Odd name\n',
    });
    const checks: string[] = [];
    page.on('request', (request) => {
        if (request.method() === 'HEAD') {
            checks.push(new URL(request.url()).pathname);
        }
    });
    await page.goto('/note/notes/old.md');

    await page.getByRole('button', { name: 'Rename' }).click();
    const dialog = page.getByRole('dialog');
    const field = page.getByLabel('New path');
    const rename = dialog.getByRole('button', { name: 'Rename' });

    await field.fill(ODD_PATH);
    await expect(dialog.getByText('Conflicting with existing path')).toBeVisible();
    await expect(rename).toBeDisabled();
    // Enter waits for the same answer the button does.
    await field.press('Enter');
    await expect(page).toHaveURL(/\/note\/notes\/old\.md$/);

    await field.fill('notes/free.md');
    await expect(dialog.getByText('Conflicting with existing path')).toHaveCount(0);
    await expect(rename).toBeEnabled();

    expect(checks).toContain(`${new URL(API_URL).pathname}v2/files/${ENCODED_ODD_PATH}`);
});
