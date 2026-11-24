import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

function note(title: string, status: string): string {
    return ['---', 'task:', '  status:', `    kind: ${status}`, '---', '', `# ${title}`, ''].join('\n');
}

const FINISHED = uuid(2);
const DROPPED = uuid(3);

const NOTES = {
    [`.tasks/${uuid(1)}.md`]: note('Under way', 'in_progress'),
    [`.tasks/${FINISHED}.md`]: note('Finished', 'done'),
    [`.tasks/${DROPPED}.md`]: note('Dropped', 'canceled'),
};

// Canceled after the other was done, so it comes first of the two.
const TIMES = {
    times: {
        [`.tasks/${FINISHED}.md`]: '2026-09-01T12:00:00+00:00',
        [`.tasks/${DROPPED}.md`]: '2026-09-02T12:00:00+00:00',
    },
};

function tree(page: Page): Locator {
    return page.locator('.task-tree-container');
}

function row(page: Page, name: string): Locator {
    return tree(page).getByRole('treeitem', { name });
}

function rows(page: Page): Locator {
    return tree(page).getByRole('treeitem').locator('.v-list-item-title');
}

test('expands and folds the closed tasks in place, from the keyboard too, going nowhere', async ({ context, page }) => {
    await mockBackend(context, NOTES, TIMES);
    await page.goto('/tasks-next/_/descendants/status');
    await expect(rows(page)).toHaveText(['Under way', 'Show 2 closed']);
    // A link would be to a task, and the row is none.
    await expect(row(page, 'Show 2 closed')).not.toHaveAttribute('href');

    await row(page, 'Show 2 closed').click();
    await expect(rows(page)).toHaveText(['Under way', 'Dropped', 'Finished', 'Hide 2 closed']);
    // Among the tasks, at their own level, rather than under the row.
    await expect(row(page, 'Finished')).toHaveAttribute('aria-level', '1');
    // The focus stays on the row, its tasks drawn before it or taken away.
    await row(page, 'Hide 2 closed').press('Enter');
    await expect(rows(page)).toHaveText(['Under way', 'Show 2 closed']);
    await expect(row(page, 'Show 2 closed')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(rows(page)).toHaveText(['Under way', 'Dropped', 'Finished', 'Hide 2 closed']);
    await expect(row(page, 'Hide 2 closed')).toBeFocused();
    await expect(page).toHaveURL(/\/tasks-next\/_\/descendants\/status$/);
});

test('draws a closed task chosen, with the tasks it was folded with', async ({ context, page }) => {
    await mockBackend(context, NOTES, TIMES);
    await page.goto(`/tasks-next/${FINISHED}/descendants/status`);
    await expect(rows(page)).toHaveText(['Under way', 'Dropped', 'Finished', 'Hide 2 closed']);
});

test('draws a closed task chosen among what a search found once the search is cleared', async ({ context, page }) => {
    await mockBackend(context, NOTES, TIMES);
    await page.goto('/tasks-next/_/descendants/status');
    await page.getByRole('textbox', { name: 'Search tasks' }).fill('Finished');
    await expect(rows(page)).toHaveText(['Finished']);
    await row(page, 'Finished').click();
    await expect(page).toHaveURL(new RegExp(`/tasks-next/${FINISHED}/`));
    await page.getByRole('button', { name: 'Clear Search tasks' }).click();
    await expect(rows(page)).toHaveText(['Under way', 'Dropped', 'Finished', 'Hide 2 closed']);
});

test('draws a closed task chosen once the status filter gives it back', async ({ context, page }) => {
    await mockBackend(context, NOTES, TIMES);
    await page.goto('/tasks-next/_/descendants/status');
    const statuses = tree(page).getByRole('button', { name: 'Choose which statuses are shown' });
    const closed = page.locator('.v-overlay--active .v-list-item').filter({ has: page.getByText('Closed', { exact: true }) });
    await statuses.click();
    await closed.click();
    await page.keyboard.press('Escape');
    await expect(rows(page)).toHaveText(['Under way']);

    await page.goto(`/tasks-next/${FINISHED}/descendants/status`);
    await expect(rows(page)).toHaveText(['Under way']);
    await statuses.click();
    await closed.click();
    await expect(rows(page)).toHaveText(['Under way', 'Dropped', 'Finished', 'Hide 2 closed']);
});

// Found open and closed, as a list of closed tasks alone is not folded anyway.
test('folds nothing a search finds', async ({ context, page }) => {
    await mockBackend(context, NOTES, TIMES);
    await page.goto('/tasks-next/_/descendants/status');
    await page.getByRole('textbox', { name: 'Search tasks' }).fill('e');
    await expect(rows(page)).toHaveText(['Under way', 'Dropped', 'Finished']);
});

// Twelve closed tasks, the first closed last: more than one click on the fold draws.
const MANY = Array.from({ length: 12 }, (_, index) => ({
    path: `.tasks/${uuid(10 + index)}.md`,
    title: `Closed ${index + 1}`,
    time: `2026-09-${String(30 - index).padStart(2, '0')}T12:00:00+00:00`,
}));

const MANY_NOTES = {
    [`.tasks/${uuid(1)}.md`]: note('Under way', 'in_progress'),
    ...Object.fromEntries(MANY.map(({ path, title }) => [path, note(title, 'done')])),
};

const MANY_TIMES = { times: Object.fromEntries(MANY.map(({ path, time }) => [path, time])) };

function titles(count: number): string[] {
    return MANY.slice(0, count).map(({ title }) => title);
}

test('draws ten closed tasks more each time, the latest first, and hides them from the row or its button', async ({ context, page }) => {
    await mockBackend(context, MANY_NOTES, MANY_TIMES);
    await page.goto('/tasks-next/_/descendants/status');
    await expect(rows(page)).toHaveText(['Under way', 'Show 10 of 12 closed']);

    await row(page, 'Show 10 of 12 closed').click();
    await expect(rows(page)).toHaveText(['Under way', ...titles(10), 'Show 2 more of 12 closed']);
    await row(page, 'Show 2 more of 12 closed').press('Enter');
    await expect(rows(page)).toHaveText(['Under way', ...titles(12), 'Hide 12 closed']);
    await row(page, 'Hide 12 closed').click();
    await expect(rows(page)).toHaveText(['Under way', 'Show 10 of 12 closed']);

    // Some drawn, the row draws more, and its button folds them all. The button shows only on the
    // row pointed at or focused, as a task's do.
    await row(page, 'Show 10 of 12 closed').click();
    const more = row(page, 'Show 2 more of 12 closed');
    const hide = more.getByRole('button', { name: 'Hide 12 closed' });
    await more.hover();
    await hide.click();
    await expect(rows(page)).toHaveText(['Under way', 'Show 10 of 12 closed']);
    await row(page, 'Show 10 of 12 closed').press('Enter');
    await page.mouse.move(0, 0);
    await more.focus();
    await hide.press('Enter');
    await expect(rows(page)).toHaveText(['Under way', 'Show 10 of 12 closed']);
    // On the row, as the button went with what it hid.
    await expect(row(page, 'Show 10 of 12 closed')).toBeFocused();
    await expect(page).toHaveURL(/\/tasks-next\/_\/descendants\/status$/);
});

test('draws as many of the closed tasks as reach the one chosen', async ({ context, page }) => {
    await mockBackend(context, MANY_NOTES, MANY_TIMES);
    await page.goto(`/tasks-next/${uuid(12)}/descendants/status`);
    await expect(rows(page)).toHaveText(['Under way', ...titles(10), 'Show 2 more of 12 closed']);
    await page.goto(`/tasks-next/${uuid(21)}/descendants/status`);
    await expect(rows(page)).toHaveText(['Under way', ...titles(12), 'Hide 12 closed']);
});

// Until a branch just opened has grown, Playwright scrolls it to reach a row in it, and the row
// moves: see task-tree-move.spec.ts.
async function settled(page: Page): Promise<void> {
    await expect.poll(() => tree(page).locator('.entry-tree').evaluate((element) => (
        element.querySelector('[class*="enter-active"], [class*="leave-active"]') === null
        && element.getAnimations({ subtree: true }).length === 0
    )), { intervals: [50] }).toBe(true);
}

async function moveOver(page: Page, target: Locator): Promise<void> {
    const box = await target.boundingBox();
    if (box === null) {
        throw new Error(`Not drawn: ${target}`);
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
}

const OTHER = uuid(4);

test('draws a closed task moved where it went, among the closed tasks there', async ({ context, page }) => {
    const repository = await mockBackend(context, {
        [`.tasks/${uuid(1)}.md`]: note('Under way', 'in_progress'),
        [`.tasks/${OTHER}.md`]: note('Other', 'todo'),
        [`.tasks/${OTHER}/${uuid(5)}.md`]: note('Chore', 'todo'),
        [`.tasks/${FINISHED}.md`]: note('Finished', 'done'),
    });
    await page.goto('/tasks-next/_/descendants/status');
    await row(page, 'Show 1 closed').click();
    await expect(rows(page)).toHaveText(['Under way', 'Other', 'Finished', 'Hide 1 closed']);
    await settled(page);

    await moveOver(page, row(page, 'Finished'));
    await page.mouse.down();
    await moveOver(page, row(page, 'Other'));
    await expect(row(page, 'Other')).toHaveCSS('outline-style', 'solid');
    await page.mouse.up();

    await expect.poll(() => repository.renames).toEqual([
        { from: `.tasks/${FINISHED}.md`, to: `.tasks/${OTHER}/${FINISHED}.md` },
    ]);
    await expect(rows(page)).toHaveText(['Under way', 'Other', 'Chore', 'Finished', 'Hide 1 closed']);
    await expect(row(page, 'Finished')).toHaveAttribute('aria-level', '2');
});
