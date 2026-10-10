import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

function note(title: string, { tags = [] }: { tags?: string[] } = {}): string {
    return [
        '---',
        'task:',
        '  status:',
        '    kind: todo',
        ...(tags.length > 0 ? [`tags: [${tags.join(', ')}]`] : []),
        '---',
        '',
        `# ${title}`,
        '',
    ].join('\n');
}

const PROJECT = uuid(1);
const PHASE = uuid(2);
const STEP = uuid(3);
// A second task with a child, so it stays at the top of the tree beside Project.
const OTHER = uuid(4);
const CHORE = uuid(5);
// A root task with no children, which the tree files under its tag.
const ERRAND = uuid(6);

const NOTES = {
    [`.tasks/${PROJECT}.md`]: note('Project'),
    [`.tasks/${PROJECT}/${PHASE}.md`]: note('Phase'),
    [`.tasks/${PROJECT}/${PHASE}/${STEP}.md`]: note('Step'),
    [`.tasks/${OTHER}.md`]: note('Other'),
    [`.tasks/${OTHER}/${CHORE}.md`]: note('Chore'),
    [`.tasks/${ERRAND}.md`]: note('Errand', { tags: ['work'] }),
};

function tree(page: Page): Locator {
    return page.locator('.task-tree-container');
}

function row(page: Page, name: string): Locator {
    return tree(page).getByRole('treeitem', { name });
}

// The copy of the dragged task that follows the pointer.
function copy(page: Page): Locator {
    return page.locator('.entry-tree-drag-copy');
}

// Where `locator` is drawn. Throws rather than let a missing element compare equal to another.
async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const found = await locator.boundingBox();
    if (found === null) {
        throw new Error(`Not drawn: ${locator}`);
    }
    return found;
}

// Moves the pointer over the middle of `target`.
async function moveOver(page: Page, target: Locator): Promise<void> {
    const { x, y, width, height } = await box(target);
    await page.mouse.move(x + width / 2, y + height / 2, { steps: 5 });
}

async function pickUp(page: Page, task: Locator): Promise<void> {
    // A branch just opened is still growing, and its rows move with it until it stops. Not checked
    // again during the drag: Playwright's check moves its own idea of the pointer, after which Chrome
    // sends no click on release, and the click the drag has to stop is never there to stop.
    await task.click({ trial: true });
    await moveOver(page, task);
    await page.mouse.down();
    const { x, y } = await box(task);
    await page.mouse.move(x + 20, y + 30, { steps: 3 });
    await expect(copy(page)).toBeVisible();
}

// The tree with Project and Phase open, and Other and the tag group closed. Nothing is selected: a
// selected task opens the tree to itself whenever it moves, which would hide what a drop opens.
async function openTree(page: Page): Promise<void> {
    await page.goto('/tasks-next/_/descendants/status');
    for (const name of ['Project', 'Phase']) {
        await row(page, name).locator('.v-list-item__prepend button').click();
    }
    await expect(row(page, 'Step')).toBeVisible();
    // Until the branches have grown to their height, Playwright finds the rows in them clipped and
    // scrolls the tree to show them.
    await expect.poll(() => tree(page).evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
}

test('moves a task, and everything under it, under the task it is dropped on', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openTree(page);

    await pickUp(page, row(page, 'Phase'));
    await expect(copy(page)).toContainText('Phase');
    await moveOver(page, row(page, 'Other'));
    await expect(row(page, 'Other')).toHaveCSS('outline-style', 'solid');
    await page.mouse.up();

    await expect.poll(() => repository.renames).toEqual([
        { from: `.tasks/${PROJECT}/${PHASE}.md`, to: `.tasks/${OTHER}/${PHASE}.md` },
        { from: `.tasks/${PROJECT}/${PHASE}/${STEP}.md`, to: `.tasks/${OTHER}/${PHASE}/${STEP}.md` },
    ]);
    await expect(copy(page)).toHaveCount(0);
    // Other is opened to show where the task went.
    await expect(row(page, 'Other')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'Phase')).toHaveAttribute('aria-level', '2');
    await expect(row(page, 'Other')).toHaveCSS('outline-style', 'none');
    expect(repository.writes).toEqual([]);
});

