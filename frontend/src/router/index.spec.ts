import { createApp } from 'vue';
import { describe, expect, it, vi } from 'vitest';

// The suites run in Node, where web history has no `window` to read the location from.
vi.mock('vue-router', async (importOriginal) => {
    const original = await importOriginal<typeof import('vue-router')>();
    return {
        ...original,
        createWebHistory: () => original.createMemoryHistory(),
    };
});
// Navigating loads the view, and this config has no plugin to compile a single-file component.
vi.mock('@/views/Calendar.vue', () => ({ default: {} }));
vi.mock('@/views/TasksNext.vue', () => ({ default: {} }));

import { RouterLink } from 'vue-router';
import router from '@/router';

// Vuetify's `v-list-item` takes its active state from RouterLink's, so asking RouterLink is
// asking whether the sidebar highlights the item.
function isLinkActive(to: string): boolean {
    const app = createApp({});
    app.use(router);
    return app.runWithContext(() => RouterLink.useLink({ to }).isActive.value);
}

describe('sidebar links to a redirecting route', () => {
    it('stay active on the calendar the redirect lands on', async () => {
        await router.push('/calendar');
        expect(router.currentRoute.value.name).toBe('CalendarWithDate');
        expect(isLinkActive('/calendar')).toBe(true);
        expect(isLinkActive('/tasks-next')).toBe(false);

        await router.push('/calendar/week/2026/09/16');
        expect(isLinkActive('/calendar')).toBe(true);
    });

    it('stay active on the tasks view the redirect lands on', async () => {
        await router.push('/tasks-next');
        expect(router.currentRoute.value.name).toBe('TasksNextWithParams');
        expect(isLinkActive('/tasks-next')).toBe(true);
        expect(isLinkActive('/calendar')).toBe(false);

        await router.push('/tasks-next/_/children/list');
        expect(isLinkActive('/tasks-next')).toBe(true);
    });
});
