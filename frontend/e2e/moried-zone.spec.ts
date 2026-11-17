import { expect, test } from '@playwright/test';
import YAML from 'yaml';
import { mockBackend, uuid } from './backend';

// The browser in Tokyo, and moried at UTC+14: a time written without an offset is moried's, wherever
// the browser is.
test.use({ timezoneId: 'Asia/Tokyo' });
const ZONE = 'Pacific/Kiritimati';

function task(title: string, fields = ''): string {
    return ['---', 'task:', '    status: {kind: todo}', ...(fields ? [fields] : []), '---', '', `# ${title}`, ''].join('\n');
}

test('reads a task\'s bare date in moried\'s zone', async ({ context, page }) => {
    // 21:00 in Tokyo, and already the 5th at UTC+14.
    await page.clock.setFixedTime(new Date('2026-10-04T12:00:00Z'));
    await mockBackend(context, { [`.tasks/${uuid(1)}.md`]: task('Report', '    deadline: 2026-10-04') }, { zone: ZONE });
    await page.goto('/');
    const deadline = page.locator('.task-date-cue[data-field="deadline"]');
    await expect(deadline).toHaveText('Deadline 2 hours ago');
    await expect(deadline).toHaveClass(/text-error/);
});

test('gives a time typed without an offset moried\'s zone\'s', async ({ context, page }) => {
    const project = uuid(1);
    const repository = await mockBackend(context, { [`.tasks/${project}.md`]: task('Project') }, { zone: ZONE });
    await page.goto(`/tasks-next/${project}/descendants/status`);
    await page.locator('.item-view .v-toolbar').getByTitle('Quick add', { exact: true }).click();
    const outline = page.getByRole('dialog').filter({ hasText: 'Quick add tasks' });
    await outline.locator('.cm-content').click();
    await page.keyboard.insertText('Call [<=2026-12-01 18:00]');
    await expect(outline.getByText('due 2026-12-01 18:00+14:00')).toBeVisible();
    await outline.getByRole('button', { name: 'Add 1 task' }).click();
    await expect.poll(() => repository.writes.length).toBe(1);
    expect(YAML.parse(repository.writes[0].content.split('---')[1]).task.due_by).toBe('2026-12-01 18:00+14:00');
});
