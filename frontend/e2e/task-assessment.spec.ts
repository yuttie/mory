import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { API_URL, mockBackend, uuid } from './backend';

const TASK = uuid(1);
const NOTES = {
    [`.tasks/${TASK}.md`]: ['---', 'task:', '  status:', '    kind: todo', '---', '', '# Write the report', ''].join('\n'),
};

// Whether the menu lies wholly below or wholly above the chip, measured once its opening
// transition and Vuetify's placement have finished.
async function besideChip(page: Page, chip: Locator, menu: Locator): Promise<boolean> {
    await expect.poll(() => menu.evaluate((element) => element.getAnimations().length)).toBe(0);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const c = (await chip.boundingBox())!;
    const m = (await menu.boundingBox())!;
    return m.y >= c.y + c.height - 1 || m.y + m.height <= c.y + 1;
}

// The assessment waits behind its score in the editor's header, and a note suggestion added from
// it leaves it open for the next.
test('shows the assessment from its score, open while suggestions go into the note', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.route(`${API_URL}v2/assess-task`, (route) => route.fulfill({
        json: {
            quality_score: 6,
            feedback: 'Say which report.',
            suggestions: ['Name its audience.'],
            note_suggestions: ['## Scope'],
        },
    }));
    await page.goto(`/tasks-next/${TASK}/selected/status`);
    const chip = page.getByRole('button', { name: 'Assessment: 6.0/10' });
    await expect(chip).toBeVisible();
    await expect(page.getByText('Say which report.')).toHaveCount(0);

    await chip.click();
    const assessment = page.locator('.assessment');
    await expect(assessment.getByText('Say which report.')).toBeVisible();
    await expect(assessment.getByText('Name its audience.')).toBeVisible();
    await assessment.getByRole('button', { name: 'Add to note' }).click();
    await expect(page.locator('.cm-content')).toHaveText('## Scope');
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
});

// Vuetify shifts a menu too tall for the room below its activator up over the activator. A long
// assessment is capped to stay beside its chip instead, and scrolls, also once the window has
// shrunk under it while open.
test('keeps a long assessment beside its chip as the window shrinks', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    await mockBackend(context, NOTES);
    await page.route(`${API_URL}v2/assess-task`, (route) => route.fulfill({
        json: {
            quality_score: 6,
            feedback: 'Say which report.',
            suggestions: Array.from({ length: 30 }, (_, i) => `Suggestion ${i + 1}, long enough to wrap onto a second line of the menu.`),
            note_suggestions: [],
        },
    }));
    await page.goto(`/tasks-next/${TASK}/selected/status`);
    const chip = page.getByRole('button', { name: 'Assessment: 6.0/10' });
    await chip.click();
    const card = page.locator('.assessment');
    await expect(card.getByText('Suggestion 1,')).toBeVisible();
    const menu = page.locator('.v-overlay__content').filter({ has: card });
    expect(await besideChip(page, chip, menu)).toBe(true);
    expect(await card.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 420 });
    expect(await besideChip(page, chip, menu)).toBe(true);
});
