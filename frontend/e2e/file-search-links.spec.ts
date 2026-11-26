import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend } from './backend';

// The Ctrl+K palette's options as the links they are. The rest of the palette is in
// `file-search.spec.ts`.

function palette(page: Page): Locator {
    return page.getByRole('dialog').filter({ has: page.getByRole('listbox', { name: 'Files' }) });
}

function search(page: Page): Locator {
    return palette(page).getByRole('combobox', { name: 'Search' });
}

function titles(page: Page): Locator {
    return palette(page).getByRole('option').locator('.v-list-item-title');
}

function tab(page: Page, name: string): Locator {
    return palette(page).getByRole('tab', { name, exact: true });
}

// Opened, and done opening: Vuetify leaves an Escape pressed while its dialog scales in unanswered.
async function open(page: Page): Promise<void> {
    await page.keyboard.press('Control+k');
    await expect(search(page)).toBeFocused();
    const content = page.locator('.v-overlay__content').filter({ has: page.getByRole('listbox', { name: 'Files' }) });
    await expect.poll(() => content.evaluate((element) => element.getAnimations().length)).toBe(0);
}

const FILES = {
    'ideas.md': '# Ideas\n',
    'journal/monday.md': '# Monday\n',
};

const TIMES = {
    'ideas.md': '2026-10-01T09:00:00+00:00',
    'journal/monday.md': '2026-10-20T09:00:00+00:00',
};

const WEEK = {
    '.events/week.md': '---\nevents:\n    Monday:\n        start: 2026-10-05\n    Tuesday:\n        start: 2026-10-06\n---\n\n# Week\n',
};

// Each event of a note a row of its own, though all of them open the note: Vuetify tells apart the
// items of a list by where they link to, unless told otherwise, and says it has two of one.
test('lists each event of a note as an option of its own', async ({ context, page }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
        if (message.text().includes('Vuetify')) {
            warnings.push(message.text());
        }
    });
    await mockBackend(context, WEEK);
    await page.goto('/');
    await open(page);
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
    }
    await expect(tab(page, 'Events')).toHaveAttribute('aria-selected', 'true');
    await expect(titles(page)).toHaveText(['Tuesday', 'Monday', 'Show all 2 in Files']);
    await expect(palette(page).getByRole('option').filter({ hasText: 'Tuesday' })).toHaveAttribute('href', '/note/.events/week.md');
    await expect(palette(page).getByRole('option').filter({ hasText: 'Monday' })).toHaveAttribute('href', '/note/.events/week.md');
    // Once whatever the rows logged as they were drawn has reached the test.
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(warnings).toEqual([]);
});

// The clicks the palette sends an option's link itself, by the address of each.
async function recordClicks(page: Page): Promise<() => Promise<string[]>> {
    await page.evaluate(() => {
        const clicks: string[] = [];
        (window as unknown as { clicks: string[] }).clicks = clicks;
        window.addEventListener('click', (event) => {
            if (!event.isTrusted && event.target instanceof HTMLAnchorElement) {
                clicks.push(event.target.getAttribute('href') ?? '');
            }
        }, true);
    });
    return () => page.evaluate(() => (window as unknown as { clicks: string[] }).clicks);
}

// Once for each press, as Ctrl+K opens the palette once: a tab for each time the key repeats would
// be several of the one file.
test('opens one tab for Ctrl+Enter held down', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await open(page);
    await expect(titles(page)).toHaveText(['Monday', 'Ideas', 'Show all 2 in Files']);
    const clicks = await recordClicks(page);
    const opened = context.waitForEvent('page');
    await page.keyboard.down('Control');
    for (let i = 0; i < 3; i++) {
        await page.keyboard.down('Enter');
    }
    await page.keyboard.up('Enter');
    await page.keyboard.up('Control');
    await expect(await opened).toHaveURL('/note/journal/monday.md');
    expect(await clicks()).toEqual(['/note/journal/monday.md']);
});
