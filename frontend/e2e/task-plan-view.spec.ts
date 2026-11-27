import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import YAML from 'yaml';
import { mockBackend, uuid } from './backend';

test.use({ viewport: { width: 1800, height: 1000 }, timezoneId: 'Asia/Tokyo' });

const A = uuid(1);
const B = uuid(2);
const C = uuid(3);
const task = (title: string, fields = '') => `---\ncreated_at: 2026-10-01 10:00:00+09:00\ntask:\n    status: {kind: todo}\n${fields}tags: [work]\n---\n\n# ${title}\n`;
// Monday 2026-10-05: a meeting over noon, and a trip on the Wednesday and the Thursday.
const NOTES = {
    [`.tasks/${A}.md`]: task('Alpha', '    estimate: 1h\n'),
    [`.tasks/${B}.md`]: task('Beta', '    estimate: 3h\n'),
    [`.tasks/${C}.md`]: task('Gamma', '    deadline: 2026-10-09\n'),
    '.events/week.md': [
        '---',
        'events:',
        '    Meeting:',
        '        start: 2026-10-05 12:00:00+09:00',
        '        end: 2026-10-05 13:00:00+09:00',
        '    Trip:',
        '        start: 2026-10-07',
        '        end: 2026-10-08',
        '---',
        '',
        '# Week',
        '',
    ].join('\n'),
    '.mory/plans/2026-10.yaml': `2026-10-05:\n    - task: ${A}\n      origin: planned\n    - task: ${B}\n      origin: planned\n`,
};
// 10:00 that Monday in Tokyo.
const MORNING = new Date('2026-10-05T01:00:00Z');

const plan = (page: Page) => page.locator('.plan-view');
const day = (page: Page, date: string) => plan(page).locator(`.day[data-day="${date}"]`);
const zoom = (page: Page, title: string) => plan(page).getByTitle(title, { exact: true }).click();
const planOf = (writes: { path: string; content: string }[], date: string) => {
    const write = writes.filter(({ path }) => path === '.mory/plans/2026-10.yaml').at(-1);
    return write ? YAML.parse(write.content)[date] : undefined;
};

test('is the view the tasks open in', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next');
    await expect(page).toHaveURL(/\/tasks-next\/_\/descendants\/plan$/);
    await expect(plan(page).locator('.plan-range')).toHaveText('2026-10-04 – 2026-10-17');
    await expect(plan(page).locator('.day')).toHaveCount(14);
    await expect(plan(page).locator('.day.today')).toHaveAttribute('data-day', '2026-10-05');
});

test('draws each day with its events and the time they leave', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    await expect(day(page, '2026-10-05').locator('.day-event')).toHaveText(/12:00\s+Meeting/);
    // A whole day takes no time, and is drawn over each day it is on.
    await expect(day(page, '2026-10-07').locator('.day-banner')).toHaveText('Trip');
    await expect(day(page, '2026-10-08').locator('.day-banner')).toHaveText('Trip');
    await expect(day(page, '2026-10-09').locator('.day-banner')).toHaveCount(0);
    await expect(day(page, '2026-10-07').locator('.day-load')).toHaveText('0m / 9h');
    // A task's deadline marks its day.
    await expect(day(page, '2026-10-09').locator('.day-task-date')).toHaveText(/Gamma/);
    // Today is poured from the present: two hours before the meeting and five after it.
    await expect(day(page, '2026-10-05').locator('.day-load')).toHaveText('4h / 7h');
    await expect(day(page, '2026-10-05').locator('.plan-entry-meta')).toHaveText([/10:00\s*1h/, /11:00\s*3h/]);
    // A day gone by is not poured at all.
    await expect(day(page, '2026-10-04').locator('.day-load')).toHaveCount(0);
});

