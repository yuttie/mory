import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend } from './backend';

const NOTES = {
    'projects/plan.md': '# Plan\n',
    'projects/other.md': '# Other\n',
};

function leaveDialog(page: Page): Locator {
    return page.getByRole('dialog').filter({ hasText: 'Leave without saving?' });
}

function editor(page: Page): Locator {
    return page.locator('.cm-content');
}

// Opened, and ready for Escape: Vuetify answers it only once the dialog is the top overlay, which
// it learns in a timer after opening. A second opening in Chromium can have finished scaling in
// before that timer runs, so the end of the animation is no proof, and the overlay is asked.
async function asked(page: Page): Promise<void> {
    await expect(leaveDialog(page)).toBeVisible();
    await expect.poll(() => leaveDialog(page).evaluate((element) => {
        type Instance = { type: { name?: string }, parent: Instance | null, proxy: { globalTop?: boolean } };
        let instance = (element as unknown as { __vueParentComponent?: Instance }).__vueParentComponent ?? null;
        while (instance !== null && instance.type.name !== 'VOverlay') {
            instance = instance.parent;
        }
        return instance?.proxy.globalTop === true;
    })).toBe(true);
}

// A move within the app, as a link in the note would make, rather than a load of the page.
async function push(page: Page, path: string): Promise<void> {
    await page.evaluate((to) => {
        const app = document.querySelector('#app') as unknown as {
            __vue_app__: { config: { globalProperties: { $router: { push: (to: string) => Promise<unknown> } } } },
        };
        void app.__vue_app__.config.globalProperties.$router.push(to);
    }, path);
}

// The note open in its editor with a line typed into it and not saved. Typed only once the load is
// over, which would otherwise put the note back over the keys.
async function edit(page: Page): Promise<void> {
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await page.keyboard.press('e');
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('Unsaved line.');
}

async function openAndEdit(page: Page): Promise<void> {
    await page.goto('/note/projects/plan.md');
    await edit(page);
}

// Long enough for a navigation nobody stopped to have landed, and for a dialog to have shown.
async function settle(page: Page): Promise<void> {
    await page.waitForTimeout(500);
}

test('asks before leaving a note with unsaved edits for another view', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await openAndEdit(page);

    await page.getByRole('link', { name: 'Files' }).click();

    await asked(page);
    await expect(page).toHaveURL(/\/note\/projects\/plan\.md$/);
    await expect(leaveDialog(page).getByRole('button', { name: 'Stay' })).toBeFocused();
});

test('stays with the edit when the reader declines', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await openAndEdit(page);
    const link = page.getByRole('link', { name: 'Files' });

    await link.click();
    await asked(page);
    await leaveDialog(page).getByRole('button', { name: 'Stay' }).click();
    await expect(leaveDialog(page)).toBeHidden();
    await settle(page);

    await expect(page).toHaveURL(/\/note\/projects\/plan\.md$/);
    await expect(editor(page)).toContainText('Unsaved line.');
    await expect(page.getByRole('button', { name: 'Save' })).not.toHaveClass(/v-icon-btn--disabled/);
    // Back where it was, rather than nowhere.
    await expect(link).toBeFocused();

    // Escape keeps it as Stay does.
    await link.click();
    await asked(page);
    await page.keyboard.press('Escape');
    await expect(leaveDialog(page)).toBeHidden();
    await settle(page);
    await expect(page).toHaveURL(/\/note\/projects\/plan\.md$/);
    await expect(editor(page)).toContainText('Unsaved line.');
});

test('leaves without saving when the reader accepts', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openAndEdit(page);

    await page.getByRole('link', { name: 'Files' }).click();
    await asked(page);
    await leaveDialog(page).getByRole('button', { name: 'Leave' }).click();

    await expect(page).toHaveURL(/\/files$/);
    expect(repository.writes).toEqual([]);
});

// The view is reused for the other note, so this goes through the update guard, not the leave one.
test('asks before moving to another note, and loads it once accepted', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await openAndEdit(page);

    await push(page, '/note/projects/other.md');
    await asked(page);
    await expect(page).toHaveURL(/\/note\/projects\/plan\.md$/);

    await leaveDialog(page).getByRole('button', { name: 'Leave' }).click();
    await expect(page).toHaveURL(/\/note\/projects\/other\.md$/);
    await expect(page.getByRole('heading', { name: 'Other' })).toBeVisible();
    await expect(editor(page)).not.toContainText('Unsaved line.');
});

test('asks before going back, and stays on the note when declined', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/files');
    await expect(page.getByRole('progressbar')).toBeHidden();
    await push(page, '/note/projects/plan.md');
    await edit(page);

    await page.evaluate(() => history.back());
    await asked(page);
    await page.keyboard.press('Enter');
    await expect(leaveDialog(page)).toBeHidden();
    await settle(page);

    await expect(page).toHaveURL(/\/note\/projects\/plan\.md$/);
    await expect(editor(page)).toContainText('Unsaved line.');
    await expect(editor(page)).toBeFocused();
});

