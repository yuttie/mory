import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockBackend } from './backend';

const NOTES = {
    'projects/plan.md': '# Plan\n',
    'meeting.template': '# Meeting\n',
    'plain.txt': 'text\n',
    '.events/party.md': '# Party\n',
};

// An item of the template's submenu, the last of its name since the menu above has its own.
function submenu(page: Page, name: RegExp) {
    return page.getByRole('link', { name }).last();
}

// Opens the drawer's Add note menu and then the template's submenu.
async function openTemplateMenu(page: Page) {
    await page.getByRole('listitem').filter({ hasText: 'Add note' }).first().click();
    await page.getByRole('listitem').filter({ hasText: 'meeting' }).hover();
}

test('offers New note and Edit for a template where no note is open', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/');
    await openTemplateMenu(page);
    await expect(submenu(page, /^New note$/)).toBeVisible();
    await expect(submenu(page, /^Edit$/)).toBeVisible();
    await expect(page.getByText('New child note')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit template' })).toHaveCount(0);
});

test('creates from a template under the open note', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/note/projects/plan.md');
    await openTemplateMenu(page);
    // The link says which template it creates from; the note view takes the parameter away once it
    // has loaded the template, so the address afterwards shows only the new path.
    await expect(submenu(page, /^New child note$/)).toHaveAttribute('href', '/create?from=meeting.template&parent=projects/plan.md');
    await submenu(page, /^New child note$/).click();
    await expect(page).toHaveURL(/\/note\/projects\/plan\/[0-9a-f-]{36}\.md\?mode=create/);
    await expect(page.getByText('# Meeting').first()).toBeVisible();
});

test('edits the template', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/note/projects/plan.md');
    await openTemplateMenu(page);
    await submenu(page, /^Edit$/).click();
    await expect(page).toHaveURL(/\/note\/meeting\.template$/);
});

// A child of these would not be listed under the note: the tree nests one only under a saved
// Markdown file outside the application's own directories.
for (const [name, address] of [
    ['a file that is not Markdown', '/note/plain.txt'],
    ['a note of the application\'s own', '/note/.events/party.md'],
    ['a note not saved yet', '/note/projects/draft.md?mode=create'],
]) {
    test(`offers no child note for ${name}`, async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto(address);
        await page.getByRole('listitem').filter({ hasText: 'Add note' }).first().click();
        await expect(page.getByRole('link', { name: 'New note', exact: true })).toBeVisible();
        await expect(page.getByText('New child note')).toHaveCount(0);
    });
}
