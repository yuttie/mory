import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { API_URL, mockBackend, uuid } from './backend';

const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

const REPORT = uuid(1);
const REVIEW = uuid(2);

// Files of each kind, and two that are of none. No image: Firefox does not route a service worker's
// own requests, which is how the grid fetches one.
const FILES = {
    'ideas.md': '# Ideas\n',
    'ideas/draft.md': '---\nevents:\n    Submission:\n        start: 2026-11-02\n    Review:\n        instances: [{start: 2026-11-09}, {start: 2026-11-16}]\n---\n\n# Draft\n',
    'lecture.template': '# XXX lecture YY\n',
    [`.tasks/${REPORT}.md`]: '---\ntask:\n    status: {kind: todo}\n    deadline: 2026-11-30\n---\n\n# Write the report\n',
    [`.tasks/${REVIEW}.md`]: '---\ntask:\n    status: {kind: in_progress}\n---\n\n# Review the draft\n',
    '.tasks/notes.md': '# Loose notes\n',
    '.events/meeting.md': '---\nevents:\n    Meeting:\n        start: 2026-04-06 10:00\n        end: +1h\n        repeat: {freq: weekly, byday: [mon]}\n---\n\n# Meeting\n',
    '.events/holiday.md': '---\nevents:\n    Holiday:\n        start: 2026-09-22\n---\n\n# Holiday\n',
    '.mory/custom-note.css': '',
    '.mory/task-assessment.md': '# Assess the task\n',
    '.mory/plans/2026-10.yaml': '{}\n',
    '.redirects.gollum': '',
    'clips/demo.mp4': '',
    'paper.pdf': '',
};

function rows(page: Page) {
    return page.locator('.file-table tbody tr');
}

function tab(page: Page, name: string) {
    return page.getByRole('tab', { name, exact: true });
}

test('lists each kind of file on its own tab', async ({ context, page }) => {
    await mockBackend(context, FILES);
    await page.goto('/files');
    await expect(page.getByRole('tab')).toHaveText(
        ['All', 'Notes', 'Tasks', 'Events', 'Media', 'Templates', 'System', 'Uncategorized'],
    );
    await expect(tab(page, 'All')).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page)).toHaveCount(14);
    // A template by its path, as its heading is placeholders.
    await expect(rows(page).getByRole('link', { name: 'lecture.template', exact: true })).toBeVisible();

    // A template is what a note is started from, so it is not one of them. A note that declares
    // events still is.
    await tab(page, 'Notes').click();
    await expect(page).toHaveURL(/\/files\/notes$/);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: 'Draft' })).toContainText('ideas');

    await tab(page, 'Tasks').click();
    await expect(page).toHaveURL(/\/files\/tasks$/);
    await expect(rows(page)).toHaveCount(2);
    const report = rows(page).filter({ hasText: 'Write the report' });
    await expect(report).toContainText('To do');
    await expect(report).toContainText('2026-11-30');
    // Into the task's editor, rather than its note.
    await expect(report.getByRole('link', { name: 'Write the report' }))
        .toHaveAttribute('href', `/tasks-next/${REPORT}/descendants/schedule?task=${REPORT}`);

    await tab(page, 'Media').click();
    await expect(page).toHaveURL(/\/files\/media$/);
    const tiles = page.locator('.media-grid .tile');
    await expect(tiles).toHaveCount(2);

    await page.getByRole('button', { name: 'Show as a list' }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.reload();
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Show as thumbnails' }).click();
    await expect(tiles).toHaveCount(2);
});