// Back has moved the address already when the question opens. A second Back is refused, and the
// reader stays as with Stay, rather than being asked about it instead: the move first asked about
// could no longer land, and either answer then left the address on one page and the view on another.
test('stays on the note when Back is pressed again while asking', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/files');
    await expect(page.getByRole('progressbar')).toBeHidden();
    await push(page, '/note/projects/other.md');
    await expect(page.getByRole('heading', { name: 'Other' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await push(page, '/note/projects/plan.md');
    await edit(page);

    await page.evaluate(() => history.back());
    await asked(page);
    await page.evaluate(() => history.back());
    await expect(leaveDialog(page)).toBeHidden();
    await settle(page);
    await expect(page).toHaveURL(/\/note\/projects\/plan\.md$/);
    await expect(editor(page)).toContainText('Unsaved line.');
    await expect(editor(page)).toBeFocused();

    // The history is as it was: Back asks again, and leaving lands on the page before the note.
    await page.evaluate(() => history.back());
    await asked(page);
    await leaveDialog(page).getByRole('button', { name: 'Leave' }).click();
    await expect(page).toHaveURL(/\/note\/projects\/other\.md$/);
    await expect(page.getByRole('heading', { name: 'Other' })).toBeVisible();
});

// Forward back to the note, from the page Back is asking about, is refused as well, and its address
// put back before the one Back moved: put back together, the second ran past the end of the history
// and stayed on the page before.
test('stays on the note when Forward is pressed while asking', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/files');
    await expect(page.getByRole('progressbar')).toBeHidden();
    await push(page, '/note/projects/plan.md');
    await edit(page);

    await page.evaluate(() => history.back());
    await asked(page);
    await page.evaluate(() => history.forward());
    await expect(leaveDialog(page)).toBeHidden();
    await settle(page);

    await expect(page).toHaveURL(/\/note\/projects\/plan\.md$/);
    await expect(editor(page)).toContainText('Unsaved line.');
    await page.evaluate(() => history.back());
    await asked(page);
    await leaveDialog(page).getByRole('button', { name: 'Leave' }).click();
    await expect(page).toHaveURL(/\/files$/);
});

test('does not ask when nothing is unsaved', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/note/projects/plan.md');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeHidden();

    await page.getByRole('link', { name: 'Files' }).click();

    await expect(page).toHaveURL(/\/files$/);
    await expect(leaveDialog(page)).toHaveCount(0);
});

test('does not ask once the edit is saved', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openAndEdit(page);
    await page.keyboard.press('Control+s');
    await expect.poll(() => repository.writes.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Save' })).toHaveClass(/v-icon-btn--disabled/);

    await page.getByRole('link', { name: 'Files' }).click();

    await expect(page).toHaveURL(/\/files$/);
    await expect(leaveDialog(page)).toHaveCount(0);
});

// The save drops `mode=create` from the address, which is the view's own doing, and goes through
// even while the reader is asked about leaving, as they are when they moved before it finished: a
// reload would start the saved note afresh otherwise.
test('drops the new note\'s mode from the address once saved, even while asking', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    let finishSave: (() => void) | undefined;
    const saveHeld = new Promise<void>((resolve) => {
        finishSave = resolve;
    });
    await page.route('**/api/notes/**', async (route) => {
        if (route.request().method() === 'PUT') {
            await saveHeld;
        }
        await route.fallback();
    });
    await page.goto('/create');
    await expect(page).toHaveURL(/mode=create/);
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nA new note.');
    const saving = page.waitForRequest((request) => request.method() === 'PUT');
    await page.keyboard.press('Control+s');
    await saving;

    await page.getByRole('link', { name: 'Files' }).click();
    await asked(page);
    finishSave?.();
    await expect.poll(() => repository.writes.length).toBe(1);
    await expect(page).not.toHaveURL(/mode=create/);

    await leaveDialog(page).getByRole('button', { name: 'Stay' }).click();
    await expect(leaveDialog(page)).toBeHidden();
    await settle(page);
    await expect(page).toHaveURL(/\/note\/[^?]*$/);
    await expect(editor(page)).toContainText('A new note.');
});

// Where in the note the address points is no move away from it.
test('does not ask when only the place in the note changes', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await openAndEdit(page);

    await push(page, '/note/projects/plan.md#plan');

    await expect(page).toHaveURL(/\/note\/projects\/plan\.md#plan$/);
    await settle(page);
    await expect(leaveDialog(page)).toHaveCount(0);
    await expect(editor(page)).toContainText('Unsaved line.');
});

// A rename takes the edit along to the new path rather than leaving it behind.
test('does not ask when renaming a note with unsaved edits', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openAndEdit(page);

    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('New path').fill('projects/renamed.md');
    await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();

    await expect(page).toHaveURL(/\/note\/projects\/renamed\.md$/);
    expect(repository.renames).toEqual([{ from: 'projects/plan.md', to: 'projects/renamed.md' }]);
    await settle(page);
    await expect(leaveDialog(page)).toHaveCount(0);
    await expect(editor(page)).toContainText('Unsaved line.');
});
