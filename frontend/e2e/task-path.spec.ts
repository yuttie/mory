import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { API_URL, mockBackend, uuid } from './backend';

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
    // The root stays, as where the path is, with nothing to go up to.
    await expect(path(page).getByRole('link')).toHaveCount(0);
    await expect(path(page).locator('.app-bar-current')).toHaveText('All tasks');
});

// The assessment weighs a title against the tasks above it, which the editor works out from where
// the task is, before the listing holds a new one.
test('assesses a task with the titles above it, new or saved', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    const assessed = () => page.waitForRequest((request) => request.url().endsWith('/v2/assess-task'));

    let request = assessed();
    await page.goto(`/tasks-next/${STEP}/selected/status`);
    expect((await request).postDataJSON().ancestor_titles).toEqual(['Project', 'Phase']);

    await page.goto(`/tasks-next/${PHASE}/descendants/status`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.editor-title')).toHaveText('New subtask of "Phase"');
    request = assessed();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft');
    expect((await request).postDataJSON().ancestor_titles).toEqual(['Project', 'Phase']);
});

test('moves a task to the parent chosen for it, starting from the one it has', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PHASE}/selected/status`);
    await page.getByRole('button', { name: 'Change Parent' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.v-list-item--active')).toContainText('Project');
    // Project is open, yet Phase is not under it: a task cannot be moved under itself.
    await expect(dialog.getByRole('treeitem', { name: 'Project' })).toBeVisible();
    await expect(dialog.getByRole('treeitem', { name: 'Phase' })).toHaveCount(0);
    const move = dialog.getByRole('button', { name: 'Move Here' });
    await expect(move).toBeDisabled();

    await dialog.getByText('Root (No Parent)').click();
    await move.click();
    await expect(path(page).getByRole('link')).toHaveText(['All tasks']);
    await expect(path(page).locator('.app-bar-current')).toHaveText('Phase');
});

// A browser that has never synced has nothing cached to paint the tree from. Drawn before the
// listing lands, the view had no selected task, and its tabs fell back to Descendants, dropping
// the task from the address.
test('keeps the task its address selects while the first listing is on its way', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.route(`${API_URL}v2/entries**`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fallback();
    });
    await page.goto(`/tasks-next/${STEP}/selected/schedule`);
    await expect(path(page).locator('.app-bar-current')).toHaveText('Step');
    await expect(page).toHaveURL(url(STEP, 'selected', 'schedule'));
});

// A new task goes under the selected one, so choosing its parent selects that, keeping the draft.
test('chooses a new task\'s parent from its editor', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto('/tasks-next/_/descendants/status');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft');

    await page.getByRole('button', { name: 'Choose Parent' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Select a parent for the new task')).toBeVisible();
    await dialog.getByRole('treeitem', { name: 'Project' }).click();
    await dialog.getByRole('button', { name: 'Choose', exact: true }).click();

    await expect(page).toHaveURL(url(PROJECT, 'selected', 'status'));
    await expect(page.locator('.editor-title')).toHaveText('New subtask of "Project"');
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Draft');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => repository.writes.map((write) => write.path))
        .toEqual([expect.stringMatching(new RegExp(`^\\.tasks/${PROJECT}/[0-9a-f-]{36}\\.md$`))]);
});
