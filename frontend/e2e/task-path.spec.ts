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

// The list of the selected node's descendants, with the task open in its editor over it, if any.
function url(selectedNodeId: string, viewMode: string, task?: string): RegExp {
    const query = task === undefined ? '' : `\\?task=${task}`;
    return new RegExp(`/tasks-next/${selectedNodeId}/descendants/${viewMode}${query}$`);
}

test('goes up the path to an ancestor, keeping the view', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${STEP}/descendants/schedule`);
    await expect(path(page).getByRole('link')).toHaveText(['All tasks', 'Project', 'Phase']);
    await expect(path(page).locator('.app-bar-current')).toHaveText('Step');
    // A link, so it can be opened in a new tab as well.
    await expect(path(page).getByRole('link', { name: 'Phase' })).toHaveAttribute('href', `/tasks-next/${PHASE}/descendants/schedule`);

    await path(page).getByRole('link', { name: 'Phase' }).click();
    await expect(page).toHaveURL(url(PHASE, 'schedule'));
    await expect(path(page).getByRole('link')).toHaveText(['All tasks', 'Project']);
    await expect(path(page).locator('.app-bar-current')).toHaveText('Phase');
});

test('clears the selection from the root of the path', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${STEP}/descendants/schedule`);

    await path(page).getByRole('link', { name: 'All tasks' }).click();
    await expect(page).toHaveURL(url('_', 'schedule'));
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
    await page.goto(`/tasks-next/${STEP}/descendants/status?task=${STEP}`);
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
    await page.goto(`/tasks-next/${PHASE}/descendants/status?task=${PHASE}`);
    await page.getByRole('button', { name: 'Change Parent' }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Move Here' }) });
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

test('keeps what has been typed into a task when it is moved', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PHASE}/descendants/status?task=${PHASE}`);
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await title.fill('Phase one');

    await page.getByRole('button', { name: 'Change Parent' }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Move Here' }) });
    await dialog.getByText('Root (No Parent)').click();
    await dialog.getByRole('button', { name: 'Move Here' }).click();
    await expect(path(page).getByRole('link')).toHaveText(['All tasks']);

    await expect(title).toHaveValue('Phase one');
    // Still unsaved, and saved where the task now is.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => repository.writes.map(({ path: written }) => written)).toEqual([`.tasks/${PHASE}.md`]);
    expect(repository.writes[0].content).toContain('# Phase one');
});

// A browser that has never synced has nothing cached to paint the tree from. Drawn before the
// listing lands, the view has no task to select or edit, and must not drop either from the address.
test('keeps the task its address selects and edits while the first listing is on its way', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.route(`${API_URL}v2/entries**`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fallback();
    });
    await page.goto(`/tasks-next/${STEP}/descendants/schedule?task=${STEP}`);
    await expect(path(page).locator('.app-bar-current')).toHaveText('Step');
    await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Step');
    await expect(page).toHaveURL(url(STEP, 'schedule', STEP));
});

// A new task starts under the selected one, and choosing another parent leaves the list behind it
// where it was, keeping the draft.
test('chooses a new task\'s parent from its editor, starting from the selected task', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PHASE}/descendants/status`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const editor = page.getByRole('dialog').filter({ has: page.locator('.task-editor-next') });
    await expect(editor.locator('.editor-title')).toHaveText('New subtask of "Phase"');
    await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft');

    await editor.getByRole('button', { name: 'Choose Parent' }).click();
    const picker = page.getByRole('dialog').filter({ hasText: 'Select a parent for the new task' });
    await expect(picker.locator('.v-list-item--active')).toContainText('Phase');
    await picker.getByRole('treeitem', { name: 'Project' }).click();
    await picker.getByRole('button', { name: 'Choose', exact: true }).click();

    await expect(page).toHaveURL(url(PHASE, 'status'));
    await expect(editor.locator('.editor-title')).toHaveText('New subtask of "Project"');
    await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Draft');
    await editor.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => repository.writes.map((write) => write.path))
        .toEqual([expect.stringMatching(new RegExp(`^\\.tasks/${PROJECT}/[0-9a-f-]{36}\\.md$`))]);
});
