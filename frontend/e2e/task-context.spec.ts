import { expect, test } from '@playwright/test';
import YAML from 'yaml';
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

test('day entries share task context while effort controls remain independent of navigation', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T03:00:00Z'));
    const repository = await mockBackend(context, {
        [`.tasks/${A}.md`]: note('Project', '    deadline: 2026-10-24\n    lead_time: 30d\n'),
        [`.tasks/${A}/${B}.md`]: note('Write report', '    available_from: 2026-10-04\n    due_by: 2026-10-04 10:00:00+09:00\n    deadline: 2026-10-24\n    lead_time: 30d\ntags: [work]\n'),
        [`.tasks/${A}/${C}.md`]: note('Finished', '').replace('kind: todo', 'kind: done'),
        '.mory/plans/2026-09.yaml': ['01', '02', '03'].map((day) => `2026-09-${day}:\n    - task: ${B}\n      origin: planned\n      result: missed\n`).join(''),
        '.mory/plans/2026-10.yaml': `2026-10-04:\n    - task: ${A}\n      origin: planned\n    - task: ${B}\n      origin: planned\n`,
    });
    await page.goto('/tasks-next/_/descendants/schedule');
    const today = page.locator('.day.today');
    const project = today.locator('.planned-entry', { hasText: 'Project' }).filter({ hasNotText: 'Write report' });
    const report = today.locator('.planned-entry', { hasText: 'Write report' });
    const candidate = page.locator('.candidates .task-list-item', { hasText: 'Write report' });
    await expect(project).toContainText('50%');
    await expect(project).toContainText('Target missed');
    await expect(report.locator('.ancestors')).toHaveText('Project');
    await expect(report.locator('.tag')).toHaveText('work');
    await expect(report).toContainText('Target missed');
    await expect(report).toContainText('3 missed days');
    await expect(report).toContainText('Window shorter than lead time');
    await expect(report.locator('.task-date-cue')).toHaveText(await candidate.locator('.task-date-cue').allTextContents());
    const due = report.locator('.task-date-cue[data-field="due_by"]');
    await expect(due).toContainText('Due 2 hours ago');
    await due.hover();
    await expect(page.getByRole('tooltip', { name: 'Due: 2026-10-04 10:00:00+09:00', exact: true })).toBeVisible();
    await report.getByRole('checkbox', { name: 'Worked' }).check();
    await expect.poll(() => YAML.parse(repository.writes.at(-1)?.content ?? '{}')['2026-10-04']?.[1]?.result).toBe('worked');
    await expect(page).toHaveURL(/\/tasks-next\/_\/descendants\/schedule$/);
    await report.getByRole('button', { name: 'Missed', exact: true }).click();
    await expect.poll(() => YAML.parse(repository.writes.at(-1)?.content ?? '{}')['2026-10-04']?.[1]?.result).toBe('missed');
    await expect(page).toHaveURL(/\/tasks-next\/_\/descendants\/schedule$/);
    // Padding belongs to the row's real link, rather than only the title being clickable.
    await report.click({ position: { x: 4, y: 4 } });
    await expect(page).toHaveURL(new RegExp(`/tasks-next/${B}/selected/schedule$`));
});

test('unused day-entry space supports new tabs and keyboard navigation', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T03:00:00Z'));
    await mockBackend(context, {
        [`.tasks/${A}.md`]: note('Task link', ''),
        '.mory/plans/2026-10.yaml': `2026-10-04:\n    - task: ${A}\n      origin: planned\n`,
    });
    await page.goto('/tasks-next/_/descendants/schedule');
    const entry = page.locator('.day.today .planned-entry');
    const opened = context.waitForEvent('page');
    await entry.click({ position: { x: 4, y: 4 }, modifiers: ['ControlOrMeta'] });
    const newTab = await opened;
    await expect(newTab).toHaveURL(new RegExp(`/tasks-next/${A}/selected/schedule$`));
    await expect(page).toHaveURL(/\/tasks-next\/_\/descendants\/schedule$/);
    await newTab.close();
    await entry.getByRole('link').press('Enter');
    await expect(page).toHaveURL(new RegExp(`/tasks-next/${A}/selected/schedule$`));
});
