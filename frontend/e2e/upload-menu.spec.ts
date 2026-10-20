import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { API_URL, mockBackend } from './backend';

const REASON = 'image.png already exists. Rename the file and upload it again.';

// moried answers each file by the form field it came in, so the answer is read off the request.
function fieldsOf(body: string): string[] {
    return [...body.matchAll(/name="([^"]+)"; filename=/g)].map((match) => match[1]);
}

// A second image.png is refused, as moried refuses any file whose name is taken; new.png is not.
async function uploadTakenAndFree(page: Page) {
    await page.route(`${API_URL}files`, (route) => {
        const [taken, free] = fieldsOf(route.request().postData() ?? '');
        return route.fulfill({
            json: [[taken, 'error', 'image.png already exists'], [free, 'success', null]],
        });
    });
    await page.locator('input[type="file"]').setInputFiles([
        { name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('another picture') },
        { name: 'new.png', mimeType: 'image/png', buffer: Buffer.from('new') },
    ]);
}

function uploaded(page: Page, name: string) {
    return page.getByRole('listitem').filter({ hasText: name });
}

test('says why an upload was refused', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/');
    await uploadTakenAndFree(page);

    await page.getByRole('listitem').filter({ hasText: /^Upload file$/ }).click();

    await expect(uploaded(page, 'image.png')).toContainText(REASON);
    await expect(uploaded(page, 'new.png')).toBeVisible();
    await expect(uploaded(page, 'new.png')).not.toContainText('Rename');
});

test('keeps the reason for a refused upload on a phone screen', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBackend(context, {});
    await page.goto('/');
    await uploadTakenAndFree(page);

    await page.locator('.v-app-bar-nav-icon').click();
    await page.getByRole('listitem').filter({ hasText: /^Upload file$/ }).click();

    const reason = page.getByText(REASON);
    await expect(reason).toBeVisible();
    // Measured once the menu has finished growing into place.
    const menu = page.locator('.v-menu .v-overlay__content');
    await expect.poll(() => menu.evaluate((element) => element.getAnimations().length)).toBe(0);
    const box = await reason.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    // Nothing of it is cut off: a list item shows one line of its subtitle unless told otherwise.
    // Firefox counts a descender below the last line as a pixel more, so lines are counted.
    const subtitle = uploaded(page, 'image.png').locator('.v-list-item-subtitle');
    const hidden = await subtitle.evaluate((element) => (element.scrollHeight - element.clientHeight)
        / parseFloat(getComputedStyle(element).lineHeight));
    expect(hidden).toBeLessThan(1);
});

// A refused file's name is that of another file already there, which a note linking it would show.
test('copies the name only of a file that was uploaded', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.addInitScript(() => {
        const copied: string[] = [];
        Object.assign(window, { copied });
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: async (text: string) => {
                    copied.push(text);
                },
            },
        });
    });
    await page.goto('/');
    await uploadTakenAndFree(page);
    const openMenu = () => page.getByRole('listitem').filter({ hasText: /^Upload file$/ }).click();

    await openMenu();
    await expect(uploaded(page, 'image.png')).toContainText(REASON);
    await uploaded(page, 'image.png').click();
    if (!await uploaded(page, 'new.png').isVisible()) {
        await openMenu();
    }
    await uploaded(page, 'new.png').click();

    await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string[] }).copied))
        .toEqual(['new.png']);
});

// "Request failed with status code 413" reads as a failure of the app, not of the file.
test('says an upload was too large', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/');
    const input = page.locator('input[type="file"]');
    const openMenu = () => page.getByRole('listitem').filter({ hasText: /^Upload file$/ }).click();

    // As moried says it.
    await page.route(`${API_URL}files`, (route) => route.fulfill({
        status: 413,
        contentType: 'text/plain; charset=utf-8',
        body: 'The upload is larger than the 16 MiB moried takes at once',
    }));
    await input.setInputFiles([{ name: 'video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('large') }]);
    await openMenu();
    await expect(uploaded(page, 'video.mp4')).toContainText(
        'The upload is larger than the 16 MiB moried takes at once. Upload fewer files at once, or smaller ones.');

    // As a proxy in front of moried answers it, with a page of its own.
    await page.unroute(`${API_URL}files`);
    await page.route(`${API_URL}files`, (route) => route.fulfill({
        status: 413,
        contentType: 'text/html',
        body: '<html><body><h1>413 Request Entity Too Large</h1></body></html>',
    }));
    await page.keyboard.press('Escape');
    await input.setInputFiles([{ name: 'other.mp4', mimeType: 'video/mp4', buffer: Buffer.from('large') }]);
    await openMenu();
    await expect(uploaded(page, 'other.mp4')).toContainText('The upload is too large. Upload fewer files');
    await expect(uploaded(page, 'other.mp4')).not.toContainText('<html>');
});
