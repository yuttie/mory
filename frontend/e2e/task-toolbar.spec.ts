import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { mockBackend, uuid } from './backend';

const PROJECT = uuid(1);
const NOTES = {
    [`.tasks/${PROJECT}.md`]: ['---', 'task:', '  status:', '    kind: todo', '---', '', '# Project', ''].join('\n'),
};

// Whether all of `inner` is drawn within `outer`, which clips what overflows it.
async function within(inner: Locator, outer: Locator): Promise<boolean> {
    const i = (await inner.boundingBox())!;
    const o = (await outer.boundingBox())!;
    return i.x >= o.x - 0.5 && i.x + i.width <= o.x + o.width + 0.5;
}

// The list shares the window with the drawer and the tree, so the toolbar is narrower than the
// window says: labels sized by the window pushed the view modes out of it.
for (const width of [360, 840, 1200, 1400]) {
    test(`keeps every view mode and button whole in the toolbar ${width}px wide`, async ({ context, page }) => {
        await page.setViewportSize({ width, height: 800 });
        await mockBackend(context, NOTES);
        await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
        const toolbar = page.locator('.item-view .v-toolbar');
        const views = toolbar.locator('.v-btn-group');
        await expect(views).toBeVisible();
        for (const name of ['Status', 'Schedule', 'Eisenhower Matrix']) {
            expect(await within(views.getByRole('button', { name, exact: true }), views), name).toBe(true);
        }
        for (const name of ['Add', 'Edit', ...(width < 600 ? [] : ['Quick add'])]) {
            const button = toolbar.getByTitle(name, { exact: true });
            expect(await within(button, toolbar), name).toBe(true);
        }
    });
}

// Without its label, a button is no wider than its icon needs.
test('draws a button square on a phone', async ({ context, page }) => {
    await page.setViewportSize({ width: 360, height: 680 });
    await mockBackend(context, NOTES);
    await page.goto(`/tasks-next/${PROJECT}/descendants/status`);
    for (const name of ['Add', 'Edit', 'Status']) {
        const box = (await page.locator('.item-view .v-toolbar').getByTitle(name, { exact: true }).boundingBox())!;
        expect(box.width, name).toBe(box.height);
    }
});