// A series' occurrence is found by when it begins, as an imported event is: one begun well before
// the first day shown is still drawn on the days it reaches, as the calendar draws it.
test('draws a long event begun before the days shown', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    await mockBackend(context, {
        ...NOTES,
        '.events/leave.md': '---\nevents:\n    Leave:\n        start: 2025-09-20\n        end: 2025-10-06\n        repeat:\n            freq: yearly\n---\n\n# Leave\n',
    }, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    await expect(day(page, '2026-10-04').locator('.day-banner')).toHaveText('Leave');
    await expect(day(page, '2026-10-06').locator('.day-banner')).toHaveText('Leave');
    await expect(day(page, '2026-10-07').locator('.day-banner')).toHaveText('Trip');
});

test('pours a day\'s tasks around its events, in their order', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    await day(page, '2026-10-05').locator('.day-title').click();
    await expect(plan(page).locator('.plan-range')).toHaveText('2026-10-05 Mon');
    await expect(plan(page).locator('.timeline-event')).toHaveText('Meeting');
    // Beta does not fit before the meeting, and goes on after it.
    await expect(plan(page).locator('.timeline-task')).toHaveText([
        /10:00–11:00\s+Alpha/,
        /11:00–12:00 \(1\/2\)\s+Beta/,
        /13:00–15:00 \(2\/2\)\s+Beta/,
    ]);
    await expect(plan(page).locator('.timeline-overflow')).toHaveCount(0);
    await zoom(page, 'Next day');
    await expect(plan(page).locator('.plan-range')).toHaveText('2026-10-06 Tue');
    await expect(plan(page).locator('.timeline-task')).toHaveCount(0);
});

test('says what a day has no room for', async ({ context, page }) => {
    // 16:30: an hour and a half of the day is left.
    await page.clock.setFixedTime(new Date('2026-10-05T07:30:00Z'));
    await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    await expect(day(page, '2026-10-05').locator('.day-load.over')).toHaveText('4h / 1h 30m');
    await expect(day(page, '2026-10-05').locator('.plan-entry.over .plan-entry-meta')).toHaveText(/17:30\s*3h\s*2h 30m over/);
    await zoom(page, 'One day, by the clock');
    await expect(plan(page).locator('.timeline-overflow')).toContainText('Does not fit: 2h 30m');
    await expect(plan(page).locator('.timeline-overflow')).toContainText('Beta (2h 30m)');
});

test('plans a candidate on the day it is dropped on', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    const repository = await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    const candidate = plan(page).locator('.candidate').filter({ hasText: 'Gamma' });
    await candidate.click({ trial: true });
    const box = (await candidate.boundingBox())!;
    const target = (await day(page, '2026-10-06').locator('.entries').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 5 });
    await expect(page.locator('.sortable-fallback')).toBeVisible();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect(day(page, '2026-10-06').locator('.plan-entry-title')).toHaveText('Gamma');
    await expect.poll(() => planOf(repository.writes, '2026-10-06')).toEqual([{ task: C, origin: 'planned' }]);
    // It has no estimate of its own, so it takes the default hour, drawn as a guess.
    await expect(day(page, '2026-10-06').locator('.plan-entry-estimate.assumed')).toHaveText('1h');
    await expect(day(page, '2026-10-06').locator('.day-load')).toHaveText('1h / 9h');
});

// Pressed on its middle, and let go over `target`'s.
async function drag(page: Page, from: Locator, target: Locator): Promise<void> {
    await from.click({ trial: true });
    const box = (await from.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 5 });
    await expect(page.locator('.sortable-fallback')).toBeVisible();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
    await page.mouse.up();
}

test('moves a planned task to another day', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    const repository = await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    await drag(page, day(page, '2026-10-05').locator('.plan-entry', { hasText: 'Alpha' }), day(page, '2026-10-06').locator('.entries'));
    await expect(day(page, '2026-10-06').locator('.plan-entry-title')).toHaveText('Alpha');
    await expect.poll(() => planOf(repository.writes, '2026-10-06')).toEqual([{ task: A, origin: 'planned' }]);
    expect(planOf(repository.writes, '2026-10-05')).toEqual([{ task: B, origin: 'planned' }]);
    // The release is no click on the task: its menu would have opened as it was let go.
    await expect(page.locator('.plan-entry-menu')).toBeHidden();
});

