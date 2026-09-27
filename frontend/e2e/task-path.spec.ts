import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

function note(title: string): string {
    return ['---', 'task:', '  status:', '    kind: todo', '---', '', `# ${title}`, ''].join('\n');
}

const PROJECT = uuid(1);
const PHASE = uuid(2);
const STEP = uuid(3);

const NOTES = {
    [`.tasks/${PROJECT}.md`]: note('Project'),
    [`.tasks/${PROJECT}/${PHASE}.md`]: note('Phase'),
    [`.tasks/${PROJECT}/${PHASE}/${STEP}.md`]: note('Step'),
};

// The selected node's path in the app bar, root first.
function path(page: Page): Locator {
    return page.locator('.app-bar-title');
}

function url(selectedNodeId: string, tab: string, viewMode: string): RegExp {
    return new RegExp(`/tasks-next/${selectedNodeId}/${tab}/${viewMode}$`);
}

test('goes up the path to an ancestor, keeping the tab and view', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${STEP}/descendants/schedule`);
    await expect(path(page).getByRole('link')).toHaveText(['All tasks', 'Project', 'Phase']);
    await expect(path(page).locator('.app-bar-current')).toHaveText('Step');
    // A link, so it can be opened in a new tab as well.
    await expect(path(page).getByRole('link', { name: 'Phase' })).toHaveAttribute('href', `/tasks-next/${PHASE}/descendants/schedule`);

    await path(page).getByRole('link', { name: 'Phase' }).click();
    await expect(page).toHaveURL(url(PHASE, 'descendants', 'schedule'));
    await expect(path(page).getByRole('link')).toHaveText(['All tasks', 'Project']);
    await expect(path(page).locator('.app-bar-current')).toHaveText('Phase');

    // From the editor, the ancestor is edited in turn.
    await page.goto(`/tasks-next/${STEP}/selected/schedule`);
    await path(page).getByRole('link', { name: 'Project' }).click();
    await expect(page).toHaveURL(url(PROJECT, 'selected', 'schedule'));
    await expect(path(page).getByRole('link')).toHaveText(['All tasks']);
    await expect(path(page).locator('.app-bar-current')).toHaveText('Project');
});

test('clears the selection from the root of the path', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${STEP}/selected/schedule`);

    await path(page).getByRole('link', { name: 'All tasks' }).click();
    // The Selected tab goes with the selection, so the list of every task is what is left.
    await expect(page).toHaveURL(url('_', 'descendants', 'schedule'));
    await expect(page.getByRole('tab', { name: 'All tasks' })).toHaveAttribute('aria-selected', 'true');
    await expect(path(page).getByRole('link')).toHaveCount(0);
    await expect(path(page).locator('.app-bar-current')).toHaveCount(0);
});
