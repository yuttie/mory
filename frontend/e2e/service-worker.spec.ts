import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { API_URL, TOKEN, mockBackend } from './backend';
import { stopServiceWorkers } from './worker';

// A 1×1 PNG: enough for the browser to decode, and to give the image a size once it has.
const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

const NOTES = {
    'first.md': '# First\n\n<img src="first.png">\n',
    'second.md': '# Second\n\n<img src="second.png">\n',
};

// A rendered image, found by the file it shows. The viewer rewrites a relative source into the
// API's files URL.
function image(page: Page, file: string): Locator {
    return page.locator(`img[src="${API_URL}files/${file}"]`);
}

// The files API, which wants the token that an <img> cannot send; the worker adds it. Registered
// after `mockBackend`, so it answers before the catch-all.
async function mockFiles(context: BrowserContext): Promise<void> {
    await context.route(`${API_URL}files/**`, async (route) => {
        if (route.request().headers()['authorization'] !== `Bearer ${TOKEN}`) {
            await route.fulfill({ status: 401 });
            return;
        }
        await route.fulfill({ body: PIXEL, contentType: 'image/png' });
    });
}

// The browser stops a service worker that has been idle for 30 seconds and starts a new one for the
// next request, while the page that configured the old one stays open.
test('shows an image first requested after the browser restarted the service worker', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Stopping a service worker takes the Chrome DevTools Protocol.');
    await mockBackend(context, NOTES);
    await mockFiles(context);

    await page.goto('/note/first.md');
    await expect(image(page, 'first.png')).toHaveJSProperty('naturalWidth', 1);
    // Lost if the page loads again, which would configure the new worker and hide what this checks.
    await page.evaluate(() => {
        (window as unknown as { loaded: boolean }).loaded = true;
    });

    await stopServiceWorkers(context, page);

    // By the note tree, whose rows are the app's own links. A link inside a note is a plain anchor,
    // and would load the page again.
    await page.locator('.note-tree').getByRole('treeitem', { name: 'Second' }).click();
    await expect(image(page, 'second.png')).toHaveJSProperty('naturalWidth', 1);
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
});

// Shift+Reload loads the page past the worker and so leaves it uncontrolled: until a worker takes
// it over, what it loads from the files API goes out without the token.
test('shows an image after a reload past the service worker', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Reloading past the service worker takes the Chrome DevTools Protocol.');
    await mockBackend(context, NOTES);
    await mockFiles(context);
    await page.goto('/note/first.md');
    await expect(image(page, 'first.png')).toHaveJSProperty('naturalWidth', 1);

    // What Shift+Reload does; Playwright's own reload goes through the worker.
    const cdp = await context.newCDPSession(page);
    const reloaded = page.waitForEvent('load');
    await cdp.send('Page.reload', { ignoreCache: true });
    await reloaded;
    await expect(image(page, 'first.png')).toHaveJSProperty('naturalWidth', 1);
});
