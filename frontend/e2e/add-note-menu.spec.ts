import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend } from './backend';

const NOTES = {
    'projects/plan.md': '# Plan\n',
    'meeting.template': '# Meeting\n',
    'plain.txt': 'text\n',
    '.events/party.md': '# Party\n',
};

// What the template's submenu links to. Found by address because the menu around it has items
// named alike, and a name alone would match one of those when the submenu is not open.
const NEW_NOTE = '/create?from=meeting.template';
const NEW_CHILD_NOTE = '/create?from=meeting.template&parent=projects/plan.md';
const EDIT = '/note/meeting.template';

// The note tree behind the menu links to the template as well, hence the name besides the address.
function item(page: Page, href: string, name: string): Locator {
    return page.locator(`a[href="${href}"]`).filter({ hasText: name });
}

function addNote(page: Page): Locator {
    return page.getByRole('listitem').filter({ hasText: 'Add note' }).first();
}

function template(page: Page): Locator {
    return page.getByRole('listitem').filter({ hasText: 'meeting' });
}

// Opens the drawer's Add note menu and then the template's submenu.
async function openTemplateMenu(page: Page) {
    await addNote(page).click();
    await template(page).hover();
}

test('offers New note and Edit for a template where no note is open', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/');
    await openTemplateMenu(page);
    await expect(item(page, NEW_NOTE, 'New note')).toBeVisible();
    await expect(item(page, EDIT, 'Edit')).toBeVisible();
    await expect(page.getByText('New child note')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit template' })).toHaveCount(0);
});

test('creates from a template under the open note', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/note/projects/plan.md');
    await openTemplateMenu(page);
    // The note view takes the template parameter away once it has loaded the template, so the
    // address afterwards shows only the new path, and the note shows what the template held.
    await item(page, NEW_CHILD_NOTE, 'New child note').click();
    await expect(page).toHaveURL(/\/note\/projects\/plan\/[0-9a-f-]{36}\.md\?mode=create/);
    await expect(page.getByText('# Meeting').first()).toBeVisible();
});

test('creates from a template at the root', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/note/projects/plan.md');
    await openTemplateMenu(page);
    await item(page, NEW_NOTE, 'New note').click();
    await expect(page).toHaveURL(/\/note\/[0-9a-f-]{36}\.md\?mode=create/);
    await expect(page.getByText('# Meeting').first()).toBeVisible();
});

test('edits the template', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/note/projects/plan.md');
    await openTemplateMenu(page);
    await item(page, EDIT, 'Edit').click();
    await expect(page).toHaveURL(/\/note\/meeting\.template$/);
});

test('opens the submenu on a click, keeping the menu open', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/');
    await addNote(page).click();
    // Without hovering first, as a tap does. The click must not reach the menu around the row,
    // which closes on a click in its content.
    await template(page).click();
    await expect(item(page, EDIT, 'Edit')).toBeVisible();
    await expect(page.getByRole('link', { name: 'New note', exact: true }).first()).toBeVisible();
});

test('reaches a template and its submenu by keyboard', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/');
    // Opened from the keyboard, so that focus moves into the menu: a click leaves it on Add note.
    await addNote(page).focus();
    await page.keyboard.press('Enter');
    // Arrows walk the menu's items; a row the keyboard cannot focus is walked past for good.
    for (let steps = 0; steps < 6 && !(await template(page).evaluate((el) => el.contains(document.activeElement))); steps += 1) {
        await page.keyboard.press('ArrowDown');
    }
    await expect(template(page)).toBeFocused();
    // Opens the submenu with focus left on the row, and the next arrow goes into it.
    await page.keyboard.press('ArrowRight');
    await expect(item(page, EDIT, 'Edit')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(item(page, NEW_NOTE, 'New note')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item(page, EDIT, 'Edit')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/note\/meeting\.template$/);
});

test.describe('on a touch screen', () => {
    // `isMobile` is left out: Firefox has none. The narrow viewport is what puts the menu in the
    // drawer that slides over the view.
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test('taps through the drawer to a child note from a template', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto('/note/projects/plan.md');
        await page.locator('.v-app-bar-nav-icon').tap();
        await addNote(page).tap();
        await template(page).tap();
        await expect(item(page, NEW_CHILD_NOTE, 'New child note')).toBeVisible();
        await item(page, NEW_CHILD_NOTE, 'New child note').tap();
        await expect(page).toHaveURL(/\/note\/projects\/plan\/[0-9a-f-]{36}\.md\?mode=create/);
        // Moved off screen rather than removed, so it is the drawer's state that shows it closed.
        await expect(page.locator('.v-navigation-drawer--left')).not.toHaveClass(/v-navigation-drawer--active/);
    });
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