test('gives templates, events, system files and the rest tabs of their own', async ({ context, page }) => {
    // A Wednesday, in every zone the suite runs in.
    await page.clock.setFixedTime(new Date('2026-10-21T03:00:00Z'));
    await mockBackend(context, FILES);
    await page.goto('/files/templates');
    await expect(rows(page)).toHaveCount(1);
    // By the name the Add menu offers it as, rather than its heading of placeholders.
    await expect(rows(page).getByRole('link', { name: 'lecture', exact: true }))
        .toHaveAttribute('href', '/note/lecture.template');
    await expect(rows(page)).not.toContainText('XXX lecture YY');
    await expect(rows(page).getByRole('link', { name: 'New note' }))
        .toHaveAttribute('href', '/create?from=lecture.template');

    // Each event once, wherever it is declared and however often it happens, the last to start
    // first. None is a file to select or delete.
    await tab(page, 'Events').click();
    await expect(page).toHaveURL(/\/files\/events$/);
    const titles = () => rows(page).locator('.path a').allTextContents();
    await expect.poll(titles).toEqual(['Review', 'Submission', 'Holiday', 'Meeting']);
    await expect(page.locator('.file-table').getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete the selected files' })).toHaveCount(0);
    // Not expanded: a rule is said in words, and the dates an event lists are counted.
    const meeting = rows(page).filter({ hasText: 'Meeting' });
    await expect(meeting).toContainText('2026-04-06 10:00');
    await expect(meeting).toContainText('Weekly on Mon');
    const review = rows(page).filter({ hasText: 'Review' });
    await expect(review).toContainText('2026-11-09');
    await expect(review).toContainText('On 2 dates');
    // The note each is in, beside it, and no tags, which are the note's rather than the event's.
    await expect(review.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/note/ideas/draft.md');
    await expect(review.locator('.note').getByRole('link', { name: 'Draft' })).toHaveAttribute('href', '/note/ideas/draft.md');
    await expect(meeting.locator('.note')).toHaveText('Meeting');
    await expect(page.getByRole('columnheader', { name: 'Note' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Tags' })).toHaveCount(0);
    const starts = page.getByRole('columnheader', { name: 'Starts' });
    await starts.click();
    await expect(starts).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(titles).toEqual(['Meeting', 'Holiday', 'Submission', 'Review']);

    await tab(page, 'System').click();
    await expect(page).toHaveURL(/\/files\/system$/);
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).filter({ hasText: '.mory/plans/2026-10.yaml' })).toContainText('Day plans for October 2026');
    await expect(rows(page).filter({ hasText: '.mory/custom-note.css' })).toContainText('Styles for the notes');
    // By the path the application reads it by, rather than by its heading.
    await expect(rows(page).getByRole('link', { name: '.mory/task-assessment.md', exact: true })).toBeVisible();
    await expect(page.locator('.file-table tbody')).not.toContainText('Assess the task');
    await expect(page.getByRole('columnheader', { name: 'Path', exact: true })).toBeVisible();

    // A file under .tasks/ not named as a task is in no tree, and a hidden file in no directory of
    // the application's.
    await tab(page, 'Uncategorized').click();
    await expect(page).toHaveURL(/\/files\/others$/);
    await expect(rows(page)).toHaveCount(2);
    // By where each is, which says why no other tab takes it, rather than by a title.
    await expect(rows(page).getByRole('link', { name: '.tasks/notes.md', exact: true })).toBeVisible();
    await expect(page.locator('.file-table tbody')).not.toContainText('Loose notes');
    await expect(rows(page).filter({ hasText: '.redirects.gollum' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Path', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Tags' })).toHaveCount(0);
});

test('shows when each event starts on a phone', async ({ context, page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await mockBackend(context, FILES);
    await page.goto('/files/events');
    // The column the tab sorts by, without a sideways scroll to it.
    await expect(page.getByRole('columnheader', { name: 'Starts' })).toBeInViewport({ ratio: 1 });
    await expect(rows(page).filter({ hasText: 'Meeting' }).getByText('2026-04-06 10:00')).toBeInViewport({ ratio: 1 });
});

test('finds an event by its name, or by the note it is in', async ({ context, page }) => {
    await mockBackend(context, FILES);
    await page.goto('/files/events?q=review');
    const titles = () => rows(page).locator('.path a').allTextContents();
    await expect.poll(titles).toEqual(['Review']);
    await page.getByRole('textbox', { name: 'Search' }).fill('draft');
    await expect.poll(titles).toEqual(['Review', 'Submission']);
});

test('keeps the search across tabs, but not the selection', async ({ context, page }) => {
    await mockBackend(context, FILES);
    await page.goto('/files?q=draft');
    await expect(rows(page)).toHaveCount(2);
    await rows(page).filter({ hasText: 'Review the draft' }).getByRole('checkbox').check();
    // A disabled v-icon-btn says so only by its class.
    const remove = page.getByRole('button', { name: 'Delete the selected files' });
    await expect(remove).not.toHaveClass(/v-icon-btn--disabled/);

    await tab(page, 'Notes').click();
    await expect(page).toHaveURL(/\/files\/notes\?q=draft$/);
    await expect(page.getByRole('textbox', { name: 'Search' })).toHaveValue('draft');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Draft');
    // Selected on the last tab and out of sight on this one, so not to be deleted from here.
    await expect(remove).toHaveClass(/v-icon-btn--disabled/);
});

function row(page: Page, title: string) {
    return rows(page).filter({ has: page.getByRole('link', { name: title, exact: true }) });
}

test('lets go of a file once it is deleted', async ({ context, page }) => {
    const repository = await mockBackend(context, FILES);
    await page.goto('/files');
    await expect(rows(page)).toHaveCount(14);
    await row(page, 'Ideas').getByRole('checkbox').check();
    const remove = page.getByRole('button', { name: 'Delete the selected files' });
    await remove.click();
    await expect(rows(page)).toHaveCount(13);
    expect(repository.deletes).toEqual(['ideas.md']);
    // Nothing left to delete again, which would only be refused.
    await expect(remove).toHaveClass(/v-icon-btn--disabled/);
});

test('lets go of the media selected as thumbnails once they are listed', async ({ context, page }) => {
    // More than a page of the list, and less than one of thumbnails. Documents, as they tile
    // without an image to fetch.
    const papers = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`papers/${i}.pdf`, '']));
    await mockBackend(context, { ...FILES, ...papers });
    await page.goto('/files/media');
    await expect(page.locator('.media-grid .tile')).toHaveCount(32);
    await page.getByRole('checkbox', { name: 'Select the page' }).check();
    const remove = page.getByRole('button', { name: 'Delete the selected files' });
    await expect(remove).not.toHaveClass(/v-icon-btn--disabled/);

    await page.getByRole('button', { name: 'Show as a list' }).click();
    await expect(rows(page)).toHaveCount(20);
    await expect(remove).toHaveClass(/v-icon-btn--disabled/);
});

test('takes no second press to delete while the first is deleting', async ({ context, page }) => {
    const repository = await mockBackend(context, FILES);
    let release = () => {};
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    // Registered after `mockBackend`, so it answers first, and hands each delete on once released.
    await context.route(`${API_URL}notes/**`, async (route) => {
        if (route.request().method() === 'DELETE') {
            await released;
        }
        await route.fallback();
    });
    await page.goto('/files');
    await row(page, 'Ideas').getByRole('checkbox').check();
    const remove = page.getByRole('button', { name: 'Delete the selected files' });
    await remove.click();
    await expect(remove).toHaveClass(/v-icon-btn--disabled/);
    await remove.click({ force: true });
    release();
    await expect(rows(page)).toHaveCount(13);
    await expect(remove).toHaveClass(/v-icon-btn--disabled/);
    expect(repository.deletes).toEqual(['ideas.md']);
});

test('deletes no file the search hides', async ({ context, page }) => {
    const repository = await mockBackend(context, FILES);
    await page.goto('/files');
    await row(page, 'Ideas').getByRole('checkbox').check();
    const search = page.getByRole('textbox', { name: 'Search' });
    await search.fill('draft');
    await expect(rows(page)).toHaveCount(2);
    await row(page, 'Draft').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Delete the selected files' }).click();
    await expect(rows(page)).toHaveCount(1);

    await search.fill('');
    await expect(rows(page)).toHaveCount(13);
    expect(repository.deletes).toEqual(['ideas/draft.md']);
    await expect(row(page, 'Ideas').getByRole('checkbox')).not.toBeChecked();
});

test('narrows the search of every file to the kind of the open tab', async ({ context, page }) => {
    await mockBackend(context, FILES);
    await page.goto('/files?q=loose');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Loose notes');
    // By its title still, though the tab names it by its path.
    await tab(page, 'Uncategorized').click();
    await expect(page).toHaveURL(/\/files\/others\?q=loose$/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).getByRole('link', { name: '.tasks/notes.md', exact: true })).toBeVisible();

    // And a template by its heading, though the tab names it as the Add menu does.
    await page.getByRole('textbox', { name: 'Search' }).fill('xxx');
    await expect(rows(page).locator('.path')).toHaveCount(0);
    await tab(page, 'Templates').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).getByRole('link', { name: 'lecture', exact: true })).toBeVisible();
});

