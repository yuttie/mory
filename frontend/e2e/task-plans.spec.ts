import { expect, test } from '@playwright/test';
import YAML from 'yaml';
import { API_URL, mockBackend, uuid } from './backend';

test.use({ viewport: { width: 3000, height: 1000 }, timezoneId: 'Asia/Tokyo' });
const A = uuid(1);
const B = uuid(2);
const C = uuid(3);
const task = (title: string, fields = '') => `---\ncreated_at: 2026-10-01 10:00:00+09:00\ntask:\n    status: {kind: todo}\n    importance: medium\n${fields}tags: [work]\n---\n\n# ${title}\n`;

test('plans by dragging, records effort and interruptions, collects history and completes the note', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    const repository = await mockBackend(context, {
        [`.tasks/${A}.md`]: task('Alpha'),
        [`.tasks/${B}.md`]: task('Beta'),
        [`.tasks/${C}.md`]: task('Later', '    available_from: 2026-10-10\n'),
        '.mory/plans/2026-09.yaml': `2026-09-30:\n    - task: ${B}\n      origin: planned\n`,
    });
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto('/tasks-next/_/descendants/schedule');
    const planner = page.locator('.planning-view');
    await expect(planner).toBeVisible();
    await expect(planner.locator('.candidates')).not.toContainText('Later');
    await expect(planner.getByRole('button', { name: 'Collect undone' })).toBeEnabled();
    const today = planner.locator('.day.today');
    const candidate = planner.locator('.candidate').filter({ hasText: 'Alpha' });
    await expect(candidate).toBeVisible();
    const handle = candidate.locator('.plan-drag-handle');
    await handle.click({ trial: true });
    const box = await handle.boundingBox();
    if (!box) {
        throw new Error('Candidate is not drawn');
    }
    const target = await today.locator('.entries').boundingBox();
    if (!target) {
        throw new Error('Day drop area is not drawn');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 5 });
    await expect(page.locator('.sortable-fallback')).toBeVisible();
    await page.mouse.move(target.x + 100, target.y + 60, { steps: 20 });
    await expect(today.locator('.sortable-ghost')).toBeVisible();
    await page.mouse.up();
    await expect(today.locator('.planned-entry')).toContainText('Alpha');
    await today.locator('.planned-entry').getByRole('checkbox').check();
    await expect(today.locator('.planned-entry')).toContainText('worked');
    await today.getByRole('button', { name: 'Record interruption' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Task worked on' }).click();
    await page.getByRole('option', { name: 'Beta', exact: true }).click();
    await dialog.getByRole('button', { name: 'Record worked' }).click();
    await expect(today).toContainText('interruption · worked');
    await planner.getByRole('button', { name: 'Collect undone' }).click();
    await expect.poll(() => {
        const write = repository.writes.filter((write) => write.path === '.mory/plans/2026-09.yaml').at(-1);
        return write ? YAML.parse(write.content)['2026-09-30'][0].result : undefined;
    }).toBe('missed');
    const alpha = today.locator('.planned-entry').filter({ hasText: 'Alpha' });
    await alpha.getByRole('button', { name: 'Complete task' }).click();
    await expect.poll(() => repository.writes.some((write) => write.path === `.tasks/${A}.md` && write.content.includes('kind: done'))).toBe(true);
    const october = repository.writes.filter((write) => write.path === '.mory/plans/2026-10.yaml').at(-1);
    expect(YAML.parse(october!.content)['2026-10-04']).toEqual([{ task: A, origin: 'planned', result: 'worked' }, { task: B, origin: 'interruption', result: 'worked' }]);
    expect(failures).toEqual([]);
});

test('shows an unknown task as removable history', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    const repository = await mockBackend(context, { '.mory/plans/2026-10.yaml': `2026-10-04:\n    - task: ${A}\n      origin: planned\n` });
    await page.goto('/tasks-next/_/descendants/schedule');
    const entry = page.locator('.day.today .planned-entry');
    await expect(entry).toContainText(`Unknown task ${A}`);
    await expect(entry.getByRole('checkbox')).toBeDisabled();
    await entry.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect.poll(() => YAML.parse(repository.writes.at(-1)?.content ?? '{}')['2026-10-04']).toEqual([]);
});

test('loads missed history when opening the status view directly', async ({ context, page }) => {
    await mockBackend(context, {
        [`.tasks/${A}.md`]: task('Alpha'),
        '.mory/plans/2026-09.yaml': ['2026-09-01', '2026-09-02', '2026-09-03'].map((date) => `${date}:\n    - task: ${A}\n      origin: planned\n      result: missed\n`).join(''),
    });
    await page.goto('/tasks-next/_/descendants/status');
    await expect(page.locator('.status-view .task-list-item').filter({ hasText: 'Alpha' })).toContainText('3 missed days');
});

test('keeps the interruption selection fixed while its plan is saving', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    const repository = await mockBackend(context, {
        [`.tasks/${A}.md`]: task('Alpha'),
        [`.tasks/${B}.md`]: task('Beta'),
        '.mory/plans/2026-10.yaml': `2026-10-04:\n    - task: ${B}\n      origin: planned\n`,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await context.route(`${API_URL}notes/**`, async (route) => {
        if (route.request().method() === 'PUT') {
            await gate;
        }
        await route.fallback();
    });
    await page.goto('/tasks-next/_/descendants/schedule');
    await page.locator('.day.today').getByRole('button', { name: 'Record interruption' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Task worked on' }).click();
    await page.getByRole('option', { name: 'Alpha', exact: true }).click();
    await dialog.getByRole('button', { name: 'Record worked' }).click();
    try {
        await expect(dialog.getByRole('combobox', { name: 'Task worked on' })).toBeDisabled();
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    }
    finally {
        release();
    }
    await expect(dialog).not.toBeVisible();
    const write = repository.writes.at(-1)!;
    expect(YAML.parse(write.content)['2026-10-04']).toEqual([{ task: B, origin: 'planned' }, { task: A, origin: 'interruption', result: 'worked' }]);
});
