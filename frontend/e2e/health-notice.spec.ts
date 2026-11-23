import { expect, test } from '@playwright/test';
import { mockBackend } from './backend';

// Tags that are not a list, which the frontmatter schema refuses and no view the test opens shows.
const BROKEN = '---\ntags: 3\n---\n# Broken\n';

test('points at the health page when a check fails', async ({ context, page }) => {
    await mockBackend(context, { 'broken.md': BROKEN, 'fine.md': '# Fine\n' });
    await page.goto('/files');

    await page.getByRole('link', { name: '1 health error' }).click();

    await expect(page).toHaveURL(/\/health$/);
    await expect(page.getByRole('link', { name: /broken\.md/ })).toBeVisible();
});

test('shows no health notice while every check passes', async ({ context, page }) => {
    await mockBackend(context, { 'fine.md': '# Fine\n' });
    await page.goto('/health');

    // Nothing is listed until a check is recorded, and every label reads … while one reads again;
    // the notice is worked out from the same record.
    const labels = page.locator('.check .label');
    await expect(labels.first()).toHaveText('OK');
    await expect(labels.filter({ hasNotText: 'OK' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /health (error|warning)/ })).toHaveCount(0);
});

test('points at the drawer from the app bar on a phone', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBackend(context, { 'broken.md': BROKEN });
    await page.goto('/files');

    await page.getByRole('button', { name: '1 health error' }).click();
    await page.getByRole('link', { name: '1 health error' }).click();

    await expect(page).toHaveURL(/\/health$/);
});

// One check of a commit is every page's: a second page shows the record the first made without
// reading what a check reads, and takes the check the first makes of a fix.
test('shares one check between pages, and clears the notice of one for a fix made in another', async ({ context, page }) => {
    const repository = await mockBackend(context, { 'broken.md': BROKEN, 'fine.md': '# Fine\n' });
    await page.goto('/note/broken.md');
    await expect(page.getByRole('link', { name: '1 health error' })).toBeVisible();

    // Asked by either page, or by the service worker for one: the first has nothing to ask.
    const checked: string[] = [];
    context.on('request', (request) => {
        const { pathname } = new URL(request.url());
        if (pathname.endsWith('/v2/imported-events') || pathname.endsWith('/.mory/calendars.yaml')) {
            checked.push(pathname);
        }
    });
    const other = await context.newPage();
    await other.goto('/files');
    await expect(other.getByRole('link', { name: '1 health error' })).toBeVisible();
    // Past the listing the page asks for as it loads, which tells it the record is current.
    await other.waitForLoadState('networkidle');
    expect(checked).toEqual([]);

    await page.bringToFront();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await page.keyboard.press('e');
    await expect(page.locator('.cm-content')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('---\ntags: [fixed]\n---\n# Broken\n');
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => repository.writes.map(({ path }) => path)).toEqual(['broken.md']);
    // A view that lists the files, which learns of the save's commit.
    await page.getByRole('link', { name: 'Files' }).click();

    await expect(page.getByRole('link', { name: '1 health error' })).toHaveCount(0);
    await expect(other.getByRole('link', { name: '1 health error' })).toHaveCount(0);
});
