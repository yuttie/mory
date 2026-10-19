import { expect, test } from '@playwright/test';
import { mockBackend, uuid } from './backend';

const PROJECT = uuid(1);

// Typed key by key, as a person types: a shortcut listens for `keydown`, which `fill` never sends.
test('types a slash into the Files search rather than jumping to it', async ({ context, page }) => {
    await mockBackend(context, { 'projects/plan.md': '# Plan\n' });
    await page.goto('/files');
    const search = page.getByRole('textbox', { name: 'Search' });
    await search.click();
    await search.pressSequentially('projects/plan');
    await expect(search).toHaveValue('projects/plan');
});

// A dialog over a note keeps every key from it, wherever the focus is. The parent picker, closed
// over a new task's editor, leaves the focus on the page rather than in the editor beneath it: the
// note took Ctrl+S from there, and saved its own edit along with the task.
test('leaves a note unsaved under a task created with Ctrl+S', async ({ context, page }) => {
    const repository = await mockBackend(context, {
        'projects/plan.md': '# Plan\n',
        [`.tasks/${PROJECT}.md`]: '---\ntask:\n    status: {kind: todo}\n---\n\n# Project\n',
    });
    await page.goto('/note/projects/plan.md');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Editor and viewer' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.type('More text.');

    await page.getByRole('listitem').filter({ hasText: /^Add$/ }).first().click();
    await page.locator('.v-menu').getByText('New task', { exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('.task-editor-next') });
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Write the review');
    const picker = page.getByRole('dialog').filter({ hasText: 'Select a parent for the new task' });
    await dialog.getByRole('button', { name: 'Choose Parent' }).click();
    await picker.getByRole('treeitem', { name: 'Project' }).click();
    await picker.getByRole('button', { name: 'Choose', exact: true }).click();
    await expect(picker).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);

    await page.keyboard.press('Control+s');
    await expect(dialog).toBeHidden();
    // As long again as the note's save would take, had it started with the task's.
    await page.waitForTimeout(500);
    expect(repository.writes.map(({ path }) => path)).toEqual([expect.stringMatching(new RegExp(`^\\.tasks/${PROJECT}/[0-9a-f-]{36}\\.md$`))]);
});
