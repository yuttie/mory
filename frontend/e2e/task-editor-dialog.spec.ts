import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { API_URL, mockBackend, uuid } from './backend';

test.use({ timezoneId: 'Asia/Tokyo' });

function note(title: string, fields: string[] = []): string {
    return ['---', 'task:', '  status:', '    kind: todo', ...fields, '---', '', `# ${title}`, ''].join('\n');
}

const PROJECT = uuid(1);
const STEP = uuid(2);
// Due today, so Home lists it too.
const ERRAND = uuid(3);

const NOTES = {
    [`.tasks/${PROJECT}.md`]: note('Project'),
    [`.tasks/${PROJECT}/${STEP}.md`]: note('Step'),
    [`.tasks/${ERRAND}.md`]: note('Errand', ['  deadline: 2026-10-04']),
};

// The editor's dialog, told apart from the parent picker that opens over it.
function dialog(page: Page): Locator {
    return page.getByRole('dialog').filter({ has: page.locator('.task-editor-next') });
}

function title(page: Page): Locator {
    return dialog(page).getByRole('textbox', { name: 'Title', exact: true });
}

// The bar the dialog shows while a save runs, until the editor has read the saved note again.
function saving(page: Page): Locator {
    return dialog(page).locator('.v-overlay__content > .v-progress-linear');
}

// Open. Vuetify takes a dialog for the one on top, which Escape closes, a moment after it opens,
// and an Escape pressed before then does nothing; its opening transition outlasts that moment.
async function opened(page: Page): Promise<void> {
    const content = page.locator('.v-overlay__content').filter({ has: page.locator('.task-editor-next') });
    await expect.poll(() => content.evaluate((element) => element.getAnimations().length)).toBe(0);
}

function row(page: Page, name: string): Locator {
    return page.locator('.task-tree-container').getByRole('treeitem', { name });
}

// By its own title, rather than the titles of the tasks above it that an item shows too.
function listed(page: Page, title: string): Locator {
    return page.locator('.status-view .task-list-item').filter({ has: page.locator('.title-text', { hasText: title }) });
}

// The list of the selected node's descendants, with the task open in its editor over it, if any.
function url(selectedNodeId: string, viewMode: string, task?: string): RegExp {
    const query = task === undefined ? '' : `\\?task=${task}`;
    return new RegExp(`/tasks-next/${selectedNodeId}/descendants/${viewMode}${query}$`);
}

test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T03:00:00Z'));
});

// The list stays behind the editor, and closing it goes back to where it was opened from, so the
// browser's Forward opens it again.
test('opens a task over the list it is in, and closes back to that list', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next/_/descendants/status');
    await listed(page, 'Step').click();
    await expect(page).toHaveURL(url('_', 'status', STEP));
    await expect(title(page)).toHaveValue('Step');
    await expect(page.locator('.app-bar-current')).toHaveText('All tasks');
    // Every item links to the list's own address, and only the task open there is current.
    const current = page.locator('.status-view .task-list-item[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current.locator('.title-text')).toHaveText('Step');

    await opened(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url('_', 'status'));
    await expect(current).toHaveCount(0);

    await page.goForward();
    await expect(title(page)).toHaveValue('Step');
    await page.goBack();
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url('_', 'status'));
});

// Open still, for the next change, and as a dialog with nothing unsaved in it again.
test('saves a task and stays open on it', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    await listed(page, 'Step').click();
    await title(page).fill('  First step ');

    // Changed, it stays open unless told otherwise.
    await opened(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    // The address first, which a close changes at once, where the field stays while the dialog fades.
    await expect(page).toHaveURL(url(PROJECT, 'status', STEP));
    await expect(title(page)).toHaveValue('  First step ');

    const save = dialog(page).getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect.poll(() => repository.writes.map(({ path }) => path)).toEqual([`.tasks/${PROJECT}/${STEP}.md`]);
    expect(repository.writes[0].content).toContain('# First step\n');
    await expect(listed(page, 'First step')).toBeVisible();
    await expect(saving(page)).toHaveAttribute('aria-hidden', 'true');
    // As the note now reads, trimmed as it was saved.
    await expect(title(page)).toHaveValue('First step');
    await expect(save).toBeDisabled();
    await expect(page).toHaveURL(url(PROJECT, 'status', STEP));

    await title(page).fill('First step, revised');
    await save.click();
    await expect.poll(() => repository.writes.length).toBe(2);
    expect(repository.writes[1].content).toContain('# First step, revised\n');
    await expect(save).toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url(PROJECT, 'status'));
});

