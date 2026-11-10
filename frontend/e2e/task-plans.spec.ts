import { expect, test } from '@playwright/test';
import YAML from 'yaml';
import { API_URL, mockBackend, uuid } from './backend';

test.use({ viewport: { width: 3000, height: 1000 }, timezoneId: 'Asia/Tokyo' });
const A = uuid(1);
const B = uuid(2);
const C = uuid(3);
const task = (title: string, fields = '') => `---\ncreated_at: 2026-10-01 10:00:00+09:00\ntask:\n    status: {kind: todo}\n    importance: medium\n${fields}tags: [work]\n---\n\n# ${title}\n`;
const withStatus = (title: string, kind: string) => task(title).replace('kind: todo', `kind: ${kind}`);
const rated = (title: string, importance: string, fields = '') => task(title, fields).replace('importance: medium', `importance: ${importance}`);
const unrated = (title: string) => task(title).replace('    importance: medium\n', '');

for (const width of [390, 600, 1000, 1600]) {
    test(`keeps week controls reachable and scrolls the days at ${width}px`, async ({ context, page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
        const repository = await mockBackend(context, {
            [`.tasks/${A}.md`]: task('Alpha'),
            '.mory/plans/2026-09.yaml': `2026-09-30:\n    - task: ${A}\n      origin: planned\n`,
        });
        await page.goto('/tasks-next/_/descendants/schedule');
        const planner = page.locator('.planning-view');
        const collect = planner.getByRole('button', { name: 'Collect undone' });
        await expect(collect).toBeEnabled();
        const bounds = await planner.boundingBox();
        const control = await collect.boundingBox();
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(control!.x + control!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
        await collect.click();
        await expect.poll(() => repository.writes.some((write) => write.path === '.mory/plans/2026-09.yaml' && write.content.includes('missed'))).toBe(true);
        const lastDay = planner.locator('.day').last();
        await lastDay.getByRole('button', { name: 'Record interruption' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
        await planner.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(planner.locator('.week-range')).toContainText('2026-10-11');
    });
}

test('offers a task with subtasks only while none under it can be planned', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    await mockBackend(context, {
        [`.tasks/${A}.md`]: task('Open parent'),
        [`.tasks/${A}/${B}.md`]: task('Open subtask'),
        [`.tasks/${C}.md`]: task('Settled parent'),
        [`.tasks/${C}/${uuid(4)}.md`]: withStatus('Done subtask', 'done'),
        [`.tasks/${C}/${uuid(5)}.md`]: withStatus('Canceled subtask', 'canceled'),
        [`.tasks/${C}/${uuid(6)}.md`]: withStatus('Backlog subtask', 'backlog'),
        // Naming no status, which reads as Backlog.
        [`.tasks/${C}/${uuid(7)}.md`]: '---\ntags: [work]\n---\n\n# Unsorted subtask\n',
        [`.tasks/${uuid(8)}.md`]: task('Grandparent'),
        [`.tasks/${uuid(8)}/${uuid(9)}.md`]: withStatus('Done middle', 'done'),
        [`.tasks/${uuid(8)}/${uuid(9)}/${uuid(10)}.md`]: task('Open grandchild'),
        [`.tasks/${uuid(11)}.md`]: task('Parent of a later subtask'),
        [`.tasks/${uuid(11)}/${uuid(12)}.md`]: task('Later subtask', '    available_from: 2026-10-10\n'),
    });
    await page.goto('/tasks-next/_/descendants/schedule');
    // By title alone, since a subtask's row names its parent too. Equal tasks sort by UUID.
    await expect(page.locator('.planning-view .candidates .candidate .title-text'))
        .toHaveText(['Open subtask', 'Settled parent', 'Open grandchild', 'Parent of a later subtask']);
});

// A task is taken on in every status but Backlog, Done and Canceled, so a subtask in any of the
// others is what a day plans. One parent each, since any one of them would hide a parent they shared.
test('hides a task above a subtask in any status taken on', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    const kinds = ['todo', 'in_progress', 'waiting', 'blocked', 'on_hold'];
    await mockBackend(context, Object.fromEntries(kinds.flatMap((kind, index) => [
        [`.tasks/${uuid(2 * index + 1)}.md`, task(`Parent of ${kind}`)],
        [`.tasks/${uuid(2 * index + 1)}/${uuid(2 * index + 2)}.md`, withStatus(`Subtask ${kind}`, kind)],
    ])));
    await page.goto('/tasks-next/_/descendants/schedule');
    await expect(page.locator('.planning-view .candidates .candidate .title-text'))
        .toHaveText(kinds.map((kind) => `Subtask ${kind}`));
});

// A subtask stands in for the tasks above it that the column hides, so it ranks as they would.
test('ranks a subtask as the most urgent and important of the open tasks above it', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    await mockBackend(context, {
        [`.tasks/${uuid(1)}.md`]: rated('Calm chore', 'low'),
        // Lends its urgency and its importance alike.
        [`.tasks/${uuid(2)}.md`]: rated('Urgent project', 'high', '    deadline: 2026-10-05\n'),
        [`.tasks/${uuid(2)}/${uuid(9)}.md`]: unrated('Project step'),
        [`.tasks/${uuid(3)}.md`]: rated('Important someday', 'high'),
        // Over, so it lends neither its importance nor its deadline.
        [`.tasks/${uuid(4)}.md`]: rated('Finished project', 'high', '    deadline: 2026-10-05\n').replace('kind: todo', 'kind: done'),
        [`.tasks/${uuid(4)}/${uuid(5)}.md`]: unrated('Leftover step'),
        // More important than its step, so it lends over the step's own rating.
        [`.tasks/${uuid(6)}.md`]: rated('Big project', 'high'),
        [`.tasks/${uuid(6)}/${uuid(7)}.md`]: rated('Low step', 'low'),
    });
    await page.goto('/tasks-next/_/descendants/schedule');
    const candidates = page.locator('.planning-view .candidates .candidate');
    await expect(candidates.locator('.title-text'))
        .toHaveText(['Project step', 'Important someday', 'Low step', 'Calm chore', 'Leftover step']);
    const lent = candidates.filter({ hasText: 'Project step' }).locator('.lent-dates');
    await expect(lent).toContainText('Ranked by Urgent project:');
    await expect(lent).toContainText('Deadline');
    await expect(page.locator('.planning-view .lent-dates')).toHaveCount(1);
});

test('ranks by the level of urgency lent, then by the step\'s own rank', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    await mockBackend(context, {
        // Lends its steps the same urgency, so their own ranks order them.
        [`.tasks/${uuid(1)}.md`]: rated('Overdue project', 'high', '    deadline: 2026-10-01\n'),
        [`.tasks/${uuid(1)}/${uuid(2)}.md`]: rated('Dateless step', 'low'),
        [`.tasks/${uuid(1)}/${uuid(3)}.md`]: rated('Urgent step', 'high', '    deadline: 2026-10-05\n'),
        // Its target is missed, which is more urgent than urgent, though its deadline, and so its
        // slack, is a month off.
        [`.tasks/${uuid(4)}.md`]: rated('Missed project', 'high', '    due_by: 2026-10-03\n    deadline: 2026-11-03\n'),
        [`.tasks/${uuid(4)}/${uuid(5)}.md`]: rated('Step due tomorrow', 'high', '    deadline: 2026-10-05\n'),
        [`.tasks/${uuid(6)}.md`]: rated('Other urgent', 'high', '    deadline: 2026-10-07\n'),
    });
    await page.goto('/tasks-next/_/descendants/schedule');
    await expect(page.locator('.planning-view .candidates .candidate .title-text'))
        .toHaveText(['Urgent step', 'Dateless step', 'Step due tomorrow', 'Other urgent']);
});

