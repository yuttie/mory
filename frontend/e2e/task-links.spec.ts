import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

function note(title: string, tags: string[] = []): string {
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
const STEP = uuid(2);
// A root task with no children, which the tree files under its tag rather than at the top.
const ERRAND = uuid(3);

const NOTES = {
    [`.tasks/${PROJECT}.md`]: note('Project'),
    [`.tasks/${PROJECT}/${STEP}.md`]: note('Step'),
    [`.tasks/${ERRAND}.md`]: note('Errand', ['work']),
};

function tree(page: Page): Locator {
    return page.locator('.task-tree-container');
}

function row(page: Page, name: string): Locator {
    return tree(page).getByRole('treeitem', { name }).first();
}

function url(selectedNodeId: string, tab: string, viewMode: string): RegExp {
    return new RegExp(`/tasks-next/${selectedNodeId}/${tab}/${viewMode}$`);
}

test.describe('the tree', () => {
    test('links each row to its task, keeping the view', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/schedule');
        await expect(row(page, 'Project')).toHaveAttribute('href', `/tasks-next/${PROJECT}/selected/schedule`);
        // A tag group is no task to edit, so it lists the tasks it holds.
        await expect(row(page, 'work')).toHaveAttribute('href', '/tasks-next/tag-group-work/descendants/schedule');

        await row(page, 'Project').click();
        await expect(page).toHaveURL(url(PROJECT, 'selected', 'schedule'));
        // Clicked again, the task stays selected: the root of the path is what clears it.
        await row(page, 'Project').click();
        await expect(page).toHaveURL(url(PROJECT, 'selected', 'schedule'));
    });

    test('opens a task in a new tab on a Ctrl-click, leaving this one where it was', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/status');

        const opened = context.waitForEvent('page');
        await row(page, 'Project').click({ modifiers: ['ControlOrMeta'] });
        await expect(await opened).toHaveURL(url(PROJECT, 'selected', 'status'));
        await expect(page).toHaveURL(url('_', 'descendants', 'status'));
    });

    test('goes to a task from the keyboard', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/tasks-next/_/descendants/status');

        await row(page, 'Project').focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(url(PROJECT, 'selected', 'status'));
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
        await expect(page.getByRole('tab', { name: 'New' })).toHaveAttribute('aria-selected', 'true');
        await expect(page).toHaveURL(url(PROJECT, 'selected', 'status'));
        expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
    });
});
