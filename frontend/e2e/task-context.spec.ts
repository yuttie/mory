import { expect, test } from '@playwright/test';
import { mockBackend, uuid } from './backend';

test.use({ timezoneId: 'Asia/Tokyo', viewport: { width: 3000, height: 1000 } });
const A = uuid(21);
const B = uuid(22);
const C = uuid(23);
const note = (title: string, fields: string) => `---\ntask:\n    status: {kind: todo}\n    importance: high\n${fields}---\n\n# ${title}\n`;

test('uses consistent date instants and lead-time colors in the task lists and Home', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T03:00:00Z'));
    await mockBackend(context, {
        [`.tasks/${A}.md`]: note('Timed deadline', '    deadline: 2026-10-04 10:00:00+09:00\n'),
        [`.tasks/${B}.md`]: note('Long lead', '    deadline: 2026-10-24\n    lead_time: 30d\n'),
        [`.tasks/${C}.md`]: note('Short lead', '    deadline: 2026-10-06\n    lead_time: 1d\n'),
    });
    for (const [mode, selector] of [['status', '.status-view'], ['schedule', '.planning-view .candidates'], ['eisenhower', '.eisenhower-matrix']]) {
        await page.goto(`/tasks-next/_/descendants/${mode}`);
        const list = page.locator(selector);
        const timed = list.locator('.task-list-item', { hasText: 'Timed deadline' });
        const long = list.locator('.task-list-item', { hasText: 'Long lead' });
        const short = list.locator('.task-list-item', { hasText: 'Short lead' });
        await expect(timed).toContainText('Overdue');
        await expect(timed.locator('.task-date-cue')).toContainText('Deadline 2 hours ago');
        await expect(timed.locator('.task-date-cue')).toHaveClass(/text-error/);
        await expect(long).toContainText('Urgent');
        await expect(long.locator('.task-date-cue')).toHaveClass(/text-warning/);
        await expect(short).toContainText('Calm');
        await expect(short.locator('.task-date-cue')).toHaveClass(/text-medium-emphasis/);
    }
    await page.goto('/');
    const home = page.locator('.tasks-section');
    await expect(home.locator('.task-item', { hasText: 'Timed deadline' }).locator('.task-date-cue')).toContainText('Deadline 2 hours ago');
    await expect(home.locator('.task-item', { hasText: 'Long lead' }).locator('.task-date-cue')).toHaveClass(/text-warning/);
});

test('loads lead-time defaults when navigating to Home with an existing listing', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T03:00:00Z'));
    await mockBackend(context, {
        [`.tasks/${A}.md`]: note('Configured lead', '    deadline: 2026-10-24\n'),
        '.mory/tasks.yaml': 'default_lead_time: 30d\n',
    });
    const listed = page.waitForResponse((response) => response.url().includes('/v2/entries') && response.status() === 200);
    await page.goto('/files');
    await listed;
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    const cue = page.locator('.tasks-section .task-item', { hasText: 'Configured lead' }).locator('.task-date-cue');
    await expect(cue).toHaveClass(/text-warning/);
});
