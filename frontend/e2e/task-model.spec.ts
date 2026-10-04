import { expect, test } from '@playwright/test';
import YAML from 'yaml';
import { mockBackend, uuid } from './backend';

test.use({ timezoneId: 'Asia/Tokyo' });

for (const hasTouch of [false, true]) {
    test.describe(hasTouch ? 'touch tree' : 'desktop tree', () => {
        test.use({ hasTouch });

        test('shows derived progress before pointing at the task', async ({ context, page }) => {
            const parent = uuid(1);
            await mockBackend(context, {
                [`.tasks/${parent}.md`]: '---\ntask: {status: {kind: todo}}\n---\n\n# Project\n',
                [`.tasks/${parent}/${uuid(2)}.md`]: '---\ntask: {status: {kind: done, completed_at: 2026-10-01 10:00:00+09:00}}\n---\n\n# Finished\n',
                [`.tasks/${parent}/${uuid(3)}.md`]: '---\ntask: {status: {kind: todo}}\n---\n\n# Open\n',
            });
            await page.goto('/tasks-next/_/descendants/status');
            const row = page.locator('.task-tree-container').getByRole('treeitem', { name: 'Project' });
            await expect(row.locator('.task-progress')).toHaveText('50%');
            await expect(row.locator('.task-progress')).toBeVisible();
            expect(await row.evaluate((element) => element.matches(':hover'))).toBe(false);
        });
    });
}

test('opens and saves a task carrying all revised date fields', async ({ context, page }) => {
    const id = uuid(8);
    const repository = await mockBackend(context, {
        [`.tasks/${id}.md`]: '---\ncreated_at: 2026-10-01 10:00:00+09:00\ntask:\n    status: {kind: todo}\n    importance: high\n    available_from: 2026-10-01\n    due_by: 2026-10-15 12:00:00+09:00\n    deadline: 2026-10-20\n    lead_time: 2w\n---\n\n# Dated task\n',
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/tasks-next/${id}/selected/status`);
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Dated task');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => repository.writes.length).toBe(1);
    expect(repository.writes[0].content).toContain('due_by: 2026-10-15 12:00:00+09:00');
    expect(repository.writes[0].content).toContain('available_from: 2026-10-01');
    expect(errors).toEqual([]);
});

test('clears task dates together with their explicit alarms', async ({ context, page }) => {
    const id = uuid(9);
    const repository = await mockBackend(context, {
        [`.tasks/${id}.md`]: '---\ntask:\n    status: {kind: todo}\n    available_from: 2026-10-01\n    due_by: 2026-10-15\n    deadline: 2026-10-20\n    alarms:\n        due_by: [-1d]\n        deadline: [-2d]\n---\n\n# Clear dates\n',
    });
    await page.goto(`/tasks-next/${id}/selected/status`);
    for (const name of ['Available from', 'Due date (soft target)', 'Deadline (hard cutoff)']) {
        const field = page.locator('.v-input').filter({ has: page.getByRole('textbox', { name, exact: true }) });
        await field.hover();
        await field.getByRole('button', { name: /^Clear/ }).click();
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => repository.writes.length).toBe(1);
    const metadata = YAML.parse(repository.writes[0].content.split('---')[1]);
    expect(metadata.task).toEqual({ status: { kind: 'todo' } });
});
