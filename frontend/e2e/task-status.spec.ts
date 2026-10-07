import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { type Repository, mockBackend, uuid } from './backend';

// Written by hand rather than by the editor -- a comment, two-space indentation, a flow sequence
// and a key the editor has no field for -- so rewriting anything but the status shows.
function note(title: string, status: string[], task: string[] = []): string {
    return [
        '---',
        '# Kept by hand.',
        'task:',
        '  status:',
        ...status.map((line) => `    ${line}`),
        '  progress: 0',
        ...task.map((line) => `  ${line}`),
        'events:',
        '  review:',
        '    start: 2026-10-01 10:00:00+09:00',
        'tags: [work]',
        '---',
        '',
        `# ${title}`,
        '',
    ].join('\n');
}

// The status view on a repository of `notes`, once its tasks are drawn.
async function openStatusView(context: BrowserContext, page: Page, notes: Record<string, string>): Promise<Repository> {
    const repository = await mockBackend(context, notes);
    await page.goto('/tasks-next');
    await expect(page.locator('.status-view .task-list-item').first()).toBeVisible();
    return repository;
}

function column(page: Page, title: string): Locator {
    return page.locator('.status-view .group').filter({
        has: page.locator('.task-group-title', { hasText: new RegExp(`^${title}$`) }),
    });
}

// A task in the columns. The copy that follows the pointer during a drag is drawn outside them.
function task(page: Page, title: string): Locator {
    return page.locator('.status-view .task-list-item', { hasText: title });
}

// Where `locator` is drawn. Throws rather than let a missing element compare equal to another.
async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const found = await locator.boundingBox();
    if (found === null) {
        throw new Error(`Not drawn: ${locator}`);
    }
    return found;
}

// Moves the pointer over the middle of `target`, or onto its bottom edge.
async function moveOver(page: Page, target: Locator, at: 'middle' | 'bottom' = 'middle'): Promise<void> {
    const { x, y, width, height } = await box(target);
    await page.mouse.move(x + width / 2, at === 'bottom' ? y + height : y + height / 2, { steps: 10 });
}

// How far, down and right, the pointer moves to pick up the task it was pressed on. Far enough to
// reach the next card down from the middle of a two-line one.
const LIFT = 80;

async function startDrag(page: Page, item: Locator): Promise<void> {
    // Coordinate events need the same readiness check that locator clicks perform.
    await item.click({ trial: true });
    const { x, y, width, height } = await box(item);
    await page.mouse.move(x + width / 2, y + height / 2);
    await page.mouse.down();
    await page.mouse.move(x + width / 2 + LIFT, y + height / 2 + LIFT, { steps: 5 });
    await expect(page.locator('.sortable-fallback')).toBeVisible();
}

// Measures the target only once the drag is under way: an empty column has no height to drop into
// until a drag opens one.
async function dropOn(page: Page, target: Locator): Promise<void> {
    await moveOver(page, target.locator('.task-list'));
    await page.mouse.up();
}

const ALPHA = `.tasks/${uuid(1)}.md`;
const BETA = `.tasks/${uuid(2)}.md`;
const GAMMA = `.tasks/${uuid(3)}.md`;

// Every column on screen at once -- eight 270px columns and their gaps, beside the 300px task tree --
// so a drop lands where it is aimed rather than past the edge.
test.use({ viewport: { width: 2800, height: 900 } });

test('moves a task to the status it is dropped on, rewriting nothing but the status', async ({ context, page }) => {
    const before = note('Alpha', ['kind: todo']);
    const repository = await openStatusView(context, page, {
        [ALPHA]: before,
        [BETA]: note('Beta', ['kind: in_progress']),
        [GAMMA]: note('Gamma', ['kind: in_progress']),
    });
    const target = column(page, 'In progress');
    const { height } = await box(target);

    await startDrag(page, task(page, 'Alpha'));
    // Held between two tasks: the column is ordered by date, so no gap may open there as if the
    // task could be placed between them. The column is marked instead.
    await moveOver(page, task(page, 'Beta'), 'bottom');
    await expect(target).toHaveCSS('outline-style', 'solid');
    expect((await box(target)).height).toBe(height);
    await dropOn(page, target);

    await expect(target).toContainText('Alpha');
    await expect(column(page, 'To do')).not.toContainText('Alpha');
    await expect.poll(() => repository.writes).toEqual([
        { path: ALPHA, content: before.replace('    kind: todo', '    kind: in_progress') },
    ]);
});

