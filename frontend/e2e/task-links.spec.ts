import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

function note(title: string, { tags = [] }: { tags?: string[] } = {}): string {
    return [
        '---',
        'task:',
        '  status:',
        '    kind: todo',
        ...(tags.length > 0 ? [`tags: [${tags.join(', ')}]`] : []),
        '---',
        '',
        `# ${title}`,
        '',
    ].join('\n');
}

const PROJECT = uuid(1);
// Gives Project a child, so the tree keeps it at the top rather than filing it under Untagged.
const STEP = uuid(2);
// A root task with no children, which the tree files under its tag rather than at the top.
const ERRAND = uuid(3);

const NOTES = {
    [`.tasks/${PROJECT}.md`]: note('Project'),
    [`.tasks/${PROJECT}/${STEP}.md`]: note('Step'),
    [`.tasks/${ERRAND}.md`]: note('Errand', { tags: ['work'] }),
};

function tree(page: Page): Locator {
    return page.locator('.task-tree-container');
}

// Strict, so a task drawn twice, at the top and under a tag, fails rather than passes on either.
function row(page: Page, name: string): Locator {
    return tree(page).getByRole('treeitem', { name });
}

// The task in one of the list's views, found by the class of the view's root.
function listed(page: Page, view: string, title: string): Locator {
    return page.locator(`${view} .task-list-item`, { hasText: title });
}

// The list of the selected node's descendants, with the task open in its editor over it, if any.
function url(selectedNodeId: string, viewMode: string, task?: string): RegExp {
    const query = task === undefined ? '' : `\\?task=${task}`;
    return new RegExp(`/tasks-next/${selectedNodeId}/descendants/${viewMode}${query}$`);
}

test.describe('the tree', () => {
    // The tasks under it, rather than its editor, which would cover them: its row's own button opens
    // that.
    test('links each row to the tasks under its task, keeping the view', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/schedule');
        await expect(row(page, 'Project')).toHaveAttribute('href', `/tasks-next/${PROJECT}/descendants/schedule`);

        await row(page, 'Project').click();
        await expect(page).toHaveURL(url(PROJECT, 'schedule'));
        await expect(page.locator('.app-bar-current')).toHaveText('Project');
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    // The tree stays while the view changes beside it, so its links have to follow.
    test('follows a change of view in each row\'s link', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/status');

        await page.getByRole('button', { name: 'Schedule' }).click();
        await expect(page).toHaveURL(url('_', 'schedule'));
        await expect(row(page, 'Project')).toHaveAttribute('href', `/tasks-next/${PROJECT}/descendants/schedule`);
    });

    test('links a tag group to the tasks filed under it', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/schedule');
        await expect(row(page, 'work')).toHaveAttribute('href', '/tasks-next/tag-group-work/descendants/schedule');
    });

    // The root of the path is what clears the selection.
    test('keeps the selection when the selected row is clicked again', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto(`/tasks-next/${PROJECT}/descendants/schedule`);
        await expect(page.locator('.app-bar-current')).toHaveText('Project');

        await row(page, 'Project').click();
        // Long enough for a navigation the click set off to have landed.
        await page.waitForTimeout(500);
        await expect(page).toHaveURL(url(PROJECT, 'schedule'));
        await expect(page.locator('.app-bar-current')).toHaveText('Project');
    });

    test('opens a task in a new tab on a Ctrl-click, leaving this one where it was', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/status');

        const opened = context.waitForEvent('page');
        await row(page, 'Project').click({ modifiers: ['ControlOrMeta'] });
        await expect(await opened).toHaveURL(url(PROJECT, 'status'));
        await expect(page).toHaveURL(url('_', 'status'));
    });

    test('goes to a task from the keyboard', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/status');

        await row(page, 'Project').press('Enter');
        await expect(page).toHaveURL(url(PROJECT, 'status'));
    });

    test('adds a child task from a row without following the row\'s link', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/status');
        // Lost if the browser loads the link as a new page rather than the app routing to it.
        await page.evaluate(() => {
            (window as unknown as { loaded: boolean }).loaded = true;
        });

        await row(page, 'Project').hover();
        await row(page, 'Project').getByRole('button', { name: 'Add child task' }).click();
        await expect(page.getByRole('dialog').locator('.editor-title')).toHaveText('New subtask of "Project"');
        await expect(page).toHaveURL(url('_', 'status'));
        expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
    });
});

// A task opened from a list opens over that list, which stays as it was.
test.describe('the lists', () => {
    test('link each task to its editor, keeping the list and its view', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        for (const [viewMode, view] of [['status', '.status-view'], ['schedule', '.planning-view .candidates'], ['eisenhower', '.eisenhower-matrix']]) {
            await page.goto(`/tasks-next/_/descendants/${viewMode}`);
            await expect(listed(page, view, 'Errand')).toHaveAttribute('href', `/tasks-next/_/descendants/${viewMode}?task=${ERRAND}`);
        }
    });

    // Sortable swallows the click that ends a drag, and must leave a plain one alone.
    test('go to a task on a click, though the status view lets it be dragged', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/status');

        await listed(page, '.status-view', 'Errand').click();
        await expect(page).toHaveURL(url('_', 'status', ERRAND));
    });

    test('open a task in a new tab on a Ctrl-click, leaving this one where it was', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/status');

        const opened = context.waitForEvent('page');
        await listed(page, '.status-view', 'Errand').click({ modifiers: ['ControlOrMeta'] });
        await expect(await opened).toHaveURL(url('_', 'status', ERRAND));
        await expect(page).toHaveURL(url('_', 'status'));
    });
});
