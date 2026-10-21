import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

function note(title: string, { tags = [], status = 'todo' }: { tags?: string[]; status?: string } = {}): string {
    return [
        '---',
        'task:',
        '  status:',
        `    kind: ${status}`,
        ...(tags.length > 0 ? [`tags: [${tags.join(', ')}]`] : []),
        '---',
        '',
        `# ${title}`,
        '',
    ].join('\n');
}

const LAUNCH = uuid(1);
const SHIP = uuid(3);

// Launch holds Ship, which holds the release's two steps; the childless ones are filed under the
// groups their tags make.
const NOTES = {
    [`.tasks/${LAUNCH}.md`]: note('Launch'),
    [`.tasks/${LAUNCH}/${uuid(2)}.md`]: note('Write the announcement'),
    [`.tasks/${LAUNCH}/${SHIP}.md`]: note('Ship'),
    [`.tasks/${LAUNCH}/${SHIP}/${uuid(4)}.md`]: note('Build the release'),
    [`.tasks/${LAUNCH}/${SHIP}/${uuid(5)}.md`]: note('Write release notes', { status: 'done' }),
    [`.tasks/${uuid(6)}.md`]: note('Water the plants', { tags: ['home'] }),
    [`.tasks/${uuid(7)}.md`]: note('Plan the release party', { tags: ['home'] }),
};

function tree(page: Page): Locator {
    return page.locator('.task-tree-container');
}

function row(page: Page, name: string): Locator {
    return tree(page).getByRole('treeitem', { name });
}

// The titles of the rows drawn, without the progress a row with subtasks shows beside its own.
function rows(page: Page): Locator {
    return tree(page).getByRole('treeitem').locator('.v-list-item-title');
}

// Until a branch just opened has grown to its height, it clips the rows in it: Playwright scrolls
// the branch to reach one, and as it grows it scrolls back, moving the row. A press there and its
// release can then fall on different rows, and click neither: Firefox on the workflow's runner took
// about 100ms to 160ms to click, in which the row moved by up to 31px. Settled once no transition
// is under way, which Vue marks from its start, as the animation begins only a frame later, and
// once the tree's own animations are over: the search field above it holds a loader whose
// animation is only ever paused.
async function settled(page: Page): Promise<void> {
    await expect.poll(() => tree(page).locator('.entry-tree').evaluate((element) => (
        element.querySelector('[class*="enter-active"], [class*="leave-active"]') === null
        && element.getAnimations({ subtree: true }).length === 0
    )), { intervals: [50] }).toBe(true);
}

async function toggle(page: Page, name: string): Promise<void> {
    await settled(page);
    await row(page, name).locator('.v-list-item__prepend button').click();
}

// Where `locator` is drawn. Throws rather than let a missing element compare equal to another.
async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const found = await locator.boundingBox();
    if (found === null) {
        throw new Error(`Not drawn: ${locator}`);
    }
    return found;
}

async function moveOver(page: Page, target: Locator): Promise<void> {
    const { x, y, width, height } = await box(target);
    await page.mouse.move(x + width / 2, y + height / 2, { steps: 5 });
}

// Drags `task` onto `target` and lets go, as `task-tree-move.spec.ts` does.
async function drop(page: Page, task: Locator, target: Locator): Promise<void> {
    await task.click({ trial: true });
    await moveOver(page, task);
    await page.mouse.down();
    const { x, y } = await box(task);
    await page.mouse.move(x + 20, y + 30, { steps: 3 });
    await expect(page.locator('.entry-tree-drag-copy')).toBeVisible();
    await moveOver(page, target);
    await page.mouse.up();
}

function search(page: Page): Locator {
    return page.getByRole('textbox', { name: 'Search tasks' });
}

function statuses(page: Page): Locator {
    return page.getByRole('button', { name: 'Choose which statuses are shown' });
}

// A row of the open status menu, by its title alone: a group's row names its statuses too, as
// "Done, Canceled".
function status(page: Page, name: string): Locator {
    return page.locator('.v-overlay--active .v-list-item').filter({ has: page.getByText(name, { exact: true }) });
}

function hiddenCount(page: Page): Locator {
    return statuses(page).getByRole('status');
}

