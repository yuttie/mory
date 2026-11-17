import { expect, test } from '@playwright/test';
import { mockBackend, uuid } from './backend';

// The browser in Tokyo, and moried at UTC+14: a time written without an offset is moried's, wherever
// the browser is.
test.use({ timezoneId: 'Asia/Tokyo' });
const ZONE = 'Pacific/Kiritimati';

function task(title: string, fields = ''): string {
    return ['---', 'task:', '    status: {kind: todo}', ...(fields ? [fields] : []), '---', '', `# ${title}`, ''].join('\n');
}

test('reads a task\'s bare date in moried\'s zone', async ({ context, page }) => {
    // 21:00 in Tokyo, and already the 5th at UTC+14.
    await page.clock.setFixedTime(new Date('2026-10-04T12:00:00Z'));
    await mockBackend(context, { [`.tasks/${uuid(1)}.md`]: task('Report', '    deadline: 2026-10-04') }, { zone: ZONE });
    await page.goto('/');
    const deadline = page.locator('.task-date-cue[data-field="deadline"]');
    await expect(deadline).toHaveText('Deadline 2 hours ago');
    await expect(deadline).toHaveClass(/text-error/);
});
