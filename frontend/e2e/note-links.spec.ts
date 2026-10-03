import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockBackend } from './backend';

// A path with the characters that end a URL's path early when they are not encoded: a fragment, a
// query and a percent sign.
const ODD_PATH = 'notes/name#draft?100%.md';

// Where the page is, with its path decoded. A URL built by hand ends its path at the first `#` or
// `?`, so what lands in the fragment and the query is part of what the tests compare.
function openNote(page: Page): { path: string; search: string; hash: string } {
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

    await expect.poll(() => openNote(page)).toEqual({ path: `/note/${ODD_PATH}`, search: '', hash: '' });
});

test('renames a note to a path with a fragment and a query, and shows it there', async ({ context, page }) => {
    await mockBackend(context, { 'notes/old.md': '# Old\n' });
    await page.goto('/note/notes/old.md');

    await page.getByRole('button', { name: 'Rename' }).click();
    const field = page.getByLabel('New path');
    await field.fill(ODD_PATH);
    await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();

    await expect.poll(() => openNote(page)).toEqual({ path: `/note/${ODD_PATH}`, search: '', hash: '' });
});