test('dims the tasks the dragged one cannot go under, and refuses a drop on them', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openTree(page);

    await pickUp(page, row(page, 'Phase'));
    // Itself, the task under it, and the parent it already has.
    for (const name of ['Phase', 'Step', 'Project']) {
        await expect(row(page, name)).toHaveClass(/tree-drop-refused/);
    }
    await expect(row(page, 'Other')).not.toHaveClass(/tree-drop-refused/);

    await moveOver(page, row(page, 'Step'));
    await expect(row(page, 'Step')).toHaveCSS('outline-style', 'none');
    await page.mouse.up();

    await expect(row(page, 'Step')).not.toHaveClass(/tree-drop-refused/);
    // Long enough for a move to have been asked for, were one going to be.
    await page.waitForTimeout(300);
    expect(repository.renames).toEqual([]);
});

test('moves a task to the top when dropped on the group of its tag', async ({ context, page }) => {
    const repository = await mockBackend(context, {
        ...NOTES,
        [`.tasks/${PROJECT}/${PHASE}.md`]: note('Phase', { tags: ['work'] }),
        // Gives the tree a group of another tag.
        [`.tasks/${uuid(7)}.md`]: note('Laundry', { tags: ['home'] }),
    });
    await openTree(page);

    await pickUp(page, row(page, 'Phase'));
    // Moved to the top, Phase would be filed under its own tag, not under whichever was chosen.
    await expect(row(page, 'home')).toHaveClass(/tree-drop-refused/);
    await expect(row(page, 'work')).not.toHaveClass(/tree-drop-refused/);
    await moveOver(page, row(page, 'work'));
    await expect(row(page, 'work')).toHaveCSS('outline-style', 'solid');
    await page.mouse.up();

    await expect.poll(() => repository.renames).toEqual([
        { from: `.tasks/${PROJECT}/${PHASE}.md`, to: `.tasks/${PHASE}.md` },
        { from: `.tasks/${PROJECT}/${PHASE}/${STEP}.md`, to: `.tasks/${PHASE}/${STEP}.md` },
    ]);
    // With Step under it, Phase is drawn at the top rather than in the group.
    await expect(row(page, 'Phase')).toHaveAttribute('aria-level', '1');
});

test('refuses its own group to a task already at the top', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await openTree(page);
    await row(page, 'work').locator('.v-list-item__prepend button').click();

    await pickUp(page, row(page, 'Errand'));
    await expect(row(page, 'work')).toHaveClass(/tree-drop-refused/);
    await page.mouse.up();
});

test('opens nothing when the task is let go where it was picked up', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openTree(page);
    const url = page.url();

    await pickUp(page, row(page, 'Phase'));
    await moveOver(page, row(page, 'Phase'));
    await page.mouse.up();

    await expect(copy(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(page.url()).toBe(url);
    expect(repository.renames).toEqual([]);

    // The click after it is the user's own again.
    await row(page, 'Phase').click();
    await expect(page).toHaveURL(new RegExp(`/tasks-next/${PHASE}/selected/status$`));
});

test('puts the task back when Escape is pressed during the drag', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await openTree(page);

    await pickUp(page, row(page, 'Phase'));
    await moveOver(page, row(page, 'Other'));
    await page.keyboard.press('Escape');
    await expect(copy(page)).toHaveCount(0);
    await expect(row(page, 'Other')).toHaveCSS('outline-style', 'none');
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(repository.renames).toEqual([]);
});

