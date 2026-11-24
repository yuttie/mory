import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { API_URL, mockBackend, uuid } from './backend';

function note(title: string, status: string): string {
    return ['---', 'task:', '  status:', `    kind: ${status}`, '---', '', `# ${title}`, ''].join('\n');
}

const PROJECT = uuid(1);
const MOVED = uuid(5);
const FINISHED = uuid(6);

// Project holds a step under way and two over with, beside a task finished, and the task to move
// is at `moved`.
function notes(moved: string): Record<string, string> {
    return {
        [`.tasks/${PROJECT}.md`]: note('Project', 'todo'),
        [`.tasks/${PROJECT}/${uuid(2)}.md`]: note('Draft', 'in_progress'),
        [`.tasks/${PROJECT}/${uuid(3)}.md`]: note('Old step', 'done'),
        [`.tasks/${PROJECT}/${uuid(4)}.md`]: note('Dropped step', 'canceled'),
        [`.tasks/${FINISHED}.md`]: note('Finished', 'done'),
        [moved]: note('Moved', 'todo'),
    };
}

// Dropped after the other was done, so it comes first of the two.
const TIMES = {
    times: {
        [`.tasks/${PROJECT}/${uuid(3)}.md`]: '2026-09-01T12:00:00+00:00',
        [`.tasks/${PROJECT}/${uuid(4)}.md`]: '2026-09-02T12:00:00+00:00',
    },
};

