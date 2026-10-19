import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

const PROJECT = uuid(1);

const PROJECT_TASK = { [`.tasks/${PROJECT}.md`]: '---\ntask:\n    status: {kind: todo}\n---\n\n# Project\n' };

// Opens a new task's editor over the view, and leaves the focus on the page rather than in the
// editor: the parent picker, closed over it, returns the focus to neither.
async function leaveFocusUnderNewTask(page: Page): Promise<Locator> {
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
    return dialog;
}

async function cancel(dialog: Locator) {
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
}

// Typed key by key, as a person types: a shortcut listens for `keydown`, which `fill` never sends.
test('types a slash into the Files search rather than jumping to it', async ({ context, page }) => {
    await mockBackend(context, { 'projects/plan.md': '# Plan\n' });
    await page.goto('/files');
    const search = page.getByRole('textbox', { name: 'Search' });
    await search.click();
    await search.pressSequentially('projects/plan');
    await expect(search).toHaveValue('projects/plan');
});

// From the page, and from the note's own editor once it is open.
test('opens, saves and closes a note\'s editor from the keyboard', async ({ context, page }) => {
    const repository = await mockBackend(context, { 'projects/plan.md': '# Plan\n' });
    await page.goto('/note/projects/plan.md');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    // Loaded, which shows the viewer alone: an editor opened before then is closed again.
    await expect(page.getByRole('progressbar')).toBeHidden();
    const mode = (name: string) => page.getByRole('button', { name, exact: true });
    await page.keyboard.press('e');
    await expect(page.locator('.cm-content')).toBeFocused();
    await expect(mode('Editor and viewer')).toHaveClass(/v-btn--active/);

    await page.keyboard.type('More text.');
    await page.keyboard.press('Control+s');
    await expect.poll(() => repository.writes.map(({ path }) => path)).toEqual(['projects/plan.md']);
    expect(repository.writes[0].content).toContain('More text.');

    await page.keyboard.press('Shift+Enter');
    await expect(mode('Editor')).toHaveClass(/v-btn--active/);
    await page.keyboard.press('Control+Enter');
    await expect(mode('Viewer')).toHaveClass(/v-btn--active/);
});

// A dialog over a note keeps every key from it, wherever the focus is. The parent picker, closed
// over a new task's editor, leaves the focus on the page rather than in the editor beneath it: the
// note took Ctrl+S from there, and saved its own edit along with the task.
test('leaves a note unsaved under a task created with Ctrl+S', async ({ context, page }) => {
    const repository = await mockBackend(context, { 'projects/plan.md': '# Plan\n', ...PROJECT_TASK });
    await page.goto('/note/projects/plan.md');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Editor and viewer' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.type('More text.');

    const dialog = await leaveFocusUnderNewTask(page);
    await page.keyboard.press('Control+s');
    await expect(dialog).toBeHidden();
    // As long again as the note's save would take, had it started with the task's.
    await page.waitForTimeout(500);
    expect(repository.writes.map(({ path }) => path)).toEqual([expect.stringMatching(new RegExp(`^\\.tasks/${PROJECT}/[0-9a-f-]{36}\\.md$`))]);
});

// Each view's own shortcuts wait as the note's do, and work again once the dialog is gone.
for (const address of ['/files', '/search']) {
    test(`leaves the slash on ${address} to a dialog over it`, async ({ context, page }) => {
        await mockBackend(context, PROJECT_TASK);
        await page.goto(address);
        const search = page.getByRole('textbox', { name: 'Search' });
        await expect(search).toBeVisible();
        const dialog = await leaveFocusUnderNewTask(page);
        await page.keyboard.press('/');
        await expect(search).not.toBeFocused();

        await cancel(dialog);
        await page.keyboard.press('/');
        await expect(search).toBeFocused();
    });
}

test('leaves the arrows on the calendar to a dialog over it', async ({ context, page }) => {
    await mockBackend(context, PROJECT_TASK);
    await page.goto('/calendar/month/2026/10/07');
    const dialog = await leaveFocusUnderNewTask(page);
    await page.keyboard.press('ArrowRight');
    // Long enough after the arrow for its move to have ended, had it made one.
    await cancel(dialog);
    await expect(page).toHaveURL(/\/calendar\/month\/2026\/10\/07$/);

    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/calendar\/month\/2026\/11\/07$/);
});
