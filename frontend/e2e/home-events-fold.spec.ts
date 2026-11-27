import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend, uuid } from './backend';

test.use({ timezoneId: 'Asia/Tokyo' });

function task(title: string, status: string, dueBy: string): string {
    return ['---', 'task:', '  status:', `    kind: ${status}`, `  due_by: ${dueBy}`, '---', '', `# ${title}`, ''].join('\n');
}

const NOTES = {
    [`.tasks/${uuid(1)}.md`]: task('Still to do', 'todo', '2026-10-04'),
    [`.tasks/${uuid(2)}.md`]: task('Already done', 'done', '2026-10-04'),
    [`.tasks/${uuid(3)}.md`]: task('Dropped', 'canceled', '2026-10-04'),
    [`.tasks/${uuid(4)}.md`]: task('Done early', 'done', '2026-10-05'),
    // Late is after every finished event of its day, so only a day drawing its finished events
    // after the rest draws it before them.
    'meetings.md': [
        '---',
        'events:',
        '  Retro:',
        '    start: 2026-10-04 09:00:00+09:00',
        '    finished: true',
        '  Late:',
        '    start: 2026-10-04 18:00:00+09:00',
        '---',
        '',
        '# Meetings',
        '',
    ].join('\n'),
};

// By its whole title, as "Tomorrow" is also in "Day After Tomorrow".
function day(page: Page, title: string): Locator {
    return page.locator('.event-column').filter({
        has: page.locator('.v-card-title').getByText(title, { exact: true }),
    });
}

function names(column: Locator): Locator {
    return column.locator('.event-name');
}

function fold(column: Locator): Locator {
    return column.locator('.finished-fold');
}

test('folds a day\'s finished events after the rest until asked for', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T03:00:00Z'));
    await mockBackend(context, NOTES);
    await page.goto('/');

    const today = day(page, 'Today');
    await expect(names(today)).toHaveText(['DueStill to do', 'Late']);
    await expect(fold(today)).toHaveText('Show 3 finished');
    await expect(fold(today)).toHaveAccessibleDescription('Today');

    await fold(today).click();
    // In time order after the rest, the fold after them.
    await expect(names(today)).toHaveText(['DueStill to do', 'Late', 'DueAlready done', 'DueDropped', 'Retro']);
    await expect(fold(today)).toHaveText('Hide 3 finished');
    // Each day is its own.
    await expect(names(day(page, 'Tomorrow'))).toHaveCount(0);

    await fold(today).press('Enter');
    await expect(names(today)).toHaveText(['DueStill to do', 'Late']);
});

test('draws a day of finished events as the fold alone', async ({ context, page }) => {
    await page.clock.setFixedTime(new Date('2026-10-04T03:00:00Z'));
    await mockBackend(context, NOTES);
    await page.goto('/');

    const tomorrow = day(page, 'Tomorrow');
    await expect(fold(tomorrow)).toHaveText('Show 1 finished');
    await expect(fold(tomorrow)).toHaveAccessibleDescription('Tomorrow');
    await expect(tomorrow.getByText('No events tomorrow')).toBeHidden();

    const dayAfterTomorrow = day(page, 'Day After Tomorrow');
    await expect(dayAfterTomorrow.getByText('No events', { exact: true })).toBeVisible();
    await expect(fold(dayAfterTomorrow)).toBeHidden();
});
