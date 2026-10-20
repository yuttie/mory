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
    await expect(tree(page)).toContainText('No tasks match the search.');
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
