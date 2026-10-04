import { expect, test } from '@playwright/test';
import YAML from 'yaml';
import { mockBackend } from './backend';

test.use({ timezoneId: 'Asia/Tokyo' });

test('stamps new notes and tasks with the local creation time', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    const repository = await mockBackend(context, { 'meeting.template': '# Meeting\n' });
    await page.goto('/create?from=meeting.template');
    await expect(page).toHaveURL(/\/note\/[0-9a-f-]{36}\.md\?mode=create/);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => repository.writes.length).toBe(1);
    expect(YAML.parse(repository.writes[0].content.split('---')[1]).created_at).toBe('2026-10-04 14:05:12+09:00');
    await page.goto('/tasks-next');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('New task');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => repository.writes.filter((write) => write.path.startsWith('.tasks/')).length).toBe(1);
    const created = repository.writes.find((write) => write.path.startsWith('.tasks/'))!;
    expect(YAML.parse(created.content.split('---')[1]).created_at).toBe('2026-10-04 14:05:12+09:00');
});

test('reports malformed new-note frontmatter and allows a corrected save', async ({ context, page }) => {
    const repository = await mockBackend(context, { 'broken.template': '---\ntags: [\n---\n# Broken\n' });
    await page.goto('/create?from=broken.template');
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'YAMLParseError' })).toBeVisible();
    await expect(save).toBeEnabled();
    expect(repository.writes).toEqual([]);
    await page.getByRole('textbox').first().fill('# Repaired\n');
    await save.click();
    await expect.poll(() => repository.writes.length).toBe(1);
    expect(repository.writes[0].content).toContain('created_at:');
});