test('keeps the dragged task\'s place open, and only that, wherever it is held', async ({ context, page }) => {
    const repository = await openStatusView(context, page, {
        [ALPHA]: note('Alpha', ['kind: todo']),
        [BETA]: note('Beta', ['kind: todo']),
        [GAMMA]: note('Gamma', ['kind: in_progress']),
    });
    const list = column(page, 'To do').locator('.task-list');
    const items = list.locator('.task-list-item');
    await expect(items).toHaveCount(2);
    const { height } = await box(list);
    const next = items.nth(1);
    const { y: place } = await box(next);
    // The column's height and where the next task sits, together: one gap, at the task's place.
    const unchanged = async () => {
        await expect.poll(async () => (await box(list)).height).toBe(height);
        await expect.poll(async () => (await box(next)).y).toBe(place);
    };

    // Lifted onto the next task: a gap that followed the pointer would move below it.
    const first = await box(items.nth(0));
    expect(first.y + first.height / 2 + LIFT).toBeGreaterThan(place);
    await startDrag(page, items.nth(0));
    await unchanged();

    // Over another column, the task's place is still held open in its own.
    await moveOver(page, task(page, 'Gamma'));
    await expect(column(page, 'In progress')).toHaveCSS('outline-style', 'solid');
    await unchanged();

    // And back again, over the next task.
    await moveOver(page, next);
    await unchanged();
    await page.mouse.up();

    expect(repository.writes).toEqual([]);
});

test('shows every field of Waiting, and writes the ones filled in', async ({ context, page }) => {
    const before = note('Alpha', ['kind: todo']);
    const repository = await openStatusView(context, page, { [ALPHA]: before });

    await startDrag(page, task(page, 'Alpha'));
    await dropOn(page, column(page, 'Waiting'));

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Move to Waiting');
    await expect(dialog.getByRole('textbox', { name: 'Waiting for' })).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'Expected by (optional)' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Contact (optional)' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Follow up at (optional)' })).toBeVisible();

    // A required field is checked when the move is asked for, as the editor checks it on save.
    await dialog.getByRole('button', { name: 'Move' }).click();
    await expect(dialog).toContainText('Waiting for is required.');
    expect(repository.writes).toEqual([]);

    await dialog.getByRole('textbox', { name: 'Waiting for' }).fill('the figures');
    await dialog.getByRole('combobox', { name: 'Contact (optional)' }).fill('Alice');
    await dialog.getByRole('button', { name: 'Move' }).click();

    await expect(column(page, 'Waiting')).toContainText('Alpha');
    // The two dates were left empty, so they are left out rather than written empty.
    await expect.poll(() => repository.writes).toEqual([
        {
            path: ALPHA,
            content: before.replace('    kind: todo', '    kind: waiting\n    waiting_for: the figures\n    contact: Alice'),
        },
    ]);
});

test('leaves the task where it was when the move is canceled', async ({ context, page }) => {
    const repository = await openStatusView(context, page, { [ALPHA]: note('Alpha', ['kind: todo']) });

    await startDrag(page, task(page, 'Alpha'));
    await dropOn(page, column(page, 'Blocked'));
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toBeHidden();
    await expect(column(page, 'To do')).toContainText('Alpha');
    await expect(column(page, 'Blocked')).not.toContainText('Alpha');
    expect(repository.writes).toEqual([]);
});