test('finds tasks by title and opens the tasks above them', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next');
    await expect(rows(page)).toHaveText(['Launch', 'home']);

    await search(page).fill('RELEASE');
    await expect(rows(page)).toHaveText([
        'Launch',
        'Ship',
        'Build the release',
        'Write release notes',
        'home',
        'Plan the release party',
    ]);
    await expect(tree(page).locator('mark')).toHaveText(['release', 'release', 'release']);

    // Every word, wherever it is in the title.
    await search(page).fill('notes write');
    await expect(rows(page)).toHaveText(['Launch', 'Ship', 'Write release notes']);

    await search(page).fill('nothing like it');
    await expect(tree(page).getByRole('treeitem')).toHaveCount(0);
    await expect(tree(page)).toContainText('No tasks match.');
});

// Each search draws the tree anew, so it waits for typing to pause; clearing is one press. Time
// stands still from the first search on, so nothing happens that the test does not let happen, and
// from a search finding nothing, so no branch is left closing when it is cleared.
test('searches once typing pauses, and gives the tree back at once when cleared', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.clock.install();
    await page.goto('/tasks-next');
    await search(page).fill('nothing like it');
    await expect(tree(page)).toContainText('No tasks match.');
    await page.clock.pauseAt(Date.now() + 60_000);

    await search(page).fill('');
    await expect(rows(page)).toHaveText(['Launch', 'home']);

    await search(page).pressSequentially('build');
    await page.clock.runFor(249);
    await expect(rows(page)).toHaveText(['Launch', 'home']);
    await page.clock.runFor(1);
    await expect(rows(page)).toHaveText(['Launch', 'Ship', 'Build the release']);
});

// A row shown for what is under it is not marked, though its title may hold some of the words, or
// all of them under a status the tree hides.
test('marks the titles of the tasks found alone', async ({ context, page }) => {
    await mockBackend(context, {
        [`.tasks/${uuid(11)}.md`]: note('Release plan'),
        [`.tasks/${uuid(11)}/${uuid(12)}.md`]: note('Write release notes'),
        [`.tasks/${uuid(13)}.md`]: note('Release notes', { status: 'done' }),
        [`.tasks/${uuid(13)}/${uuid(14)}.md`]: note('Proofread the release notes'),
        [`.tasks/${uuid(15)}.md`]: note('Send the release notes', { tags: ['release'] }),
    });
    await page.addInitScript(() => {
        localStorage.setItem('task-tree-hidden-statuses', JSON.stringify(['done']));
    });
    await page.goto('/tasks-next');
    await search(page).fill('release notes');
    await expect(rows(page)).toHaveCount(6);
    // By the whole title: a mark holding "release" is text of its own.
    const marks = (name: string) => tree(page).getByRole('treeitem')
        .filter({ has: page.locator('.v-list-item-title', { hasText: new RegExp(`^\\s*${name}\\s*$`) }) })
        .locator('mark');
    for (const name of ['Write release notes', 'Proofread the release notes', 'Send the release notes']) {
        await expect(marks(name)).toHaveText(['release', 'notes']);
    }
    for (const name of ['Release plan', 'Release notes', 'release']) {
        await expect(marks(name)).toHaveCount(0);
    }
});

// A reading and its candidates are not what is searched for, however long one is dwelt on.
test('searches for the word an input method gives, not for what it composes', async ({ context, page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Composes through the DevTools protocol, which only Chromium speaks.');
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next');
    await expect(rows(page)).toHaveText(['Launch', 'home']);
    await search(page).focus();
    const devtools = await context.newCDPSession(page);
    await devtools.send('Input.imeSetComposition', { text: 'build', selectionStart: 5, selectionEnd: 5 });
    await expect(search(page)).toHaveValue('build');
    // Well past the pause after which typed text is searched for.
    await page.waitForTimeout(750);
    await expect(rows(page)).toHaveText(['Launch', 'home']);

    await devtools.send('Input.insertText', { text: 'build' });
    await expect(rows(page)).toHaveText(['Launch', 'Ship', 'Build the release']);
});

test('gives the tree back as it was once the search is cleared', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next');
    await toggle(page, 'home');
    await expect(rows(page)).toHaveText(['Launch', 'home', 'Water the plants', 'Plan the release party']);

    await search(page).fill('build');
    await expect(rows(page)).toHaveText(['Launch', 'Ship', 'Build the release']);
    // Closed while searching, which the tree it gives back does not remember.
    await toggle(page, 'Ship');
    await expect(rows(page)).toHaveText(['Launch', 'Ship']);

    await page.getByRole('button', { name: 'Clear Search tasks' }).click();
    await expect(search(page)).toHaveValue('');
    await expect(rows(page)).toHaveText(['Launch', 'home', 'Water the plants', 'Plan the release party']);
});

