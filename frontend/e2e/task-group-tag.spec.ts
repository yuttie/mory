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

// Project has a child, so it stays at the top of the tree; the childless ones are filed under the
// groups their tags make, and Loose under Untagged.
const NOTES = {
    [`.tasks/${PROJECT}.md`]: note('Project'),
    [`.tasks/${PROJECT}/${uuid(2)}.md`]: note('Step'),
    [`.tasks/${uuid(3)}.md`]: note('Errand', { tags: ['work'] }),
    [`.tasks/${uuid(4)}.md`]: note('Chore', { tags: ['home'] }),
    [`.tasks/${uuid(5)}.md`]: note('Loose'),
};

function row(page: Page, name: string): Locator {
    return page.locator('.task-tree-container').getByRole('treeitem', { name });
}

function tags(page: Page): Locator {
    return page.locator('.task-editor-next .v-combobox .v-chip');
}

// A new task, started from the group of `tag` as the Add button starts one.
async function startInGroup(page: Page, tag: string) {
    await page.goto(`/tasks-next/tag-group-${tag}/descendants/status`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(tags(page)).toHaveText([tag]);
}

test('keeps a group\'s tag on a new task put under a task', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await startInGroup(page, 'work');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft');

    await row(page, 'Project').click();
    await expect(page).toHaveURL(new RegExp(`/tasks-next/${PROJECT}/selected/status$`));
    await expect(page.locator('.editor-title')).toHaveText('New subtask of "Project"');
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Draft');
    await expect(tags(page)).toHaveText(['work']);
});

// A group's tag is what files the task under it, so another group's replaces it.
test('swaps a group\'s tag for another group\'s, and drops it for Untagged', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await startInGroup(page, 'work');

    await row(page, 'home').click();
    await page.getByRole('tab', { name: 'New' }).click();
    await expect(tags(page)).toHaveText(['home']);

    await row(page, 'Untagged').click();
    await page.getByRole('tab', { name: 'New' }).click();
    await expect(tags(page)).toHaveCount(0);
});