test('names the nearest task above that raises the urgency, by its due dates alone', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    await mockBackend(context, {
        // As urgent as each other, so the nearer is named.
        [`.tasks/${uuid(1)}.md`]: rated('Outer project', 'high', '    deadline: 2026-10-05\n'),
        [`.tasks/${uuid(1)}/${uuid(2)}.md`]: task('Inner project', '    available_from: 2026-10-01\n    deadline: 2026-10-05\n'),
        [`.tasks/${uuid(1)}/${uuid(2)}/${uuid(3)}.md`]: unrated('Inner step'),
        // Its deadline is later than its step's, but nearer in its own longer lead time: it ranks
        // the step without raising its level, so it is not named.
        [`.tasks/${uuid(4)}.md`]: task('Long project', '    lead_time: 30d\n    deadline: 2026-11-13\n'),
        [`.tasks/${uuid(4)}/${uuid(5)}.md`]: task('Dated step', '    deadline: 2026-10-14\n'),
    });
    await page.goto('/tasks-next/_/descendants/schedule');
    const candidates = page.locator('.planning-view .candidates .candidate');
    await expect(candidates.locator('.title-text')).toHaveText(['Inner step', 'Dated step']);
    const lent = candidates.filter({ hasText: 'Inner step' }).locator('.lent-dates');
    await expect(lent).toContainText('Ranked by Inner project:');
    await expect(lent).toContainText('Deadline');
    await expect(lent).not.toContainText('Available');
    await expect(page.locator('.planning-view .lent-dates')).toHaveCount(1);
});

