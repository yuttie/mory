import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockBackend } from './backend';

// A path with the characters that end a URL's path early when they are not encoded: a fragment, a
// query and a percent sign.
const ODD_PATH = 'notes/name#draft?100%.md';

// Where the page is, with its path decoded. The fragment and the query are compared as well, so a
// URL that moved part of the path into either of them fails too.
function pageLocation(page: Page): { path: string; search: string; hash: string } {
    const url = new URL(page.url());
    return {
        path: decodeURIComponent(url.pathname),
        search: url.search,
        hash: url.hash,
    };
}

test('links an event error to the note it is defined in, whatever its name', async ({ context, page }) => {
    await mockBackend(context, {
        [ODD_PATH]: [
            '---',
            'events:',
            '  Broken:',
            '    start: not a date',
            '---',
            '',
            '# Odd name',
            '',
        ].join('\n'),
    });
    await page.goto('/calendar');

    const link = page.getByRole('alert').getByRole('link', { name: 'Odd name' });
    await link.click();

    await expect.poll(() => pageLocation(page)).toEqual({ path: `/note/${ODD_PATH}`, search: '', hash: '' });
});

test('redirects to the path a note is renamed to, whatever its name', async ({ context, page }) => {
    await mockBackend(context, { 'notes/old.md': '# Old\n' });
    await page.goto('/note/notes/old.md');

    await page.getByRole('button', { name: 'Rename' }).click();
    const field = page.getByLabel('New path');
    await field.fill(ODD_PATH);
    await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();

    await expect.poll(() => pageLocation(page)).toEqual({ path: `/note/${ODD_PATH}`, search: '', hash: '' });
});
