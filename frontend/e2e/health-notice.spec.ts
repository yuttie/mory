import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend } from './backend';

// Tags that are not a list, which the frontmatter schema refuses and no view the test opens shows.
const BROKEN = '---\ntags: 3\n---\n# Broken\n';

// The account menu's Health item, which says whether a check fails, with the menu opened.
async function healthItem(page: Page): Promise<Locator> {
    await page.locator('.account-item').click();
    return page.locator('.v-menu').getByRole('link', { name: /^Health/ });
}

test('points at the health page from the account menu when a check fails', async ({ context, page }) => {
    await mockBackend(context, { 'broken.md': BROKEN, 'fine.md': '# Fine\n' });
    await page.goto('/files');

    const item = await healthItem(page);
    await expect(item).toHaveAccessibleName('Health: 1 health error');
    // No count of warnings, as none fails.
    await expect(item.locator('.count')).toHaveText(['1']);
    await item.click();

    await expect(page).toHaveURL(/\/health$/);
    await expect(page.getByRole('link', { name: /broken\.md/ })).toBeVisible();
});

test('counts the failing checks of each severity at the end of the item, errors first', async ({ context, page }) => {
    // A plan not named for its month, which the check of the plans warns of.
    await mockBackend(context, { '.mory/plans/notes.yaml': '{}\n', 'broken.md': BROKEN });
    await page.goto('/files');

    const item = await healthItem(page);
    await expect(item).toHaveAccessibleName('Health: 1 health error, 1 warning');
    const counts = item.locator('.count');
    await expect(counts).toHaveText(['1', '1']);
    await expect(counts).toHaveClass([/\btext-error\b/, /\btext-warning\b/]);
});

test('says nothing of the checks while every check passes', async ({ context, page }) => {
    await mockBackend(context, { 'fine.md': '# Fine\n' });
    await page.goto('/health');

    // Nothing is listed until a check is recorded, and every label reads … while one reads again;
    // the notice is worked out from the same record.
    const labels = page.locator('.check .label');
    await expect(labels.first()).toHaveText('OK');
    await expect(labels.filter({ hasNotText: 'OK' })).toHaveCount(0);
    await expect(await healthItem(page)).toHaveAccessibleName('Health');
});

// A problem nobody means to fix, such as an image search cannot read, must not stay in view.
test('keeps a failing check out of the sidebar and the app bar', async ({ context, page }) => {
    await mockBackend(context, { 'broken.md': BROKEN });
    await page.goto('/files');
    await expect(await healthItem(page)).toHaveAccessibleName('Health: 1 health error');
    await page.keyboard.press('Escape');
    // By its title too: the app bar's icon said it in a tooltip alone, which no text query sees.
    const shown = page.getByText(/health error/)
        .or(page.getByTitle(/health error/))
        .or(page.locator('.counts'))
        .filter({ visible: true });
    await expect(shown).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.v-app-bar-nav-icon')).toBeVisible();
    await expect(shown).toHaveCount(0);
    await page.locator('.v-app-bar-nav-icon').click();
    await expect(page.locator('.v-navigation-drawer--active .account-item')).toBeVisible();
    await expect(shown).toHaveCount(0);
});

// One check of a commit is every page's: a second page shows the record the first made without
// reading what a check reads, and takes the check the first makes of a fix.
test('shares one check between pages, and clears the notice of one for a fix made in another', async ({ context, page }) => {
    const repository = await mockBackend(context, { 'broken.md': BROKEN, 'fine.md': '# Fine\n' });
    await page.goto('/note/broken.md');
    await expect(await healthItem(page)).toHaveAccessibleName('Health: 1 health error');
    await page.keyboard.press('Escape');

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
    await expect(await healthItem(other)).toHaveAccessibleName('Health: 1 health error');
    await other.keyboard.press('Escape');
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

    await expect(await healthItem(page)).toHaveAccessibleName('Health');
    await expect(await healthItem(other)).toHaveAccessibleName('Health');
});