test('shows Done with the time it was dropped filled in', async ({ context, page }) => {
    const repository = await openStatusView(context, page, { [ALPHA]: note('Alpha', ['kind: in_progress']) });

    await startDrag(page, task(page, 'Alpha'));
    await dropOn(page, column(page, 'Done'));

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Move to Done');
    await expect(dialog.getByRole('textbox', { name: 'Completed at' })).toHaveValue(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    await expect(dialog.getByRole('textbox', { name: 'Completion note (optional)' })).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Completion note (optional)' }).fill('Shipped');
    await dialog.getByRole('button', { name: 'Move' }).click();

    await expect(column(page, 'Done')).toContainText('Alpha');
    await expect.poll(() => repository.writes.length).toBe(1);
    expect(repository.writes[0].content).toMatch(
        /\n {4}kind: done\n {4}completed_at: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\n {4}completion_note: Shipped\n {2}progress: 0\n/,
    );
});

test('keeps the tasks a dragged one passes over from answering the pointer', async ({ context, page }) => {
    await openStatusView(context, page, {
        [ALPHA]: note('Alpha', ['kind: todo']),
        [BETA]: note('Beta', ['kind: in_progress'], ['due_by: 2026-10-01']),
    });
    const beta = task(page, 'Beta');
    const due = beta.locator('.task-date-cue[data-field="due_by"]');
    // What the date's tooltip says: the row itself says how far off the date is instead.
    const tooltip = page.getByRole('tooltip').getByText('Due: 2026-10-01', { exact: true });
    // The hover shade is the card's overlay, shown by its opacity.
    const shade = () => beta.evaluate((element) => getComputedStyle(element.querySelector(':scope > .v-card__overlay')!).opacity);
    const resting = await shade();

    // At rest a task answers the pointer, which is what a drag must not look like.
    await due.hover();
    await expect(beta).toHaveCSS('cursor', 'pointer');
    await expect.poll(shade).not.toBe(resting);
    await expect(tooltip).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();

    await startDrag(page, task(page, 'Alpha'));
    await moveOver(page, due);
    // Long enough for the tooltip to open, were it going to.
    await page.waitForTimeout(500);
    await expect(beta).not.toHaveCSS('cursor', 'pointer');
    await expect.poll(shade).toBe(resting);
    await expect(tooltip).toBeHidden();

    // Let go over Beta's date: the column still takes the task.
    await page.mouse.up();
    await expect(column(page, 'In progress')).toContainText('Alpha');
});

test('refuses a status the task cannot move to, and says so while it is dragged', async ({ context, page }) => {
    const repository = await openStatusView(context, page, {
        [ALPHA]: note('Alpha', ['kind: in_progress']),
        // A task gives the refused column something to drop onto: an empty one has no height,
        // and a drop that missed it would pass without the refusal being tried.
        [BETA]: note('Beta', ['kind: todo']),
    });

    await startDrag(page, task(page, 'Alpha'));
    // In progress goes forward only: back to To do or Backlog is the editor's, unlocked.
    await expect(column(page, 'To do')).toHaveClass(/refused/);
    await expect(column(page, 'Backlog')).toHaveClass(/refused/);
    await expect(column(page, 'Done')).not.toHaveClass(/refused/);
    await dropOn(page, column(page, 'To do'));

    await expect(column(page, 'To do')).not.toHaveClass(/refused/);
    await expect(column(page, 'In progress')).toContainText('Alpha');
    await expect(column(page, 'To do')).not.toContainText('Alpha');
    expect(repository.writes).toEqual([]);
});

test.describe('on iOS', () => {
    // Sortable places the copy that follows the pointer differently on iOS, which it tells by the
    // user agent alone.
    test.use({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    });

    test('keeps the dragged task in sight over another column', async ({ context, page }) => {
        await openStatusView(context, page, { [ALPHA]: note('Alpha', ['kind: todo']) });

        await startDrag(page, task(page, 'Alpha'));
        await moveOver(page, column(page, 'Done').locator('.task-list'));
        await expect(column(page, 'Done')).toHaveCSS('outline-style', 'solid');
        await expect(page.locator('.task-list-item.sortable-drag')).toBeInViewport();
        await page.mouse.up();
    });
});