test('keeps the search box to the address on going back and forth', async ({ context, page }) => {
    await mockBackend(context, FILES);
    await page.goto('/files?q=draft');
    const search = page.getByRole('textbox', { name: 'Search' });
    await expect(rows(page)).toHaveCount(2);
    await tab(page, 'Notes').click();
    await expect(page).toHaveURL(/\/files\/notes\?q=draft$/);
    await search.fill('ideas');
    await expect(page).toHaveURL(/\/files\/notes\?q=ideas$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/files\?q=draft$/);
    await expect(search).toHaveValue('draft');
    await expect(rows(page)).toHaveCount(2);
    await expect(tab(page, 'Notes')).toHaveAttribute('href', '/files/notes?q=draft');

    await page.goForward();
    await expect(page).toHaveURL(/\/files\/notes\?q=ideas$/);
    await expect(search).toHaveValue('ideas');
    await expect(rows(page)).toHaveCount(2);

    // A note's address has no search, which is no search to bring back to the box.
    await rows(page).getByRole('link', { name: 'Ideas', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ideas' })).toBeVisible();
    expect(page.url()).toMatch(/\/note\/ideas\.md$/);
});

test('opens each tab at its first page, scrolled to the top', async ({ context, page }) => {
    const notes = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`notes/${i}.md`, `# Note ${i}\n`]));
    await mockBackend(context, { ...FILES, ...notes });
    await page.goto('/files');
    const info = page.locator('.v-data-table-footer__info');
    const wrapper = page.locator('.file-table .v-table__wrapper');
    await expect(info).toHaveText('1-20 of 64');
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(info).toHaveText('41-60 of 64');
    await wrapper.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => wrapper.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await tab(page, 'Notes').click();
    await expect(info).toHaveText('1-20 of 52');
    await expect.poll(() => wrapper.evaluate((element) => element.scrollTop)).toBe(0);
});

