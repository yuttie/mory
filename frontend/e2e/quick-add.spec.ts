import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

const PROJECT = uuid(1);
const NOTES = {
    [`.tasks/${PROJECT}.md`]: ['---', 'task:', '  status:', '    kind: todo', '---', '', '# Project', ''].join('\n'),
};

function outline(page: Page): Locator {
    return page.getByRole('dialog').filter({ hasText: 'Quick add tasks' });
}

async function open(page: Page): Promise<void> {
    await page.locator('.item-view .v-toolbar').getByTitle('Quick add', { exact: true }).click();
    await expect(outline(page).getByRole('button', { name: 'Under: Project' })).toBeVisible();
}

// Which of the side pane's tabs is selected, and that its pane is the one shown.
async function showing(page: Page, name: 'Preview' | 'Syntax'): Promise<void> {
    const tab = outline(page).getByRole('tab', { name, exact: true });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(outline(page).getByRole('tabpanel', { name, exact: true })).toBeVisible();
}

// The syntax is there to look up before the first task is typed, and the preview takes over once
// one is, but only once: a tab picked after that stays, and what is typed still goes to the outline.
test('keeps the side pane on the tab picked while the outline is typed', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    await open(page);
    const editor = outline(page).locator('.cm-content');
    await showing(page, 'Syntax');

    await editor.click();
    await page.keyboard.type('- First');
    await showing(page, 'Preview');

    await outline(page).getByRole('tab', { name: 'Syntax', exact: true }).click();
    await page.keyboard.type(' task');
    await showing(page, 'Syntax');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('- First task');
    await expect(outline(page).getByRole('button', { name: 'Add 1 task' })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(outline(page).getByRole('button', { name: 'Add tasks' })).toBeDisabled();
    await page.keyboard.type('- Second');
    await expect(outline(page).getByRole('button', { name: 'Add 1 task' })).toBeVisible();
    await showing(page, 'Syntax');

    // Every opening is a new outline, which starts on the syntax again.
    await outline(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(outline(page)).toBeHidden();
    await open(page);
    await showing(page, 'Syntax');
    await expect(editor).toHaveText('');
    await editor.click();
    await page.keyboard.type('- Third');
    await showing(page, 'Preview');
});