// What a new search finds is shown, though it keeps the branches the last one did.
test('opens again for a new search a branch closed during the last', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next');
    await search(page).fill('write');
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Write release notes']);
    await toggle(page, 'Ship');
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship']);

    await search(page).fill('writ');
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Write release notes']);
});

// The drop leaves the same branches holding what was found, so the search would not open them anew.
test('opens the task a drop moved during a search where it went', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto('/tasks-next/_/descendants/status');
    await search(page).fill('write');
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Write release notes']);
    await toggle(page, 'Ship');
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship']);
    await settled(page);

    await drop(page, row(page, 'Write the announcement'), row(page, 'Ship'));
    await expect.poll(() => repository.renames).toEqual([
        { from: `.tasks/${LAUNCH}/${uuid(2)}.md`, to: `.tasks/${LAUNCH}/${SHIP}/${uuid(2)}.md` },
    ]);
    await expect(row(page, 'Ship')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'Write the announcement')).toHaveAttribute('aria-level', '3');

    // And in the tree the search gives back.
    await page.getByRole('button', { name: 'Clear Search tasks' }).click();
    await expect(row(page, 'Write the announcement')).toHaveAttribute('aria-level', '3');
});

test('leaves out the tasks of the statuses unticked, and remembers them', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next');
    await toggle(page, 'Launch');
    await toggle(page, 'Ship');
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Build the release', 'Write release notes', 'home']);

    await statuses(page).click();
    await status(page, 'Done').click();
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Build the release', 'home']);
    await expect(hiddenCount(page)).toHaveText('1');
    await expect(hiddenCount(page)).toHaveAccessibleName('1 status hidden');
    await expect(statuses(page)).toHaveAccessibleName('Choose which statuses are shown, 1 status hidden');

    // Every task here is To do or Done.
    await status(page, 'To do').click();
    await expect(rows(page)).toHaveCount(0);
    await expect(tree(page)).toContainText('No tasks match.');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(tree(page)).toContainText('No tasks match.');
    await statuses(page).click();
    await status(page, 'Show all').click();
    // Closed, as the tree opens nothing of itself on a new page.
    await expect(rows(page)).toHaveText(['Launch', 'home']);
});

test('shows or hides a group of statuses at once', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/tasks-next');
    await toggle(page, 'Launch');
    await toggle(page, 'Ship');
    await statuses(page).click();
    const closed = status(page, 'Closed');

    // Its statuses named as well as drawn.
    await expect(closed).toContainText('Done, Canceled');
    await closed.click();
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Build the release', 'home']);
    await expect(hiddenCount(page)).toHaveText('2');
    await expect(statuses(page)).toHaveAccessibleName('Choose which statuses are shown, 2 statuses hidden');
    await expect(closed.getByRole('checkbox')).not.toBeChecked();
    await expect(status(page, 'Done').getByRole('checkbox')).not.toBeChecked();
    await expect(status(page, 'Canceled').getByRole('checkbox')).not.toBeChecked();
    // The groups apart.
    for (const name of ['Actionable', 'Stalled', 'Parked']) {
        await expect(status(page, name).getByRole('checkbox')).toBeChecked();
    }

    // Partly shown, a group is half ticked, and shown whole when chosen.
    await status(page, 'Done').click();
    await expect(closed.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed');
    await closed.click();
    await expect(closed.getByRole('checkbox')).toBeChecked();
    await expect(closed.getByRole('checkbox')).not.toHaveAttribute('aria-checked', 'mixed');
    await expect(hiddenCount(page)).toBeHidden();
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Build the release', 'Write release notes', 'home']);

    // To do is in a group as every status is, so the groups between them hide every task.
    await closed.click();
    await status(page, 'Actionable').click();
    await expect(tree(page)).toContainText('No tasks match.');
    await expect(hiddenCount(page)).toHaveText('4');
});

// The switch it replaced hid Done and Canceled.
test('starts from what the switch for completed tasks hid', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await context.addInitScript(() => {
        if (localStorage.getItem('task-tree-hidden-statuses') === null) {
            localStorage.setItem('hide-completed-in-tree-view', 'true');
        }
    });
    await page.goto('/tasks-next');
    await toggle(page, 'Launch');
    await toggle(page, 'Ship');
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Build the release', 'home']);
    await expect(hiddenCount(page)).toHaveText('2');
    expect(await page.evaluate(() => localStorage.getItem('hide-completed-in-tree-view'))).toBeNull();
});