// Every task in the list is under its root, so the root, and whatever is above it, would rank them
// all alike.
test('leaves the task the list is under, and those above it, out of the ranking', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    await mockBackend(context, {
        [`.tasks/${uuid(1)}.md`]: rated('Programme', 'high', '    deadline: 2026-10-05\n'),
        [`.tasks/${uuid(1)}/${uuid(2)}.md`]: rated('Urgent project', 'high', '    deadline: 2026-10-05\n'),
        [`.tasks/${uuid(1)}/${uuid(2)}/${uuid(3)}.md`]: unrated('Unrated step'),
        [`.tasks/${uuid(1)}/${uuid(2)}/${uuid(4)}.md`]: rated('Minor step', 'low'),
    });
    await page.goto(`/tasks-next/${uuid(2)}/descendants/schedule`);
    await expect(page.locator('.planning-view .candidates .candidate .title-text')).toHaveText(['Minor step', 'Unrated step']);
    await expect(page.locator('.planning-view .lent-dates')).toHaveCount(0);
});

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
    await candidate.click({ trial: true });
    const box = await candidate.boundingBox();
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
    await expect(today).toHaveCSS('outline-style', 'solid');
    await expect(planner.locator('.candidates .vacated')).toHaveCSS('visibility', 'hidden');
    await page.mouse.up();
    await expect(today.locator('.planned-entry')).toContainText('Alpha');
    await expect(planner.getByRole('button', { name: 'Collect undone' })).toBeEnabled();
    expect(repository.writes.filter((write) => write.path === '.mory/plans/2026-10.yaml')).toHaveLength(1);
    await expect(planner).not.toContainText('changed elsewhere');
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

