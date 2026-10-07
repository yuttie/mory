import { expect, test } from '@playwright/test';
import { API_URL, mockBackend, uuid } from './backend';

const TASK = uuid(1);

// The assessment waits behind its score in the editor's header, and a note suggestion added from
// it leaves it open for the next.
test('shows the assessment from its score, open while suggestions go into the note', async ({ context, page }) => {
    await mockBackend(context, {
        [`.tasks/${TASK}.md`]: ['---', 'task:', '  status:', '    kind: todo', '---', '', '# Write the report', ''].join('\n'),
    });
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
