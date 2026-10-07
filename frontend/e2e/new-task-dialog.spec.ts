import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { API_URL, mockBackend, uuid } from './backend';

const PROJECT = uuid(1);

const NOTES = {
    'projects/plan.md': '# Plan\n',
    [`.tasks/${PROJECT}.md`]: '---\ntask:\n    status: {kind: todo}\n---\n\n# Project\n',
};

const TASK = /^\.tasks\/[0-9a-f-]{36}\.md$/;

// The editor's dialog, told apart from the parent picker that opens over it.
function dialog(page: Page): Locator {
    return page.getByRole('dialog').filter({ has: page.locator('.task-editor-next') });
}

function picker(page: Page): Locator {
    return page.getByRole('dialog').filter({ hasText: 'Select a parent for the new task' });
}

async function chooseParent(page: Page, choose: (picker: Locator) => Promise<void>) {
    await dialog(page).getByRole('button', { name: 'Choose Parent' }).click();
    await choose(picker(page));
    await picker(page).getByRole('button', { name: 'Choose', exact: true }).click();
    await expect(picker(page)).toBeHidden();
}

function title(page: Page): Locator {
    return dialog(page).getByRole('textbox', { name: 'Title', exact: true });
}

async function openNewTask(page: Page) {
    await page.getByRole('listitem').filter({ hasText: /^Add$/ }).first().click();
    await page.locator('.v-menu').getByText('New task', { exact: true }).click();
    await expect(title(page)).toBeVisible();
}

// Over a note, whose view takes `e` to open its editor: the title is typed key by key, as a
// person types it, so the note would take every `e` if it still listened.
test('creates a task from the drawer without leaving the view', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto('/note/projects/plan.md');
    await openNewTask(page);
    await title(page).pressSequentially('Write the review');
    await expect(title(page)).toHaveValue('Write the review');

    await dialog(page).getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => repository.writes.filter((write) => TASK.test(write.path)).length).toBe(1);
    const created = repository.writes.find((write) => TASK.test(write.path))!;
    expect(created.content).toContain('Write the review');
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/note\/projects\/plan\.md$/);

    const snackbar = page.locator('.v-snackbar', { hasText: 'Task "Write the review" created successfully!' });
    await expect(snackbar).toBeVisible();
    await snackbar.getByRole('button', { name: 'Open' }).click();
    const uuid = created.path.slice('.tasks/'.length, -'.md'.length);
    await expect(page).toHaveURL(new RegExp(`/tasks-next/${uuid}/selected/status$`));
});

test('closes on Escape until something is typed, and then only on Cancel', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto('/');
    await openNewTask(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();

    await openNewTask(page);
    await title(page).fill('Draft');
    await page.keyboard.press('Escape');
    await expect(title(page)).toHaveValue('Draft');
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog(page)).toBeHidden();
});

// A save takes a moment, and a draft opened while it runs is not the one it was for.
test('leaves a draft opened during an earlier save open when that save ends', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    // Holds each write back, as a slow connection would, before the mock backend takes it.
    await page.route(`${API_URL}notes/**`, async (route) => {
        if (route.request().method() === 'PUT') {
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        await route.fallback();
    });
    await page.goto('/');
    await openNewTask(page);
    await title(page).fill('First');
    await dialog(page).getByRole('button', { name: 'Create', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog(page)).toBeHidden();

    await openNewTask(page);
    await title(page).fill('Second');
    await expect(page.locator('.v-snackbar', { hasText: 'Task "First" created successfully!' })).toBeVisible();
    // Past the dialog's closing transition, which would keep the field in the page for a moment
    // even if the save had closed it.
    await page.waitForTimeout(1000);
    await expect(dialog(page)).toBeVisible();
    await expect(title(page)).toHaveValue('Second');
});

test('creates the task under the parent chosen for it', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto('/');
    await openNewTask(page);
    await title(page).fill('Subtask');

    await chooseParent(page, async (parents) => {
        // It starts at the root, where the drawer puts a task, so choosing that again is no choice.
        await expect(parents.getByRole('button', { name: 'Choose', exact: true })).toBeDisabled();
        await parents.getByRole('treeitem', { name: 'Project' }).click();
    });
    await expect(dialog(page).locator('.editor-title')).toHaveText('New subtask of "Project"');

    // Back to the root, from the parent chosen last.
    await chooseParent(page, async (parents) => {
        await expect(parents.locator('.v-list-item--active')).toContainText('Project');
        await parents.getByText('Root (No Parent)').click();
    });
    await expect(dialog(page).locator('.editor-title')).toHaveText('New task');

    await chooseParent(page, (parents) => parents.getByRole('treeitem', { name: 'Project' }).click());
    await expect(title(page)).toHaveValue('Subtask');
    await dialog(page).getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => repository.writes.map((write) => write.path))
        .toEqual([expect.stringMatching(new RegExp(`^\\.tasks/${PROJECT}/[0-9a-f-]{36}\\.md$`))]);
});

// The assessment's menu is drawn outside the dialog, whose focus trap took Tab from the menu back
// to the dialog's first button. The menu keeps its own, so its suggestions can be reached and
// added from the keyboard.
test('adds an assessment suggestion to the note from the keyboard', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.route(`${API_URL}v2/assess-task`, (route) => route.fulfill({
        json: { quality_score: 6, feedback: '', suggestions: [], note_suggestions: ['## Scope'] },
    }));
    await page.goto('/note/projects/plan.md');
    await openNewTask(page);
    await title(page).fill('Write the review');
    const chip = dialog(page).getByRole('button', { name: 'Task assessment: 6.0 out of 10' });
    await chip.focus();
    await page.keyboard.press('Enter');
    const add = page.locator('.assessment').getByRole('button', { name: 'Add to note' });
    await expect(add).toBeVisible();
    // The stars above it are read-only, and take no Tab.
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog(page).locator('.cm-content')).toHaveText('## Scope');
});