test('says when the search matches no media file', async ({ context, page }) => {
    await mockBackend(context, FILES);
    await page.goto('/files/media?q=zzz');
    await expect(page.locator('.media-grid')).toContainText('No media file matches the search');
    await page.getByRole('textbox', { name: 'Search' }).fill('');
    await expect(page.locator('.media-grid .tile')).toHaveCount(2);
});

test('draws an image as its thumbnail, and a document as what it is', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Firefox does not route a service worker\'s own requests.');
    await mockBackend(context, { ...FILES, 'photos/cat.png': '' });
    // Every image as one pixel. Registered after `mockBackend`, so it answers before the catch-all.
    await context.route(`${API_URL}files/**`, (route) => route.fulfill({ body: PIXEL, contentType: 'image/png' }));
    await page.goto('/files/media');
    const tiles = page.locator('.media-grid .tile');
    await expect(tiles.filter({ hasText: 'cat.png' }).locator('img')).toHaveJSProperty('naturalWidth', 1);
    // Either would have to be fetched whole for a frame or a page of it.
    await expect(tiles.filter({ hasText: 'paper.pdf' })).toBeVisible();
    await expect(tiles.filter({ hasText: 'paper.pdf' }).locator('img')).toHaveCount(0);
    await expect(tiles.filter({ hasText: 'demo.mp4' }).locator('img')).toHaveCount(0);
});

test('fetches a few thumbnails at a time, and only those in sight', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Firefox does not route a service worker\'s own requests.');
    // A page of thumbnails, more than the window shows.
    const photos = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`photos/${i}.png`, '']));
    await mockBackend(context, photos);
    // Each image a while in coming, as one moried has to convert first is.
    const requested: string[] = [];
    let pending = 0;
    let most = 0;
    await context.route(`${API_URL}files/**`, async (route) => {
        requested.push(decodeURIComponent(new URL(route.request().url()).pathname));
        pending += 1;
        most = Math.max(most, pending);
        await new Promise((resolve) => setTimeout(resolve, 200));
        pending -= 1;
        await route.fulfill({ body: PIXEL, contentType: 'image/png' });
    });
    await page.goto('/files/media');
    const tiles = page.locator('.media-grid .tile');
    await expect(tiles).toHaveCount(50);
    // The second row, in sight once the first has loaded.
    await expect(tiles.nth(12).locator('img')).toHaveJSProperty('naturalWidth', 1);
    expect(most).toBeLessThanOrEqual(4);

    const last = tiles.last();
    const lastPath = await last.locator('a').getAttribute('title');
    expect(requested.some((path) => path.endsWith(`/${lastPath}`))).toBe(false);
    await last.scrollIntoViewIfNeeded();
    await expect(last.locator('img')).toHaveJSProperty('naturalWidth', 1);
    expect(most).toBeLessThanOrEqual(4);
});

