import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

function note(title: string, status: string): string {
    return ['---', 'task:', '  status:', `    kind: ${status}`, '---', '', `# ${title}`, ''].join('\n');
}

const PROJECT = uuid(1);
const FINISHED = uuid(9);
const DROPPED = uuid(10);

// Each status once at the top, and three under Project, which is To do itself with a step under
// way. Their UUIDs follow no order of their statuses, so a tree sorted by them alone fails.
const NOTES = {
    [`.tasks/${PROJECT}.md`]: note('Project', 'todo'),
    [`.tasks/${PROJECT}/${uuid(2)}.md`]: note('Plan', 'done'),
    [`.tasks/${PROJECT}/${uuid(3)}.md`]: note('Proofread', 'todo'),
    [`.tasks/${PROJECT}/${uuid(4)}.md`]: note('Draft', 'in_progress'),
    [`.tasks/${uuid(5)}.md`]: note('Someday', 'backlog'),
    [`.tasks/${uuid(6)}.md`]: note('Next up', 'todo'),
    [`.tasks/${uuid(7)}.md`]: note('Paused', 'on_hold'),
    [`.tasks/${uuid(8)}.md`]: note('Stuck', 'blocked'),
    [`.tasks/${FINISHED}.md`]: note('Finished', 'done'),
    [`.tasks/${DROPPED}.md`]: note('Dropped', 'canceled'),
    [`.tasks/${uuid(11)}.md`]: note('Awaiting a reply', 'waiting'),
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

test('draws the tasks under way first and the ones over with last, at every level', async ({ context, page }) => {
    await mockBackend(context, NOTES, {
        // Canceled after the other was done, so it comes first of the two.
        times: {
            [`.tasks/${FINISHED}.md`]: '2026-09-01T12:00:00+00:00',
            [`.tasks/${DROPPED}.md`]: '2026-09-02T12:00:00+00:00',
        },
    });
    await page.goto('/tasks-next/_/descendants/status');
    await expect(rows(page)).toHaveText([
        'Project',
        'Awaiting a reply',
        'Stuck',
        'Next up',
        'Paused',
        'Someday',
        'Dropped',
        'Finished',
    ]);

    await row(page, 'Project').locator('.v-list-item__prepend button').click();
    await expect(rows(page)).toHaveText([
        'Project',
        'Draft',
        'Proofread',
        'Plan',
        'Awaiting a reply',
        'Stuck',
        'Next up',
        'Paused',
        'Someday',
        'Dropped',
        'Finished',
    ]);
});

test('moves a task to its new place once its status is saved', async ({ context, page }) => {
    const second = uuid(2);
    const repository = await mockBackend(context, {
        [`.tasks/${uuid(1)}.md`]: note('First', 'todo'),
        [`.tasks/${second}.md`]: note('Second', 'todo'),
    });
    await page.goto(`/tasks-next/_/descendants/status?task=${second}`);
    await expect(rows(page)).toHaveText(['First', 'Second']);

    const editor = page.getByRole('dialog').filter({ has: page.locator('.task-editor-next') });
    // Not before Vuetify has moved the focus into the dialog, which takes it from the Status field.
    await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused();
    await editor.getByRole('combobox', { name: 'Status' }).press('Enter');
    await page.getByRole('option', { name: 'In progress', exact: true }).click();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => repository.writes.length).toBe(1);
    expect(repository.writes[0].content).toContain('kind: in_progress');
    await expect(rows(page)).toHaveText(['Second', 'First']);
});