test('reorders a day\'s tasks, and pours them in the new order', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    const repository = await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    const monday = day(page, '2026-10-05');
    await drag(page, monday.locator('.plan-entry', { hasText: 'Beta' }), monday.locator('.plan-entry', { hasText: 'Alpha' }));
    await expect.poll(() => planOf(repository.writes, '2026-10-05')).toEqual([{ task: B, origin: 'planned' }, { task: A, origin: 'planned' }]);
    await expect(monday.locator('.plan-entry-title')).toHaveText(['Beta', 'Alpha']);
    await expect(monday.locator('.plan-entry-meta')).toHaveText([/10:00\s*3h/, /14:00\s*1h/]);
    await expect(page.locator('.plan-entry-menu')).toBeHidden();
});

test('sets a task down for the day and takes it up on the next', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    const repository = await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    await day(page, '2026-10-05').locator('.plan-entry', { hasText: 'Alpha' }).click();
    await page.getByText('Worked, and continue on 2026-10-06').click();
    await expect(day(page, '2026-10-06').locator('.plan-entry-title')).toHaveText('Alpha');
    await expect.poll(() => planOf(repository.writes, '2026-10-05')?.[0]).toEqual({ task: A, origin: 'planned', result: 'worked' });
    expect(planOf(repository.writes, '2026-10-06')).toEqual([{ task: A, origin: 'planned' }]);
    // What is worked on is no longer poured into the day: Beta begins at once.
    await expect(day(page, '2026-10-05').locator('.day-load')).toHaveText('3h / 7h');
});

// The menu is opened by the view, on the task chosen. Left to open on a click as well, Vuetify's own
// listener on a task it had opened on before closed the menu the view had just opened.
test('opens a planned task\'s menu again, and on another task', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    const menu = page.locator('.plan-entry-menu');
    const entry = (title: string) => day(page, '2026-10-05').locator('.plan-entry', { hasText: title });
    for (const title of ['Alpha', 'Alpha', 'Beta', 'Alpha', 'Beta', 'Beta']) {
        await entry(title).click();
        await expect(menu).toBeVisible();
        await expect(menu.locator('.v-card-title')).toHaveText(title);
        // Long enough for a menu closed at once to have gone.
        await page.waitForTimeout(400);
        await expect(menu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
    }
    // Straight from one task to another, the click that leaves the first opening the second.
    await entry('Alpha').click();
    await expect(menu.locator('.v-card-title')).toHaveText('Alpha');
    await entry('Beta').click();
    await expect(menu.locator('.v-card-title')).toHaveText('Beta');
    await page.waitForTimeout(400);
    await expect(menu).toBeVisible();
});

// A hand on a mouse moves it a little as it clicks, which Sortable took for a drag.
test('opens a planned task\'s menu on a click that moves a pixel', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    const entry = day(page, '2026-10-05').locator('.plan-entry', { hasText: 'Alpha' });
    await entry.click({ trial: true });
    const box = (await entry.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
    await page.mouse.up();
    await expect(page.locator('.plan-entry-menu .v-card-title')).toHaveText('Alpha');
});

test('says what was done when a task set down for the day cannot be planned on the next', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    // The first write records the day worked; the second, which plans the next, fails.
    let saves = 0;
    await context.route('**/api/notes/.mory/plans/2026-10.yaml', async (route) => {
        if (route.request().method() === 'PUT' && ++saves === 2) {
            await route.fulfill({ status: 500, json: {} });
            return;
        }
        await route.fallback();
    });
    await page.goto('/tasks-next/_/descendants/plan');
    await day(page, '2026-10-05').locator('.plan-entry', { hasText: 'Alpha' }).click();
    await page.getByText('Worked, and continue on 2026-10-06').click();
    await expect(plan(page).locator('.v-alert')).toContainText('Recorded as worked, but planning it on 2026-10-06 failed');
    await expect(day(page, '2026-10-06').locator('.plan-entry')).toHaveCount(0);
});

