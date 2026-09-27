import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import YAML from 'yaml';
import { API_URL } from './backend';

const TOKEN = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJlMmUiLCJlbWFpbCI6ImVAZS5pbnZhbGlkIiwiZXhwIjo0MTAyNDQ0ODAwfQ.';

function uuid(n: number): string {
    return `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

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

interface Repository {
    writes: { path: string; content: string }[];
}

// A repository of notes, listed with the metadata their frontmatter holds, so a write shows up in
// the listing the way the backend would show it.
async function mockBackend(context: BrowserContext, notes: Record<string, string>): Promise<Repository> {
    const files = new Map(Object.entries(notes));
    const repository: Repository = { writes: [] };
    let commit = 1;
    const commitId = () => String(commit).padStart(40, '0');

    await context.addInitScript((token) => {
        window.localStorage.setItem('token', JSON.stringify(token));
    }, TOKEN);
    await context.route(`${API_URL}**`, async (route) => {
        const request = route.request();
        const path = decodeURIComponent(new URL(request.url()).pathname);
        if (path === '/api/v2/entries') {
            const entries = [...files].map(([notePath, content]) => ({
                path: notePath,
                size: content.length,
                mime_type: 'text/markdown',
                metadata: YAML.parse(content.split(/^---$/m)[1]),
                title: /^# (.*)$/m.exec(content.split(/^---$/m)[2])?.[1] ?? null,
                time: '2026-09-01T12:00:00+00:00',
            }));
            await route.fulfill({ json: { kind: 'full', commit: commitId(), head: commitId(), entries } });
            return;
        }
        if (path === '/api/v2/commits/head') {
            await route.fulfill({ json: commitId() });
            return;
        }
        if (path === '/api/login') {
            await route.fulfill({ json: TOKEN });
            return;
        }
        if (path.startsWith('/api/notes/')) {
            const notePath = path.slice('/api/notes/'.length);
            if (request.method() === 'PUT') {
                const content = request.postDataJSON().Save.content as string;
                files.set(notePath, content);
                repository.writes.push({ path: notePath, content });
                commit += 1;
                await route.fulfill({ json: null });
                return;
            }
            const content = files.get(notePath);
            if (content === undefined) {
                await route.fulfill({ status: 404, json: {} });
                return;
            }
            await route.fulfill({ body: content, contentType: 'text/markdown' });
            return;
        }
        await route.fulfill({ json: [] });
    });
    return repository;
}

function column(page: Page, title: string): Locator {
    return page.locator('.status-view .group').filter({
        has: page.locator('.v-card-title', { hasText: new RegExp(`^${title}$`) }),
    });
}

// Picks the task up, and measures the target only once the drag is under way: an empty column
// has no height to drop into until a drag opens one.
async function startDrag(page: Page, item: Locator): Promise<void> {
    const from = await item.boundingBox();
    if (from === null) {
        throw new Error('The task to drag is not visible.');
    }
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 5 });
}

async function dropOn(page: Page, target: Locator): Promise<void> {
    const to = await target.locator('.task-list').boundingBox();
    if (to === null) {
        throw new Error('The column to drop on is not visible.');
    }
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
}

const ALPHA = `.tasks/${uuid(1)}.md`;
const BETA = `.tasks/${uuid(2)}.md`;
const GAMMA = `.tasks/${uuid(3)}.md`;

// Every column on screen at once, so a drop lands where it is aimed rather than past the edge.
test.use({ viewport: { width: 2800, height: 900 } });

test('moves a task to the status it is dropped on, rewriting nothing but the status', async ({ context, page }) => {
    const before = note('Alpha', ['kind: todo']);
    const repository = await mockBackend(context, {
        [ALPHA]: before,
        [BETA]: note('Beta', ['kind: in_progress']),
        [GAMMA]: note('Gamma', ['kind: in_progress']),
    });
    await page.goto('/tasks-next');
    await expect(column(page, 'To do')).toContainText('Alpha');
    const target = column(page, 'In progress');
    const height = (await target.boundingBox())?.height;

    await startDrag(page, page.locator('.task-list-item', { hasText: 'Alpha' }));
    // Held between two tasks: the column is ordered by date, so no gap may open there as if the
    // task could be placed between them. The column is marked instead.
    const beta = await page.locator('.task-list-item', { hasText: 'Beta' }).boundingBox();
    if (beta === null) {
        throw new Error('Beta is not visible.');
    }
    await page.mouse.move(beta.x + beta.width / 2, beta.y + beta.height, { steps: 10 });
    await expect(target).toHaveCSS('outline-style', 'solid');
    expect((await target.boundingBox())?.height).toBe(height);
    await dropOn(page, target);

    await expect(target).toContainText('Alpha');
    await expect(column(page, 'To do')).not.toContainText('Alpha');
    await expect.poll(() => repository.writes).toEqual([
        { path: ALPHA, content: before.replace('    kind: todo', '    kind: in_progress') },
    ]);
});

test('keeps the dragged task\'s place open, and only that, wherever it is held', async ({ context, page }) => {
    const repository = await mockBackend(context, {
        [ALPHA]: note('Alpha', ['kind: todo']),
        [BETA]: note('Beta', ['kind: todo']),
        [GAMMA]: note('Gamma', ['kind: in_progress']),
    });
    await page.goto('/tasks-next');
    const list = column(page, 'To do').locator('.task-list');
    const items = list.locator('.task-list-item');
    await expect(items).toHaveCount(2);
    const height = (await list.boundingBox())?.height;
    // Not `.sortable-drag`, the copy following the pointer.
    const next = list.locator('.task-list-item:not(.sortable-drag)').nth(1);
    const place = (await next.boundingBox())?.y;
    // The column's height and where the next task sits, together: one gap, at the task's place.
    const unchanged = async () => {
        await expect.poll(async () => (await list.boundingBox())?.height).toBe(height);
        await expect.poll(async () => (await next.boundingBox())?.y).toBe(place);
    };

    // Moved 20px down, over the next task: a gap that followed the pointer would move below it.
    await startDrag(page, items.nth(0));
    await unchanged();

    // Over another column, the task's place is still held open in its own.
    const gamma = await column(page, 'In progress').locator('.task-list-item', { hasText: 'Gamma' }).boundingBox();
    if (gamma === null) {
        throw new Error('Gamma is not visible.');
    }
    await page.mouse.move(gamma.x + gamma.width / 2, gamma.y + gamma.height / 2, { steps: 10 });
    await expect(column(page, 'In progress')).toHaveCSS('outline-style', 'solid');
    await unchanged();

    // And back again, over the next task.
    const back = await next.boundingBox();
    if (back === null) {
        throw new Error('The next task is not visible.');
    }
    await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2, { steps: 10 });
    await unchanged();
    await page.mouse.up();

    expect(repository.writes).toEqual([]);
});

test('shows every field of Waiting, and writes the ones filled in', async ({ context, page }) => {
    const before = note('Alpha', ['kind: todo']);
    const repository = await mockBackend(context, { [ALPHA]: before });
    await page.goto('/tasks-next');
    await expect(column(page, 'To do')).toContainText('Alpha');

    await startDrag(page, page.locator('.task-list-item', { hasText: 'Alpha' }));
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
    const repository = await mockBackend(context, { [ALPHA]: note('Alpha', ['kind: todo']) });
    await page.goto('/tasks-next');
    await expect(column(page, 'To do')).toContainText('Alpha');

    await startDrag(page, page.locator('.task-list-item', { hasText: 'Alpha' }));
    await dropOn(page, column(page, 'Blocked'));
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toBeHidden();
    await expect(column(page, 'To do')).toContainText('Alpha');
    await expect(column(page, 'Blocked')).not.toContainText('Alpha');
    expect(repository.writes).toEqual([]);
});

test('shows Done with the time it was dropped filled in', async ({ context, page }) => {
    const repository = await mockBackend(context, { [ALPHA]: note('Alpha', ['kind: in_progress']) });
    await page.goto('/tasks-next');
    await expect(column(page, 'In progress')).toContainText('Alpha');

    await startDrag(page, page.locator('.task-list-item', { hasText: 'Alpha' }));
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
    await mockBackend(context, {
        [ALPHA]: note('Alpha', ['kind: todo']),
        [BETA]: note('Beta', ['kind: in_progress'], ['due_by: 2026-10-01']),
    });
    await page.goto('/tasks-next');
    // Not `.sortable-drag`, the copy following the pointer: it is never Beta, but say so.
    const beta = page.locator('.task-list-item:not(.sortable-drag)', { hasText: 'Beta' });
    const due = beta.locator('.additional-info').first();
    const tooltip = page.locator('.v-tooltip .v-overlay__content');

    // At rest a task answers the pointer, which is what a drag must not look like.
    await due.hover();
    await expect(beta).toHaveCSS('cursor', 'pointer');
    await expect(beta).toHaveCSS('background-color', 'rgb(238, 238, 238)');
    await expect(tooltip).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();

    await startDrag(page, page.locator('.task-list-item', { hasText: 'Alpha' }));
    const box = await due.boundingBox();
    if (box === null) {
        throw new Error('Beta\'s due date is not visible.');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
    await page.waitForTimeout(500);
    await expect(beta).not.toHaveCSS('cursor', 'pointer');
    await expect(beta).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(tooltip).toBeHidden();

    // Let go over Beta's date: the column still takes the task.
    await page.mouse.up();
    await expect(column(page, 'In progress')).toContainText('Alpha');
});

test('refuses a status the task cannot move to, and says so while it is dragged', async ({ context, page }) => {
    const repository = await mockBackend(context, {
        [ALPHA]: note('Alpha', ['kind: in_progress']),
        [BETA]: note('Beta', ['kind: todo']),
    });
    await page.goto('/tasks-next');
    await expect(column(page, 'In progress')).toContainText('Alpha');

    await startDrag(page, page.locator('.task-list-item', { hasText: 'Alpha' }));
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
        await mockBackend(context, { [ALPHA]: note('Alpha', ['kind: todo']) });
        await page.goto('/tasks-next');
        await expect(column(page, 'To do')).toContainText('Alpha');

        await startDrag(page, page.locator('.task-list-item', { hasText: 'Alpha' }));
        const done = await column(page, 'Done').locator('.task-list').boundingBox();
        if (done === null) {
            throw new Error('The Done column is not visible.');
        }
        await page.mouse.move(done.x + done.width / 2, done.y + done.height / 2, { steps: 10 });
        await expect(column(page, 'Done')).toHaveCSS('outline-style', 'solid');
        await expect(page.locator('.task-list-item.sortable-drag')).toBeInViewport();
        await page.mouse.up();
    });
});
