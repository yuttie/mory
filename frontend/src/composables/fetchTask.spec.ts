import { effectScope, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Task } from '@/api/task';

const getTask = vi.hoisted(() => vi.fn<(path: string) => Promise<[string, Task | null]>>());
vi.mock('@/api/task', () => ({ getTask }));
// No component mounts it here: the watcher's immediate run is the first read, as it is in one.
vi.mock('vue', async (original) => ({ ...(await original<typeof import('vue')>()), onMounted: () => undefined }));

const { useFetchTask } = await import('@/composables/fetchTask');

function task(title: string): Task {
    return { uuid: '00000000-0000-4000-8000-000000000001', title, note: '' } as Task;
}

// A read that answers when told to, so that two can be made to overlap.
function pending() {
    let answer!: (value: [string, Task | null]) => void;
    let refuse!: (reason: unknown) => void;
    const promise = new Promise<[string, Task | null]>((resolve, reject) => {
        answer = resolve;
        refuse = reject;
    });
    return { promise, answer: (t: Task) => answer(['etag', t]), refuse };
}

function notFound(): Error {
    return Object.assign(new Error('Not Found'), { response: { status: 404 } });
}

let scope = effectScope();

afterEach(() => {
    scope.stop();
    scope = effectScope();
    getTask.mockReset();
});

async function fetched(path = '.tasks/a.md') {
    const taskPath = ref(path);
    const fetch = scope.run(() => useFetchTask(taskPath))!;
    await vi.waitFor(() => expect(fetch.loading.value).toBe(false));
    return { taskPath, ...fetch };
}

describe('reread', () => {
    it('keeps the task read before until the new read lands', async () => {
        getTask.mockResolvedValueOnce(['etag', task('Before')]);
        const { task: current, reread } = await fetched();

        const read = pending();
        getTask.mockReturnValueOnce(read.promise);
        const landed = reread();
        await nextTick();
        expect(current.value?.title).toBe('Before');

        read.answer(task('After'));
        expect(await landed).toBe(true);
        expect(current.value?.title).toBe('After');
    });

    it('lands nothing once a read of another path has replaced it', async () => {
        getTask.mockResolvedValueOnce(['etag', task('Before')]);
        const { task: current, loading, taskPath, reread } = await fetched();

        const stale = pending();
        getTask.mockReturnValueOnce(stale.promise);
        const landed = reread();
        getTask.mockResolvedValueOnce(['etag', task('Elsewhere')]);
        taskPath.value = '.tasks/b.md';
        await vi.waitFor(() => expect(current.value?.title).toBe('Elsewhere'));

        stale.answer(task('After'));
        expect(await landed).toBe(false);
        expect(current.value?.title).toBe('Elsewhere');
        expect(loading.value).toBe(false);
    });

    it('throws when it fails, keeping the task read before', async () => {
        getTask.mockResolvedValueOnce(['etag', task('Before')]);
        const { task: current, error, reread } = await fetched();

        getTask.mockRejectedValueOnce(new Error('offline'));
        await expect(reread()).rejects.toThrow('offline');
        expect(current.value?.title).toBe('Before');
        expect(error.value).toBeNull();
    });

    it('ends the loading of a read it replaced', async () => {
        getTask.mockResolvedValueOnce(['etag', task('Before')]);
        const { task: current, loading, taskPath, reread } = await fetched();

        getTask.mockReturnValueOnce(pending().promise);
        taskPath.value = '.tasks/b.md';
        await vi.waitFor(() => expect(loading.value).toBe(true));
        getTask.mockResolvedValueOnce(['etag', task('Moved')]);
        expect(await reread()).toBe(true);
        expect(current.value?.title).toBe('Moved');
        expect(loading.value).toBe(false);
    });

    // Rather than leave the task blank, which reads as no note there to write over.
    it('fails as a read it replaced would have', async () => {
        getTask.mockResolvedValueOnce(['etag', task('Before')]);
        const { task: current, error, loading, taskPath, reread } = await fetched();

        getTask.mockReturnValueOnce(pending().promise);
        taskPath.value = '.tasks/b.md';
        await vi.waitFor(() => expect(loading.value).toBe(true));
        getTask.mockRejectedValueOnce(new Error('offline'));
        await expect(reread()).rejects.toThrow('offline');
        expect(current.value).toBeNull();
        expect(error.value).toEqual(new Error('offline'));
        expect(loading.value).toBe(false);

        getTask.mockReturnValueOnce(pending().promise);
        taskPath.value = '.tasks/c.md';
        await vi.waitFor(() => expect(loading.value).toBe(true));
        getTask.mockRejectedValueOnce(notFound());
        await expect(reread()).rejects.toThrow('Not Found');
        expect(current.value).toBeUndefined();
        expect(error.value).toBeNull();
    });
});