test('keeps the tasks a dragged one passes over from answering the pointer', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await openTree(page);
    const other = row(page, 'Other');
    const add = other.getByRole('button', { name: 'Add child task', includeHidden: true });
    // The hover shade is the row's overlay, shown by its opacity.
    const shade = () => other.evaluate((element) => getComputedStyle(element.querySelector(':scope > .v-list-item__overlay')!).opacity);
    const resting = await shade();

    // At rest a row answers the pointer, which is what a drag must not look like.
    await other.hover();
    await expect(other).toHaveCSS('cursor', 'pointer');
    await expect.poll(shade).not.toBe(resting);
    await expect(add).toBeVisible();
    await page.mouse.move(0, 0);

    await pickUp(page, row(page, 'Phase'));
    await moveOver(page, other);
    await expect(other).not.toHaveCSS('cursor', 'pointer');
    await expect.poll(shade).toBe(resting);
    expect(await add.evaluate((element) => getComputedStyle(element).visibility)).toBe('hidden');
    await page.mouse.up();
});

test('leaves the task being edited where it is while it has unsaved changes', async ({ context, page }) => {
    const repository = await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PHASE}/selected/status`);
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Phase one');

    // Moving the task above it would move it too.
    await pickUp(page, row(page, 'Project'));
    await moveOver(page, row(page, 'Other'));
    await page.mouse.up();

    await expect(page.locator('.v-snackbar')).toContainText('Save or discard the changes to "Phase" before moving "Project".');
    expect(repository.renames).toEqual([]);
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Phase one');

    // A task the edited one is not under still moves, under the edited one too.
    await pickUp(page, row(page, 'Other'));
    await moveOver(page, row(page, 'Phase'));
    await page.mouse.up();
    await expect.poll(() => repository.renames.map(({ from }) => from)).toEqual([
        `.tasks/${OTHER}.md`,
        `.tasks/${OTHER}/${CHORE}.md`,
    ]);
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Phase one');
});

test('scrolls the tree while the task is held near its edge, to a task out of sight', async ({ context, page }) => {
    // Enough tasks under Project for Other to be out of sight below them, and no tag group below
    // Other, so it is the last row.
    const items = Object.fromEntries(Array.from({ length: 40 }, (_, n) => [`.tasks/${PROJECT}/${uuid(100 + n)}.md`, note(`Item ${n}`)]));
    const notes: Record<string, string> = { ...NOTES, ...items };
    delete notes[`.tasks/${ERRAND}.md`];
    const repository = await mockBackend(context, notes);
    await openTree(page);
    const scroller = tree(page).locator('.entry-tree');
    const scrolled = () => scroller.evaluate((element) => element.scrollTop);
    await expect(row(page, 'Other')).not.toBeInViewport();

    await pickUp(page, row(page, 'Phase'));
    const area = await box(scroller);
    // Held in the middle, the tree stays put.
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2, { steps: 3 });
    await page.waitForTimeout(300);
    expect(await scrolled()).toBe(0);

    // Near the bottom, it scrolls down to its end, which brings Other under the pointer.
    const bottom = () => page.mouse.move(area.x + area.width / 2, area.y + area.height - 12, { steps: 3 });
    const atEnd = () => scroller.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1);
    await bottom();
    await expect.poll(atEnd).toBe(true);
    const end = await scrolled();

    // Near the top, it scrolls back up.
    await page.mouse.move(area.x + area.width / 2, area.y + 12, { steps: 3 });
    await expect.poll(scrolled).toBeLessThan(end - 100);

    await bottom();
    await expect.poll(atEnd).toBe(true);
    await expect(row(page, 'Other')).toHaveCSS('outline-style', 'solid');

    // Let go without moving: the row the tree scrolled under the pointer is where it goes.
    await page.mouse.up();
    await expect.poll(() => repository.renames.map(({ from }) => from)).toEqual([
        `.tasks/${PROJECT}/${PHASE}.md`,
        `.tasks/${PROJECT}/${PHASE}/${STEP}.md`,
    ]);
    expect(repository.renames[0].to).toBe(`.tasks/${OTHER}/${PHASE}.md`);
});

test.describe('on a touch screen', () => {
    test.use({ hasTouch: true });

    // A finger on the page, moved by CDP: Playwright's own touch input only taps.
    async function finger(context: BrowserContext, page: Page, at: Locator) {
        const client = await context.newCDPSession(page);
        const start = await box(at);
        let x = start.x + start.width / 2;
        let y = start.y + start.height / 2;
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        return {
            async moveTo(point: { x: number; y: number }) {
                for (let step = 1; step <= 5; step++) {
                    await client.send('Input.dispatchTouchEvent', {
                        type: 'touchMove',
                        touchPoints: [{ x: x + (point.x - x) * step / 5, y: y + (point.y - y) * step / 5 }],
                    });
                }
                ({ x, y } = point);
            },
            async moveOver(target: Locator) {
                const found = await box(target);
                await this.moveTo({ x: found.x + found.width / 2, y: found.y + found.height / 2 });
            },
            async lift() {
                await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            },
        };
    }

    test('picks a task up with a long press, and moves it where it is let go', async ({ browserName, context, page }) => {
        test.skip(browserName !== 'chromium', 'CDP supplies real touch movement in Chromium.');
        const repository = await mockBackend(context, NOTES);
        await openTree(page);
        const phase = row(page, 'Phase');
        await phase.click({ trial: true });

        const held = await finger(context, page, phase);
        // A short press is still a tap.
        await page.waitForTimeout(200);
        await expect(copy(page)).toHaveCount(0);
        // A long press is not the link's menu, which would take the touch over.
        const prevented = await phase.evaluate((element) => !element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
        expect(prevented).toBe(true);
        await page.waitForTimeout(400);
        // Picked up where the finger rests, before it moves.
        await expect(copy(page)).toBeVisible();
        await expect(copy(page)).toBeInViewport();

        await held.moveOver(row(page, 'Other'));
        await expect(row(page, 'Other')).toHaveCSS('outline-style', 'solid');
        await held.lift();

        await expect.poll(() => repository.renames.map(({ from }) => from)).toEqual([
            `.tasks/${PROJECT}/${PHASE}.md`,
            `.tasks/${PROJECT}/${PHASE}/${STEP}.md`,
        ]);
    });

    test('picks nothing up with a finger that moves at once, which is scrolling', async ({ browserName, context, page }) => {
        test.skip(browserName !== 'chromium', 'CDP supplies real touch movement in Chromium.');
        const repository = await mockBackend(context, NOTES);
        await openTree(page);
        const phase = row(page, 'Phase');
        await phase.click({ trial: true });
        const url = page.url();

        const swiping = await finger(context, page, phase);
        const { x, y } = await box(phase);
        await swiping.moveTo({ x: x + 40, y: y + 40 });
        await page.waitForTimeout(700);
        await expect(copy(page)).toHaveCount(0);
        await swiping.moveOver(row(page, 'Other'));
        await swiping.lift();

        await expect(row(page, 'Other')).toHaveCSS('outline-style', 'none');
        await page.waitForTimeout(300);
        expect(repository.renames).toEqual([]);
        expect(page.url()).toBe(url);
    });

    test('keeps the tree from scrolling under a task being dragged', async ({ browserName, context, page }) => {
        test.skip(browserName !== 'chromium', 'CDP supplies real touch movement in Chromium.');
        // Enough tasks under Project for the tree to scroll.
        const items = Object.fromEntries(Array.from({ length: 40 }, (_, n) => [`.tasks/${PROJECT}/${uuid(100 + n)}.md`, note(`Item ${n}`)]));
        await mockBackend(context, { ...NOTES, ...items });
        await openTree(page);
        const scroller = tree(page).locator('.entry-tree');
        expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
        const item = tree(page).getByRole('treeitem', { name: 'Item 10', exact: true });
        await item.click({ trial: true });
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);

        const held = await finger(context, page, item);
        await page.waitForTimeout(600);
        await expect(copy(page)).toBeVisible();
        // Up the middle of the tree, away from either edge: a finger moving up scrolls what is
        // under it down.
        const { x, y } = await box(item);
        await held.moveTo({ x: x + 40, y: y - 150 });
        await expect(copy(page)).toBeVisible();
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);
        await held.lift();
    });
});
