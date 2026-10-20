import { expect, test, type Page } from '@playwright/test';
import { API_URL, mockBackend } from './backend';

// A subscribed calendar is someone else's: what its events say has to reach the page as what they
// say, and nothing in them may run as mory, where the session token is in reach.
// Without spaces, which no link destination may hold: a link of `javascript:window.__ran = true`
// was no link at all, and tested nothing.
const RUNS = 'window.__ran=true';
const NAME = `Sync <img src="y" onerror="${RUNS}">`;

function today(): { year: number; month: string; day: string; date: string } {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return { year, month, day, date: `${year}-${month}-${day}` };
}

// Every image in it has loaded or failed, which is when an `onerror` would have run.
async function settled(page: Page, selector: string): Promise<void> {
    await expect.poll(() => page.locator(selector).evaluateAll(
        (images) => images.every((image) => (image as HTMLImageElement).complete),
    )).toBe(true);
}

async function ran(page: Page): Promise<unknown> {
    return page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran);
}

test('an imported event shows what its feed says and runs none of it', async ({ context, page }) => {
    const repository = await mockBackend(context, {});
    const { year, month, day, date } = today();
    await context.route(`${API_URL}v2/imported-events**`, (route) => route.fulfill({ json: {
        calendars: [{ id: 'work', name: 'Work', error: null }],
        events: [{
            calendar: 'work',
            uid: 'sync@example.com',
            recurrence_id: date,
            name: NAME,
            start: date,
            note: `Agenda <b>first</b> <img src="x" onerror="${RUNS}"> [notes](javascript:${RUNS})`,
            url: `javascript:${RUNS}`,
        }],
        // What the feed says that mory has no key for, which conversion writes into the note's body.
        series: {
            'sync@example.com': {
                name: NAME,
                start: date,
                unmapped: { comment: `Minutes <img src="z" onerror="${RUNS}"> [minutes](javascript:${RUNS})` },
            },
        },
        truncated: false,
    } }));

    await page.goto(`/calendar/month/${year}/${month}/${day}`);
    await page.getByText(NAME).first().click();
    const popup = page.locator('.v-overlay__content').filter({ hasText: 'Agenda' });
    await expect(popup.locator('b', { hasText: 'first' })).toBeVisible();
    await settled(page, '.v-overlay__content img');
    // The link is shown, and not made one.
    await expect(popup.getByText(`javascript:${RUNS}`, { exact: true })).toBeVisible();
    await expect(popup.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(await ran(page)).toBeUndefined();

    // Converting keeps the feed's text and makes it the user's note, which renders its raw HTML.
    await popup.getByRole('button', { name: 'Convert to note' }).click();
    await expect.poll(() => repository.writes.length).toBe(1);
    const [{ path }] = repository.writes;
    // Firefox does not open the popup again on the converted event until the page is reloaded;
    // what is under test here is what the popup shows once it opens.
    await expect(popup).toBeHidden();
    await page.reload();
    await page.getByText(NAME).first().click();
    const converted = page.locator('.v-overlay__content').filter({ hasText: 'Agenda' });
    await expect(converted.getByRole('link', { name: path })).toBeVisible();
    await expect(converted.locator('b', { hasText: 'first' })).toBeVisible();
    await settled(page, '.v-overlay__content img');
    expect(await ran(page)).toBeUndefined();

    await page.goto(`/note/${path}`);
    await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
    await expect(page.getByText('[minutes](javascript:', { exact: false }).last()).toBeVisible();
    await settled(page, 'img');
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(await ran(page)).toBeUndefined();
});