test('sorts blank cells last either way, and counts by their number', async ({ context, page }) => {
    const dates = Array.from({ length: 10 }, (_, i) => `{start: 2026-12-${String(i + 1).padStart(2, '0')}}`);
    await mockBackend(context, {
        ...FILES,
        '.events/classes.md': `---\nevents:\n    Classes:\n        instances: [${dates.join(', ')}]\n---\n\n# Classes\n`,
        '.mory/scratch.md': '# Scratch\n',
    });
    const titles = () => rows(page).locator('.path a').allTextContents();

    await page.goto('/files/events');
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).filter({ hasText: 'Classes' })).toContainText('On 10 dates');
    const repeats = page.getByRole('columnheader', { name: 'Repeats' });
    await repeats.click();
    await expect(repeats).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(async () => (await titles()).slice(0, 3)).toEqual(['Review', 'Classes', 'Meeting']);
    await repeats.click();
    await expect(repeats).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => (await titles()).slice(0, 3)).toEqual(['Meeting', 'Classes', 'Review']);

    await tab(page, 'System').click();
    await expect(rows(page)).toHaveCount(4);
    const purpose = page.getByRole('columnheader', { name: 'Used for' });
    await purpose.click();
    await expect(purpose).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(titles).toEqual(['.mory/plans/2026-10.yaml', '.mory/custom-note.css', '.mory/task-assessment.md', '.mory/scratch.md']);
    await purpose.click();
    await expect(purpose).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(titles).toEqual(['.mory/task-assessment.md', '.mory/custom-note.css', '.mory/plans/2026-10.yaml', '.mory/scratch.md']);
});

test('sorts the tasks without a deadline last either way', async ({ context, page }) => {
    await mockBackend(context, FILES);
    await page.goto('/files/tasks');
    const deadline = page.getByRole('columnheader', { name: 'Deadline' });
    const titles = () => rows(page).locator('a').allTextContents();

    await deadline.click();
    await expect.poll(titles).toEqual(['Write the report', 'Review the draft']);
    await deadline.click();
    await expect(deadline).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(titles).toEqual(['Write the report', 'Review the draft']);
});

test('sorts a task the tree leaves out last by its urgency or status', async ({ context, page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    // A second file for one UUID, as a copy made by hand would be: the tree takes the first alone,
    // so the tab lists the copy with nothing the tree works out.
    await mockBackend(context, { ...FILES, [`.tasks/copy-${REPORT}.md`]: '# Copy of the report\n' });
    await page.goto('/files/tasks');
    const titles = () => rows(page).locator('.path a').allTextContents();
    await expect(rows(page)).toHaveCount(3);

    for (const name of ['Urgency', 'Status']) {
        const header = page.getByRole('columnheader', { name });
        await header.click();
        await expect(header).toHaveAttribute('aria-sort', 'ascending');
        await expect.poll(async () => (await titles()).at(-1)).toBe('Copy of the report');
        await header.click();
        await expect(header).toHaveAttribute('aria-sort', 'descending');
        await expect.poll(async () => (await titles()).at(-1)).toBe('Copy of the report');
    }
    expect(errors).toEqual([]);
});

test('deletes a task only once nothing is under it', async ({ context, page }) => {
    const subtask = `.tasks/${REPORT}/${uuid(4)}.md`;
    const repository = await mockBackend(context, {
        ...FILES,
        [subtask]: '---\ntask:\n    status: {kind: todo}\n---\n\n# Gather the figures\n',
    });
    await page.goto('/files/tasks');
    await expect(rows(page)).toHaveCount(3);
    const remove = page.getByRole('button', { name: 'Delete the selected files' });
    await row(page, 'Write the report').getByRole('checkbox').check();
    await remove.click();
    // As the task view refuses it: deleting its file would leave what is under it at the top of
    // the tree.
    await expect(page.locator('.v-snackbar')).toContainText('Could not delete "Write the report": It has subtasks.');
    expect(repository.deletes).toEqual([]);

    // Together with what is under it, which goes first.
    await row(page, 'Gather the figures').getByRole('checkbox').check();
    await remove.click();
    await expect(rows(page)).toHaveCount(1);
    expect(repository.deletes).toEqual([subtask, `.tasks/${REPORT}.md`]);
});
