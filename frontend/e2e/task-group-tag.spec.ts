import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import YAML from 'yaml';
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

function heading(page: Page): Locator {
    return page.locator('.task-editor-next .editor-title');
}

// A new task, started from the group of `tag` as the Add button starts one.
async function startInGroup(page: Page, tag: string) {
    await page.goto(`/tasks-next/tag-group-${tag}/descendants/status`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(tags(page)).toHaveText([tag]);
}

test('keeps a group\'s tag on a new task put under a task', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await startInGroup(page, 'work');
    await expect(heading(page)).toHaveText('New task with tag "work"');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft');

    await page.getByRole('button', { name: 'Choose Parent' }).click();
    const picker = page.getByRole('dialog').filter({ hasText: 'Select a parent for the new task' });
    await picker.getByRole('treeitem', { name: 'Project' }).click();
    await picker.getByRole('button', { name: 'Choose', exact: true }).click();
    await expect(heading(page)).toHaveText('New subtask of "Project"');
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Draft');
    await expect(tags(page)).toHaveText(['work']);

    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => repository.writes.map((write) => write.path))
        .toEqual([expect.stringMatching(new RegExp(`^\\.tasks/${PROJECT}/[0-9a-f-]{36}\\.md$`))]);
    expect(YAML.parse(repository.writes[0].content.split('---')[1]).tags).toEqual(['work']);
});

// A group's own button starts a task in that group, whatever is selected.
test('gives a task added from a group\'s row that group\'s tag, and none from Untagged', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);

    await row(page, 'home').hover();
    await row(page, 'home').getByRole('button', { name: 'Add task' }).click();
    await expect(heading(page)).toHaveText('New task with tag "home"');
    await expect(tags(page)).toHaveText(['home']);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(heading(page)).toBeHidden();

    await row(page, 'Untagged').hover();
    await row(page, 'Untagged').getByRole('button', { name: 'Add task' }).click();
    await expect(heading(page)).toHaveText('New task');
    await expect(tags(page)).toHaveCount(0);
});

// A group is only a heading for its tasks, so hiding the last of them hides the group too.
test('hides a group whose tasks are all hidden as completed', async ({ context, page }) => {
    await mockBackend(context, {
        ...NOTES,
        [`.tasks/${uuid(4)}.md`]: note('Chore', { tags: ['home'], status: 'done' }),
    });
    await page.goto('/tasks-next');
    await expect(row(page, 'home')).toBeVisible();

    // Hidden where the filter keeps it. A page gets no storage event for its own writes, hence the
    // reload.
    await page.evaluate(() => {
        localStorage.setItem('task-tree-hidden-statuses', JSON.stringify(['done', 'canceled']));
    });
    await page.reload();
    await expect(row(page, 'work')).toBeVisible();
    await expect(row(page, 'Untagged')).toBeVisible();
    await expect(row(page, 'home')).toHaveCount(0);
});

// The toolbar's outline starts in the selected group, whichever task the editor's went under.
test('quick adds from the toolbar in the selected group after the editor', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/tag-group-work/descendants/status?task=${uuid(3)}`);
    const outline = page.getByRole('dialog').filter({ hasText: 'Quick add tasks' });
    await page.locator('.task-editor-next').getByRole('button', { name: 'Quick Add' }).click();
    await expect(outline.getByRole('button', { name: 'Under: Errand' })).toBeVisible();
    await outline.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(outline).toBeHidden();
    await page.locator('.task-editor-next').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(heading(page)).toBeHidden();

    await page.locator('.item-view .v-toolbar').getByTitle('Quick add', { exact: true }).click();
    await expect(outline.getByRole('button', { name: 'Under: #work' })).toBeVisible();
    await outline.locator('.cm-content').click();
    await page.keyboard.insertText('Report');
    await outline.getByRole('button', { name: 'Add 1 task' }).click();
    await expect.poll(() => repository.writes.map((write) => write.path))
        .toEqual([expect.stringMatching(/^\.tasks\/[0-9a-f-]{36}\.md$/)]);
    expect(YAML.parse(repository.writes[0].content.split('---')[1]).tags).toEqual(['work']);
});