// What was typed after Save was pressed is not in the note, and is still there to save.
test('keeps what is typed while a save runs', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.route(`${API_URL}notes/**`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fallback();
    });
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    await listed(page, 'Step').click();
    await title(page).fill('First step');
    const save = dialog(page).getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect(saving(page)).toHaveAttribute('aria-hidden', 'false');
    await title(page).fill('First step, revised');

    await expect.poll(() => repository.writes.length).toBe(1);
    expect(repository.writes[0].content).toContain('# First step\n');
    await expect(saving(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(title(page)).toHaveValue('First step, revised');
    await expect(save).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(url(PROJECT, 'status', STEP));
    await expect(title(page)).toHaveValue('First step, revised');
});

// Under the task the editor holds, in a dialog of its own over the editor, which keeps what was
// typed into it. A draft has no task to add one under yet.
test('adds a subtask from the editor', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/_/descendants/status?task=${PROJECT}`);
    await title(page).fill('Project, renamed');
    await dialog(page).getByRole('button', { name: 'Add Subtask' }).click();

    const draft = page.getByRole('dialog').filter({ hasText: 'New subtask of "Project"' });
    await expect(draft.getByRole('button', { name: 'Add Subtask' })).toHaveCount(0);
    await draft.getByRole('textbox', { name: 'Title', exact: true }).fill('Second step');
    await draft.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => repository.writes.map(({ path }) => path)).toEqual([expect.stringMatching(new RegExp(`^\\.tasks/${PROJECT}/[0-9a-f-]{36}\\.md$`))]);
    expect(repository.writes[0].content).toContain('# Second step\n');
    await expect(draft).toBeHidden();
    await expect(page).toHaveURL(url('_', 'status', PROJECT));
    await expect(title(page)).toHaveValue('Project, renamed');
    await expect(listed(page, 'Second step')).toBeVisible();
});

// An outline of them, under the task the editor holds, as from the toolbar under the selected one.
test('quick adds subtasks from the editor', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/_/descendants/status?task=${PROJECT}`);
    await title(page).fill('Project, renamed');
    await dialog(page).getByRole('button', { name: 'Quick Add' }).click();

    const outline = page.getByRole('dialog').filter({ hasText: 'Quick add tasks' });
    await expect(outline.getByRole('button', { name: 'Under: Project' })).toBeVisible();
    await outline.locator('.cm-content').click();
    await page.keyboard.insertText('Second step\nThird step');
    await outline.getByRole('button', { name: 'Add 2 tasks' }).click();
    const under = expect.stringMatching(new RegExp(`^\\.tasks/${PROJECT}/[0-9a-f-]{36}\\.md$`));
    await expect.poll(() => repository.writes.map(({ path }) => path)).toEqual([under, under]);
    await expect(outline).toBeHidden();
    await expect(page).toHaveURL(url('_', 'status', PROJECT));
    await expect(title(page)).toHaveValue('Project, renamed');
    await expect(listed(page, 'Third step')).toBeVisible();
});

