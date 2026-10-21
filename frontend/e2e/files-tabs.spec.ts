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
