import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

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
