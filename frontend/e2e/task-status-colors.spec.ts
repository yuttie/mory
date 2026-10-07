import { expect, test } from '@playwright/test';
import { mockBackend, uuid } from './backend';

const DONE = uuid(31);
const SETTINGS = '# Lead times\ndefault_lead_time: 7d\n';

test('sets a status colour in the Config dialog, writing only its own lines', async ({ context, page }) => {
    const repository = await mockBackend(context, {
        '.mory/tasks.yaml': SETTINGS,
        [`.tasks/${DONE}.md`]: '---\ntask:\n    status:\n        kind: done\n        completed_at: 2026-10-01 10:00:00+09:00\n---\n\n# Shipped\n',
    });
    await page.goto('/config');
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
    const section = page.locator('section', { hasText: 'Status colours' });
    const save = section.getByRole('button', { name: 'Save colours' });
    await expect(save).toBeDisabled();

    // A colour this cannot draw is refused, rather than saved and then drawn as the default.
    await section.getByLabel('Done', { exact: true }).fill('not a colour');
    await save.click();
    await expect(section.getByText('"not a colour" is not an opaque colour this can draw.')).toBeVisible();
    expect(repository.writes).toEqual([]);

    await section.getByLabel('Done', { exact: true }).fill('#ff0000');
    await save.click();
    await expect.poll(() => repository.writes).toEqual([
        { path: '.mory/tasks.yaml', content: SETTINGS + 'status_colors:\n    done: "#ff0000"\n' },
    ]);

    await page.goto('/tasks-next/_/descendants/status');
    const card = page.locator('.status-view .task-list-item', { hasText: 'Shipped' });
    await expect(card).toHaveAttribute('style', /color-mix\(in srgb, rgb\(255, 0, 0\) 12%/);
});

test('keeps a colour being edited when the settings are read again', async ({ context, page }) => {
    const repository = await mockBackend(context, { '.mory/tasks.yaml': SETTINGS });
    await page.goto('/config');
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
    const section = page.locator('section', { hasText: 'Status colours' });
    await section.getByLabel('Done', { exact: true }).fill('#ff0000');

    // Any commit reads the settings again: here, saving the calendar's colours on the same page.
    await page.getByRole('tab', { name: 'Calendars', exact: true }).click();
    const calendars = page.locator('section', { hasText: 'Task dates' });
    await calendars.getByLabel('Due date colour').fill('#00ff00');
    const reread = page.waitForResponse((response) => response.url().endsWith('/.mory/tasks.yaml'));
    await calendars.getByRole('button', { name: 'Save colours' }).click();
    await reread;
    expect(repository.writes.map((write) => write.path)).toEqual(['.mory/calendars.yaml']);

    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
    await expect(section.getByLabel('Done', { exact: true })).toHaveValue('#ff0000');
    await expect(section.getByRole('button', { name: 'Save colours' })).toBeEnabled();
});