// A colour may be a palette name, which CSS does not read, and a pale one: each is drawn as the
// calendar draws it, with what is written on it in whichever of black and white stands out.
test('draws events in their colours, written on legibly', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    await mockBackend(context, {
        ...NOTES,
        '.events/week.md': NOTES['.events/week.md']
            .replace('        end: 2026-10-05 13:00:00+09:00\n', '        end: 2026-10-05 13:00:00+09:00\n        color: deep-purple\n')
            .replace('        end: 2026-10-08\n', '        end: 2026-10-08\n        color: light-green\n'),
    }, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    const colours = (locator: Locator) => locator.evaluate((element) => [getComputedStyle(element).backgroundColor, getComputedStyle(element).color]);
    await expect(day(page, '2026-10-07').locator('.day-banner')).toHaveText('Trip');
    expect(await colours(day(page, '2026-10-07').locator('.day-banner'))).toEqual(['rgb(139, 195, 74)', 'rgb(0, 0, 0)']);
    expect(await colours(day(page, '2026-10-05').locator('.day-event-dot'))).toContain('rgb(103, 58, 183)');
    await zoom(page, 'One day, by the clock');
    expect(await colours(plan(page).locator('.timeline-event'))).toEqual(['rgb(103, 58, 183)', 'rgb(255, 255, 255)']);
});

test('corrects an estimate where the task is planned', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    const repository = await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    await day(page, '2026-10-05').locator('.plan-entry', { hasText: 'Beta' }).click();
    const field = page.getByLabel('Estimate of the work left');
    await expect(field).toHaveValue('3h');
    await field.fill('1h 30m');
    await page.getByRole('button', { name: 'Set', exact: true }).click();
    // The menu goes as the change is made, rather than stay over the view while it loads.
    await expect(page.locator('.plan-entry-menu')).toBeHidden();
    await expect.poll(() => repository.writes.find(({ path }) => path === `.tasks/${B}.md`)?.content)
        .toBe(NOTES[`.tasks/${B}.md`].replace('estimate: 3h', 'estimate: 1h 30m'));
    await expect(day(page, '2026-10-05').locator('.day-load')).toHaveText('2h 30m / 7h');
});

test('adds a task where it is planned from, ready to plan', async ({ context, page }) => {
    await page.clock.setFixedTime(MORNING);
    const repository = await mockBackend(context, NOTES, { zone: 'Asia/Tokyo' });
    await page.goto(`/tasks-next/${C}/descendants/plan`);
    const field = plan(page).getByRole('textbox', { name: 'Add a task under Gamma' });
    await field.fill('Delta [2h]');
    await field.press('Enter');
    await expect(plan(page).locator('.candidate .title-text')).toHaveText(['Delta']);
    await expect(field).toHaveValue('');
    const write = repository.writes.find(({ path }) => path.startsWith(`.tasks/${C}/`))!;
    expect(YAML.parse(write.content.split('---')[1]).task).toEqual({ status: { kind: 'todo' }, estimate: '2h' });
    // What is not a task's field is said, and nothing is written.
    await field.fill('Epsilon [soon]');
    await field.press('Enter');
    await expect(plan(page).locator('.candidates .v-messages')).toContainText('soon');
    expect(repository.writes).toHaveLength(1);
});

// The days and the two buttons that are not about them share a phone's width.
test('keeps its controls within a phone\'s width', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.clock.setFixedTime(MORNING);
    const repository = await mockBackend(context, {
        ...NOTES,
        '.mory/plans/2026-09.yaml': `2026-09-30:\n    - task: ${C}\n      origin: planned\n`,
    }, { zone: 'Asia/Tokyo' });
    await page.goto('/tasks-next/_/descendants/plan');
    const toolbar = plan(page).locator('.plan-toolbar');
    const more = toolbar.getByTitle('More', { exact: true });
    await expect(more).toBeVisible();
    for (const control of [more, toolbar.getByTitle('Four weeks', { exact: true }), toolbar.getByTitle('Next week', { exact: true })]) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await more.click();
    await page.getByText('Collect undone').click();
    await expect.poll(() => planOf(repository.writes, '2026-10-05')?.map((entry: { task: string }) => entry.task)).toEqual([A, B, C]);
});
