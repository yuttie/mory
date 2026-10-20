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

async function toggle(page: Page, name: string): Promise<void> {
    await row(page, name).locator('.v-list-item__prepend button').click();
}

function search(page: Page): Locator {
    return page.getByRole('textbox', { name: 'Search tasks' });
}

function statuses(page: Page): Locator {
    return page.getByRole('button', { name: 'Choose which statuses are shown' });
}

// A row of the open status menu, by its title alone: "Active" is in "Inactive" too.
function status(page: Page, name: string): Locator {
    return page.locator('.v-overlay--active .v-list-item').filter({ has: page.getByText(name, { exact: true }) });
}

function hiddenCount(page: Page): Locator {
    return statuses(page).getByRole('status', { name: 'Statuses hidden' });
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
    const completed = status(page, 'Completed');

    await completed.click();
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Build the release', 'home']);
    await expect(hiddenCount(page)).toHaveText('2');
    await expect(completed.getByRole('checkbox')).not.toBeChecked();
    await expect(status(page, 'Done').getByRole('checkbox')).not.toBeChecked();
    await expect(status(page, 'Canceled').getByRole('checkbox')).not.toBeChecked();
    // The groups apart.
    await expect(status(page, 'Active').getByRole('checkbox')).toBeChecked();
    await expect(status(page, 'Inactive').getByRole('checkbox')).toBeChecked();

    // Partly shown, a group is half ticked, and shown whole when chosen.
    await status(page, 'Done').click();
    await expect(completed.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed');
    await completed.click();
    await expect(completed.getByRole('checkbox')).toBeChecked();
    await expect(completed.getByRole('checkbox')).not.toHaveAttribute('aria-checked', 'mixed');
    await expect(hiddenCount(page)).toBeHidden();
    await expect(rows(page)).toHaveText(['Launch', 'Write the announcement', 'Ship', 'Build the release', 'Write release notes', 'home']);
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
