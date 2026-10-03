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
vi.mock('@/views/Note.vue', () => ({ default: {} }));

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

describe('creating a note', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/;

    it('puts it at the root by default', async () => {
        await router.push({ name: 'Create' });
        const { params, query } = router.currentRoute.value;
        expect(router.currentRoute.value.name).toBe('Note');
        expect(params.path).toHaveLength(1);
        expect((params.path as string[])[0]).toMatch(uuid);
        expect(query.mode).toBe('create');
    });

    it('puts it in the directory its parent covers', async () => {
        await router.push({ name: 'Create', query: { parent: 'a/b.md' } });
        const { params, query } = router.currentRoute.value;
        const path = params.path as string[];
        expect(path.slice(0, 2)).toEqual(['a', 'b']);
        expect(path).toHaveLength(3);
        expect(path[2]).toMatch(uuid);
        expect(query.mode).toBe('create');
    });

    it('starts a root note when the parent is not a single path', async () => {
        await router.push({ name: 'Create', query: { parent: ['a.md', 'b.md'] } });
        expect(router.currentRoute.value.params.path).toHaveLength(1);
    });

    it('keeps the template when a parent is given too', async () => {
        await router.push({ name: 'Create', query: { from: 'x.template', parent: 'a/b.md' } });
        const { params, query } = router.currentRoute.value;
        expect((params.path as string[]).slice(0, 2)).toEqual(['a', 'b']);
        expect(query.template).toBe('x.template');
        expect(query.mode).toBe('create');
    });

    it.each([
        ['empty', ''],
        ['a bare slash', '/'],
        ['a trailing slash', 'foo/bar/'],
        ['a hidden directory', '.tasks/a.md'],
        ['a parent directory', '../../x.md'],
        ['a file no note covers', 'notes/todo.txt'],
    ])('starts a root note when the parent is %s', async (_name, parent) => {
        await router.push({ name: 'Create', query: { parent } });
        const path = router.currentRoute.value.params.path as string[];
        expect(path).toHaveLength(1);
        expect(path[0]).toMatch(uuid);
    });
});