async function openPicker(page: Page, task: string): Promise<Locator> {
    await page.goto(`/tasks-next/${task}/descendants/status?task=${task}`);
    await page.getByRole('button', { name: 'Change Parent' }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Move Here' }) });
    await expect(dialog).toBeVisible();
    return dialog;
}

function rows(dialog: Locator): Locator {
    return dialog.getByRole('treeitem').locator('.v-list-item-title');
}

// Until a branch has closed, the rows in it are still drawn, and a branch closing as others open
// can pass for one left open. Settled once no transition is under way, which Vue marks from its
// start, and the tree's own animations are over, as `settled` in task-tree-filter.spec.ts tells.
async function settled(dialog: Locator): Promise<void> {
    await expect.poll(() => dialog.locator('.entry-tree').evaluate((element) => (
        element.querySelector('[class*="enter-active"], [class*="leave-active"]') === null
        && element.getAnimations({ subtree: true }).length === 0
    )), { intervals: [50] }).toBe(true);
}

test('folds the closed tasks, and draws them when asked, choosing none of them', async ({ context, page }) => {
    await mockBackend(context, notes(`.tasks/${MOVED}.md`), TIMES);
    const dialog = await openPicker(page, MOVED);
    await expect(rows(dialog)).toHaveText(['Project', 'Draft', 'Show 2 closed', 'Show 1 closed']);

    await dialog.getByRole('treeitem', { name: 'Show 2 closed' }).click();
    await expect(rows(dialog)).toHaveText(['Project', 'Draft', 'Dropped step', 'Old step', 'Hide 2 closed', 'Show 1 closed']);
    // The task has no parent, and the dialog still says so.
    await expect(dialog.locator('.v-list-item--active')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Move Here' })).toBeDisabled();

    await dialog.getByRole('treeitem', { name: 'Hide 2 closed' }).press('Enter');
    await expect(rows(dialog)).toHaveText(['Project', 'Draft', 'Show 2 closed', 'Show 1 closed']);
});

test('draws the closed parent the task has', async ({ context, page }) => {
    await mockBackend(context, notes(`.tasks/${FINISHED}/${MOVED}.md`), TIMES);
    const dialog = await openPicker(page, MOVED);
    await expect(dialog.locator('.v-list-item--active')).toContainText('Finished');
    await expect(rows(dialog)).toHaveText(['Project', 'Draft', 'Show 2 closed', 'Finished', 'Hide 1 closed']);
});

// A row of the open status menu, by its title alone, as task-tree-filter.spec.ts finds one.
function status(page: Page, name: string): Locator {
    return page.locator('.v-menu.v-overlay--active .v-list-item').filter({ has: page.getByText(name, { exact: true }) });
}

test('finds a parent by its title, closed or not, and starts each time without the search', async ({ context, page }) => {
    await mockBackend(context, notes(`.tasks/${MOVED}.md`), TIMES);
    let dialog = await openPicker(page, MOVED);
    await dialog.getByRole('textbox', { name: 'Search tasks' }).fill('step');
    await expect(rows(dialog)).toHaveText(['Project', 'Dropped step', 'Old step']);
    await expect(dialog.locator('mark')).toHaveText(['step', 'step']);
    await dialog.getByRole('treeitem', { name: 'Old step' }).click();
    await expect(dialog.locator('.v-list-item--active')).toContainText('Old step');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    dialog = await openPicker(page, MOVED);
    await expect(dialog.getByRole('textbox', { name: 'Search tasks' })).toHaveValue('');
    await expect(rows(dialog)).toHaveText(['Project', 'Draft', 'Show 2 closed', 'Show 1 closed']);
});

// A search opens every branch it keeps, and the tree it gives back opens only the roots: the row
// chosen from a branch it opened stays drawn once it is cleared, or the button would move the task
// under a parent nowhere to be seen.
test('keeps the parent found by a search drawn once the search is cleared', async ({ context, page }) => {
    await mockBackend(context, {
        ...notes(`.tasks/${MOVED}.md`),
        [`.tasks/${PROJECT}/${uuid(2)}/${uuid(7)}.md`]: note('Outline', 'todo'),
    }, TIMES);
    const dialog = await openPicker(page, MOVED);
    await expect(rows(dialog)).toHaveText(['Project', 'Draft', 'Show 2 closed', 'Show 1 closed']);
    const search = dialog.getByRole('textbox', { name: 'Search tasks' });
    await search.fill('outline');
    await expect(rows(dialog)).toHaveText(['Project', 'Draft', 'Outline']);
    await dialog.getByRole('treeitem', { name: 'Outline' }).click();

    await search.fill('');
    await expect(dialog.locator('mark')).toHaveCount(0);
    await settled(dialog);
    await expect(rows(dialog)).toHaveText(['Project', 'Draft', 'Outline', 'Show 2 closed', 'Show 1 closed']);
    await expect(dialog.locator('.v-list-item--active')).toContainText('Outline');
});

test('names the parent chosen beside the button, though the tree leaves its row out', async ({ context, page }) => {
    await mockBackend(context, notes(`.tasks/${PROJECT}/${uuid(2)}/${MOVED}.md`), TIMES);
    const dialog = await openPicker(page, MOVED);
    const chosen = dialog.locator('.chosen-parent');
    await expect(chosen).toHaveText('Under: Draft');
    await expect(chosen).toHaveAttribute('title', 'Project › Draft');

    await dialog.getByRole('textbox', { name: 'Search tasks' }).fill('finished');
    await expect(rows(dialog)).toHaveText(['Finished']);
    await expect(chosen).toHaveText('Under: Draft');
    await dialog.getByRole('treeitem', { name: 'Finished' }).click();
    await expect(chosen).toHaveText('Under: Finished');

    await dialog.getByText('Root (No Parent)').click();
    await expect(chosen).toHaveText('Under: Root');
    await expect(chosen).toHaveAttribute('title', 'Root (No Parent)');
    await expect(dialog.getByRole('button', { name: 'Move Here' })).toHaveAccessibleDescription('Under: Root');
});

// Taken by a sync while the dialog is open, it could not be placed under, and the label would name
// a task the tree no longer holds.
test('gives way to the root when the parent chosen is gone', async ({ context, page }) => {
    await mockBackend(context, notes(`.tasks/${MOVED}.md`), TIMES);
    const dialog = await openPicker(page, MOVED);
    await dialog.getByRole('treeitem', { name: 'Draft' }).click();
    const chosen = dialog.locator('.chosen-parent');
    await expect(chosen).toHaveText('Under: Draft');

    // Deleted as from another device, and synced as the view does on coming back to the window.
    await page.evaluate(async (url) => {
        await fetch(url, { method: 'DELETE' });
        window.dispatchEvent(new Event('focus'));
    }, `${API_URL}notes/.tasks/${PROJECT}/${uuid(2)}.md`);
    await expect(dialog.getByRole('treeitem', { name: 'Draft' })).toHaveCount(0);
    await expect(chosen).toHaveText('Under: Root');
    // Where the task is already.
    await expect(dialog.getByRole('button', { name: 'Move Here' })).toBeDisabled();
});

test('leaves out the statuses it is told to, apart from the task tree', async ({ context, page }) => {
    await mockBackend(context, notes(`.tasks/${MOVED}.md`), TIMES);
    const dialog = await openPicker(page, MOVED);
    await dialog.getByRole('button', { name: 'Choose which statuses are shown' }).click();
    await status(page, 'Closed').click();
    await expect(rows(dialog)).toHaveText(['Project', 'Draft']);
    await status(page, 'To do').click();
    await status(page, 'In progress').click();
    await expect(rows(dialog)).toHaveCount(0);
    await expect(dialog).toContainText('No tasks match.');
    // The root is no task, and is still there to choose.
    await expect(dialog.getByText('Root (No Parent)')).toBeVisible();
    await page.keyboard.press('Escape');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    // Each is read where it is kept as the page loads: until then, the tree would hold what it
    // read before, kept apart or not.
    await page.reload();
    const tree = page.locator('.task-tree-container');
    await expect(tree.getByRole('treeitem').locator('.v-list-item-title')).toHaveText(['Project', 'Moved', 'Show 1 closed']);
    await expect(tree.getByRole('button', { name: 'Choose which statuses are shown' })).toHaveAccessibleName('Choose which statuses are shown');
    await page.getByRole('button', { name: 'Change Parent' }).click();
    await expect(dialog).toContainText('No tasks match.');
});

// The editor's picker stays in the page while a new task's comes and goes, and each starts from
// the statuses the last one left, whichever that was.
test('leaves out what the last picker left out', async ({ context, page }) => {
    await mockBackend(context, notes(`.tasks/${MOVED}.md`), TIMES);
    let dialog = await openPicker(page, MOVED);
    await dialog.getByRole('button', { name: 'Choose which statuses are shown' }).click();
    await status(page, 'Closed').click();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    const editor = page.getByRole('dialog').filter({ has: page.locator('.task-editor-next') });
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toBeHidden();

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.getByRole('button', { name: 'Choose Parent' }).click();
    const chooser = page.getByRole('dialog').filter({ hasText: 'Select a parent for the new task' });
    await expect(rows(chooser)).toHaveText(['Project', 'Draft', 'Moved']);
    await chooser.getByRole('button', { name: /^Choose which statuses are shown/ }).click();
    await status(page, 'Show all').click();
    await expect(rows(chooser)).toHaveText(['Project', 'Draft', 'Show 2 closed', 'Moved', 'Show 1 closed']);
    await page.keyboard.press('Escape');
    await chooser.getByRole('button', { name: 'Cancel' }).click();
    await expect(chooser).toBeHidden();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toBeHidden();

    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Change Parent' }).click();
    dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Move Here' }) });
    await expect(rows(dialog)).toHaveText(['Project', 'Draft', 'Show 2 closed', 'Show 1 closed']);
    await expect(dialog.getByRole('button', { name: /^Choose which statuses are shown/ })).toHaveAccessibleName('Choose which statuses are shown');
});

// The tree is drawn at one height, but a phone's window has no room for it with the rest: it gives
// up what it must, rather than the buttons going off the bottom of a dialog that does not scroll.
// Under a parent whose title is longer than the actions have room for.
test('keeps its buttons in a window too short and narrow for the whole tree', async ({ context, page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await mockBackend(context, {
        ...notes(`.tasks/${PROJECT}/${uuid(2)}/${MOVED}.md`),
        [`.tasks/${PROJECT}/${uuid(2)}.md`]: note('Draft the chapter on how the whole thing began', 'in_progress'),
    }, TIMES);
    const dialog = await openPicker(page, MOVED);
    // Where it settles, as it scales in from a size that fits.
    await expect.poll(() => dialog.locator('.v-overlay__content').evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect(dialog.getByRole('button', { name: 'Move Here' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('treeitem', { name: 'Project' })).toBeInViewport({ ratio: 1 });
    // Cut short, beside the buttons rather than over them.
    const chosen = dialog.locator('.chosen-parent');
    expect(await chosen.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const label = await chosen.boundingBox();
    const cancel = await dialog.getByRole('button', { name: 'Cancel' }).boundingBox();
    expect(label !== null && cancel !== null && label.x + label.width <= cancel.x).toBe(true);
});