test('orders day entries and moves an entry to another day', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
    const repository = await mockBackend(context, {
        [`.tasks/${A}.md`]: task('Alpha'),
        [`.tasks/${B}.md`]: task('Beta'),
        '.mory/plans/2026-10.yaml': `2026-10-04:\n    - task: ${A}\n      origin: interruption\n      result: worked\n    - task: ${B}\n      origin: planned\n`,
    });
    await page.goto('/tasks-next/_/descendants/schedule');
    const planner = page.locator('.planning-view');
    const today = planner.locator('.day.today');
    const alpha = today.locator('.planned-entry', { hasText: 'Alpha' });
    const beta = today.locator('.planned-entry', { hasText: 'Beta' });
    await expect(planner.getByRole('button', { name: 'Collect undone' })).toBeEnabled();
    // Pick up the task's title, just as in Status; buttons and the effort checkbox stay clickable.
    await beta.getByRole('link').click({ trial: true });
    const source = await beta.getByRole('link').boundingBox();
    const target = await alpha.boundingBox();
    if (!source || !target) {
        throw new Error('Plan entries are not drawn');
    }
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 20, source.y + source.height / 2 + 20, { steps: 5 });
    await expect(page.locator('.sortable-fallback')).toBeVisible();
    await page.mouse.move(target.x + 100, target.y + 10, { steps: 20 });
    await expect(today.locator('.planned-entry').first()).toContainText('Beta');
    await page.mouse.up();
    await expect.poll(() => repository.writes.length).toBe(1);
    expect(YAML.parse(repository.writes[0].content)['2026-10-04']).toEqual([
        { task: B, origin: 'planned' }, { task: A, origin: 'interruption', result: 'worked' },
    ]);

    const tomorrow = planner.locator('.day').filter({ has: page.locator('.task-group-title', { hasText: '2026-10-05' }) });
    await alpha.getByRole('link').click({ trial: true });
    const nextSource = await alpha.getByRole('link').boundingBox();
    const destination = await tomorrow.locator('.entries').boundingBox();
    if (!nextSource || !destination) {
        throw new Error('Plan drop area is not drawn');
    }
    await page.mouse.move(nextSource.x + nextSource.width / 2, nextSource.y + nextSource.height / 2);
    await page.mouse.down();
    await page.mouse.move(nextSource.x + nextSource.width / 2 + 20, nextSource.y + nextSource.height / 2 + 20, { steps: 5 });
    await expect(page.locator('.sortable-fallback')).toBeVisible();
    await page.mouse.move(destination.x + 100, destination.y + 60, { steps: 20 });
    await expect(tomorrow).toHaveCSS('outline-style', 'solid');
    await page.mouse.up();
    await expect.poll(() => repository.writes.length).toBe(2);
    expect(YAML.parse(repository.writes[1].content)).toEqual({
        '2026-10-04': [{ task: B, origin: 'planned' }],
        '2026-10-05': [{ task: A, origin: 'interruption', result: 'worked' }],
    });
    await expect(today.locator('.planned-entry')).toHaveCount(1);
    await expect(today).not.toContainText('Alpha');
    await expect(tomorrow.locator('.planned-entry')).toContainText('Alpha');
    await expect(planner).not.toContainText('changed elsewhere');
});

test.describe('touch planning', () => {
    test.use({ hasTouch: true, viewport: { width: 1100, height: 900 } });

    test('picks up the task row with the Status view long press', async ({ browserName, context, page }) => {
        test.skip(browserName !== 'chromium', 'CDP supplies real touch movement in Chromium.');
        await page.clock.setFixedTime(new Date('2026-10-04T05:05:12Z'));
        const repository = await mockBackend(context, { [`.tasks/${A}.md`]: task('Alpha') });
        await page.goto('/tasks-next/_/descendants/schedule');
        const planner = page.locator('.planning-view');
        const candidate = planner.locator('.candidate', { hasText: 'Alpha' });
        await candidate.click({ trial: true });
        const source = await candidate.boundingBox();
        const target = await planner.locator('.day.today .entries').boundingBox();
        if (!source || !target) {
            throw new Error('Touch drop area is not drawn');
        }
        const client = await context.newCDPSession(page);
        const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        // A short press remains a tap; only a long press starts Status-style dragging.
        await page.waitForTimeout(200);
        await expect(page.locator('.sortable-fallback')).toHaveCount(0);
        const prevented = await candidate.evaluate((element) => !element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
        expect(prevented).toBe(true);
        await page.waitForTimeout(400);
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 20, y: start.y + 20 }] });
        await expect(page.locator('.sortable-fallback')).toBeVisible();
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + 100, y: target.y + 60 }] });
        await expect(planner.locator('.day.today')).toHaveCSS('outline-style', 'solid');
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => repository.writes.length).toBe(1);
        expect(YAML.parse(repository.writes[0].content)['2026-10-04']).toEqual([{ task: A, origin: 'planned' }]);
    });
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
