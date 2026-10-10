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
const PHASE = uuid(2);
const STEP = uuid(3);
// A second task with a child, so it stays at the top of the tree beside Project.
const OTHER = uuid(4);
const CHORE = uuid(5);
// A root task with no children, which the tree files under its tag.
const ERRAND = uuid(6);

const NOTES = {
    [`.tasks/${PROJECT}.md`]: note('Project'),
    [`.tasks/${PROJECT}/${PHASE}.md`]: note('Phase'),
    [`.tasks/${PROJECT}/${PHASE}/${STEP}.md`]: note('Step'),
    [`.tasks/${OTHER}.md`]: note('Other'),
    [`.tasks/${OTHER}/${CHORE}.md`]: note('Chore'),
    [`.tasks/${ERRAND}.md`]: note('Errand', { tags: ['work'] }),
};

function tree(page: Page): Locator {
    return page.locator('.task-tree-container');
}

function row(page: Page, name: string): Locator {
    return tree(page).getByRole('treeitem', { name });
}

// The copy of the dragged task that follows the pointer.
function copy(page: Page): Locator {
    return page.locator('.entry-tree-drag-copy');
}

// Where `locator` is drawn. Throws rather than let a missing element compare equal to another.
async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const found = await locator.boundingBox();
    if (found === null) {
        throw new Error(`Not drawn: ${locator}`);
    }
    return found;
}

// Moves the pointer over the middle of `target`.
async function moveOver(page: Page, target: Locator): Promise<void> {
    const { x, y, width, height } = await box(target);
    await page.mouse.move(x + width / 2, y + height / 2, { steps: 5 });
}

async function pickUp(page: Page, task: Locator): Promise<void> {
    // A branch just opened is still growing, and its rows move with it until it stops. Not checked
    // again during the drag: Playwright's check moves its own idea of the pointer, after which Chrome
    // sends no click on release, and the click the drag has to stop is never there to stop.
    await task.click({ trial: true });
    await moveOver(page, task);
    await page.mouse.down();
    const { x, y } = await box(task);
    await page.mouse.move(x + 20, y + 30, { steps: 3 });
    await expect(copy(page)).toBeVisible();
}

// The tree with Project and Phase open, and Other and the tag group closed. Nothing is selected: a
// selected task opens the tree to itself whenever it moves, which would hide what a drop opens.
async function openTree(page: Page): Promise<void> {
    await page.goto('/tasks-next/_/descendants/status');
    for (const name of ['Project', 'Phase']) {
        await row(page, name).locator('.v-list-item__prepend button').click();
    }
    await expect(row(page, 'Step')).toBeVisible();
}

test('moves a task, and everything under it, under the task it is dropped on', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openTree(page);

    await pickUp(page, row(page, 'Phase'));
    await expect(copy(page)).toContainText('Phase');
    await moveOver(page, row(page, 'Other'));
    await expect(row(page, 'Other')).toHaveCSS('outline-style', 'solid');
    await page.mouse.up();

    await expect.poll(() => repository.renames).toEqual([
        { from: `.tasks/${PROJECT}/${PHASE}.md`, to: `.tasks/${OTHER}/${PHASE}.md` },
        { from: `.tasks/${PROJECT}/${PHASE}/${STEP}.md`, to: `.tasks/${OTHER}/${PHASE}/${STEP}.md` },
    ]);
    await expect(copy(page)).toHaveCount(0);
    // Other is opened to show where the task went.
    await expect(row(page, 'Other')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'Phase')).toHaveAttribute('aria-level', '2');
    await expect(row(page, 'Other')).toHaveCSS('outline-style', 'none');
    expect(repository.writes).toEqual([]);
});

test('dims the tasks the dragged one cannot go under, and refuses a drop on them', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openTree(page);

    await pickUp(page, row(page, 'Phase'));
    // Itself, the task under it, and the parent it already has.
    for (const name of ['Phase', 'Step', 'Project']) {
        await expect(row(page, name)).toHaveClass(/tree-drop-refused/);
    }
    await expect(row(page, 'Other')).not.toHaveClass(/tree-drop-refused/);

    await moveOver(page, row(page, 'Step'));
    await expect(row(page, 'Step')).toHaveCSS('outline-style', 'none');
    await page.mouse.up();

    await expect(row(page, 'Step')).not.toHaveClass(/tree-drop-refused/);
    // Long enough for a move to have been asked for, were one going to be.
    await page.waitForTimeout(300);
    expect(repository.renames).toEqual([]);
});

test('opens nothing when the task is let go where it was picked up', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openTree(page);
    const url = page.url();

    await pickUp(page, row(page, 'Phase'));
    await moveOver(page, row(page, 'Phase'));
    await page.mouse.up();

    await expect(copy(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(page.url()).toBe(url);
    expect(repository.renames).toEqual([]);

    // The click after it is the user's own again.
    await row(page, 'Phase').click();
    await expect(page).toHaveURL(new RegExp(`/tasks-next/${PHASE}/selected/status$`));
});

test('puts the task back when Escape is pressed during the drag', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openTree(page);

    await pickUp(page, row(page, 'Phase'));
    await moveOver(page, row(page, 'Other'));
    await page.keyboard.press('Escape');
    await expect(copy(page)).toHaveCount(0);
    await expect(row(page, 'Other')).toHaveCSS('outline-style', 'none');
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(repository.renames).toEqual([]);
});

test('keeps the tasks a dragged one passes over from answering the pointer', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await openTree(page);
    const other = row(page, 'Other');
    const add = other.getByRole('button', { name: 'Add child task', includeHidden: true });
    // The hover shade is the row's overlay, shown by its opacity.
    const shade = () => other.evaluate((element) => getComputedStyle(element.querySelector(':scope > .v-list-item__overlay')!).opacity);
    const resting = await shade();

    // At rest a row answers the pointer, which is what a drag must not look like.
    await other.hover();
    await expect(other).toHaveCSS('cursor', 'pointer');
    await expect.poll(shade).not.toBe(resting);
    await expect(add).toBeVisible();
    await page.mouse.move(0, 0);

    await pickUp(page, row(page, 'Phase'));
    await moveOver(page, other);
    await expect(other).not.toHaveCSS('cursor', 'pointer');
    await expect.poll(shade).toBe(resting);
    expect(await add.evaluate((element) => getComputedStyle(element).visibility)).toBe('hidden');
    await page.mouse.up();
});

test('leaves the task being edited where it is while it has unsaved changes', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PHASE}/selected/status`);
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Phase one');

    // Moving the task above it would move it too.
    await pickUp(page, row(page, 'Project'));
    await moveOver(page, row(page, 'Other'));
    await page.mouse.up();

    await expect(page.locator('.v-snackbar')).toContainText('Save or discard the changes to "Phase" before moving "Project".');
    expect(repository.renames).toEqual([]);
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Phase one');

    // A task the edited one is not under still moves, under the edited one too.
    await pickUp(page, row(page, 'Other'));
    await moveOver(page, row(page, 'Phase'));
    await page.mouse.up();
    await expect.poll(() => repository.renames.map(({ from }) => from)).toEqual([
        `.tasks/${OTHER}.md`,
        `.tasks/${OTHER}/${CHORE}.md`,
    ]);
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Phase one');
});