// The toolbar's still goes under the selected task, whatever the editor's went under.
test('quick adds from the toolbar under the selected task after the editor', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/_/descendants/status?task=${STEP}`);
    await dialog(page).getByRole('button', { name: 'Quick Add' }).click();
    const outline = page.getByRole('dialog').filter({ hasText: 'Quick add tasks' });
    await expect(outline.getByRole('button', { name: 'Under: Step' })).toBeVisible();
    await outline.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(outline).toBeHidden();
    await opened(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();

    await page.locator('.item-view .v-toolbar').getByTitle('Quick add', { exact: true }).click();
    await expect(outline.getByRole('button', { name: 'Under: Top level' })).toBeVisible();
});

// What was typed is still there to save again.
test('keeps the editor open when a save fails', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.route(`${API_URL}notes/**`, (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: {} }) : route.fallback());
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    await listed(page, 'Step').click();
    await title(page).fill('First step');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Could not save "First step"')).toBeVisible();
    await expect(page).toHaveURL(url(PROJECT, 'status', STEP));
    await expect(title(page)).toHaveValue('First step');
});

// Opened by its address, the dialog has no button of its own for Vuetify to give focus back to.
test('gives focus back to the task it was opened from once closed', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    await listed(page, 'Step').focus();
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveValue('Step');

    await opened(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(listed(page, 'Step')).toBeFocused();
});

// Moved out of sight, as into a task whose branch is closed, it would be lost from the tree.
test('opens the tree down to a task moved from its editor', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next/_/descendants/status');
    await expect(row(page, 'Step')).toHaveCount(0);
    await listed(page, 'Errand').click();
    await dialog(page).getByRole('button', { name: 'Change Parent' }).click();
    const picker = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Move Here' }) });
    await picker.getByRole('treeitem', { name: 'Project' }).click();
    await picker.getByRole('button', { name: 'Move Here' }).click();
    await expect(page).toHaveURL(url('_', 'status', ERRAND));

    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, 'Errand')).toBeVisible();
    await expect(row(page, 'Step')).toBeVisible();
});

// Back changes the address, which would close the editor and throw away what was typed, where
// Escape and a click outside cannot.
test('keeps an unsaved edit open on Back', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next/_/descendants/status');
    await listed(page, 'Step').click();
    await title(page).fill('First step');

    await page.evaluate(() => history.back());
    // Past the closing transition, which would keep the field in the page for a moment.
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(url('_', 'status', STEP));
    await expect(title(page)).toHaveValue('First step');

    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url('_', 'status'));
});

test('keeps an unsaved edit open on Back to another view', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/');
    await page.locator('.tasks-section .task-item', { hasText: 'Errand' }).click();
    await title(page).fill('Errand run');

    await page.evaluate(() => history.back());
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(url(ERRAND, 'status', ERRAND));
    await expect(title(page)).toHaveValue('Errand run');
});

// Vuetify keeps a new task's draft from Back by itself, but not from a Back to an entry a replace
// made: here, the one a closing editor left in place of its own, leading back to Home.
test('keeps an unsaved new task open on Back to another view', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/');
    await page.locator('.tasks-section .task-item', { hasText: 'Errand' }).click();
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await page.locator('.item-view .v-toolbar').getByRole('button', { name: 'Add', exact: true }).click();
    await title(page).fill('Draft');

    await page.evaluate(() => history.back());
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(url(ERRAND, 'status'));
    await expect(title(page)).toHaveValue('Draft');
});

// A link from another view opens the task in its own list. Closing it then stays in the task view
// rather than going back through history, which would leave it.
test('opens a task from another view, and closes it in place', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/');
    await page.locator('.tasks-section .task-item', { hasText: 'Errand' }).click();
    await expect(page).toHaveURL(url(ERRAND, 'status', ERRAND));
    await expect(title(page)).toHaveValue('Errand');

    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url(ERRAND, 'status'));
    await expect(page.locator('.app-bar-current')).toHaveText('Errand');

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
});

// The task whose descendants are listed, edited over that list.
test('edits the selected task from the toolbar, and closes back to its list', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PROJECT}/descendants/schedule`);
    const edit = page.locator('.item-view .v-toolbar').getByRole('link', { name: 'Edit', exact: true });
    // Its address is the list's own but for the query, which Vuetify ignores in marking a link
    // current unless told otherwise.
    await expect(edit).not.toHaveAttribute('aria-current', 'page');
    await edit.click();
    await expect(page).toHaveURL(url(PROJECT, 'schedule', PROJECT));
    await expect(title(page)).toHaveValue('Project');
    // Nor drawn as current under the editor, which would show as the editor fades.
    await expect(edit).not.toHaveClass(/v-btn--active/);

    await opened(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url(PROJECT, 'schedule'));
});

// All tasks is no task, and neither is a tag group.
for (const selection of ['_', 'tag-group-Untagged']) {
    test(`has no task to edit from the toolbar with ${selection} selected`, async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto(`/tasks-next/${selection}/descendants/status`);
        await expect(listed(page, 'Errand')).toBeVisible();
        await expect(page.locator('.item-view .v-toolbar').getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
    });
}

// A row's own button edits its task where the list is, as its "+" adds one under it there.
test('edits a task from its row in the tree, over the list as it is', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next/_/descendants/status');
    const project = row(page, 'Project');
    await project.hover();
    await project.getByRole('button', { name: 'Edit task', exact: true }).click();
    await expect(page).toHaveURL(url('_', 'status', PROJECT));
    await expect(title(page)).toHaveValue('Project');
    await expect(page.locator('.app-bar-current')).toHaveText('All tasks');

    await opened(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url('_', 'status'));
});

// The button is hidden once the pointer has left its row, and a hidden button takes no focus.
test('gives focus back to the row a task was edited from', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next/_/descendants/status');
    const project = row(page, 'Project');
    await project.hover();
    await project.getByRole('button', { name: 'Edit task', exact: true }).click();
    await opened(page);
    await page.mouse.move(0, 0);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(project).toBeFocused();
});

// A tag group is no task to edit.
test('offers no editor on a tag group row', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next/_/descendants/status');
    await expect(row(page, 'Untagged')).toBeVisible();
    await expect(row(page, 'Project').getByRole('button', { name: 'Edit task', includeHidden: true })).toHaveCount(1);
    await expect(row(page, 'Untagged').getByRole('button', { name: 'Edit task', includeHidden: true })).toHaveCount(0);
});

// The editor was a tab beside the list, and its addresses are in bookmarks and history.
test('opens a task from the address of its former editor tab', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${STEP}/selected/schedule`);
    await expect(page).toHaveURL(url(STEP, 'schedule', STEP));
    await expect(title(page)).toHaveValue('Step');
});

test('deletes a task opened from a list, and goes back to the list', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    await listed(page, 'Step').click();
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => repository.deletes).toEqual([`.tasks/${PROJECT}/${STEP}.md`]);
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url(PROJECT, 'status'));
    await expect(listed(page, 'Step')).toHaveCount(0);
});

// A save writes to the path it started with, which a move meanwhile would leave behind.
test('moves no task while its save runs', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.route(`${API_URL}notes/**`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fallback();
    });
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    await listed(page, 'Step').click();
    await title(page).fill('First step');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Change Parent' }).click();

    await expect.poll(() => repository.writes.length).toBe(1);
    await expect(saving(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Move Here' }) })).toHaveCount(0);
    expect(repository.renames).toEqual([]);
});

test('keeps the editor open when a delete fails', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.route(`${API_URL}notes/**`, (route) => route.request().method() === 'DELETE' ? route.fulfill({ status: 500, json: {} }) : route.fallback());
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    await listed(page, 'Step').click();
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Could not delete "Step"')).toBeVisible();
    await expect(page).toHaveURL(url(PROJECT, 'status', STEP));
    await expect(title(page)).toHaveValue('Step');
});

// Its list was of what lay under it, which went with it.
test('deletes the selected task, and lists every task', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${ERRAND}/descendants/status?task=${ERRAND}`);
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => repository.deletes).toEqual([`.tasks/${ERRAND}.md`]);
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url('_', 'status'));
    await expect(listed(page, 'Project')).toBeVisible();
    await expect(listed(page, 'Errand')).toHaveCount(0);
});

// Full screen, with no scrim to click or Escape to press, so Cancel is the way out.
test('closes the editor full screen on a phone with Cancel', async ({ context, page }) => {
    await page.setViewportSize({ width: 360, height: 680 });
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    await listed(page, 'Step').click();
    await expect(page.locator('.v-dialog--fullscreen').filter({ has: page.locator('.task-editor-next') })).toBeVisible();

    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(url(PROJECT, 'status'));
});
