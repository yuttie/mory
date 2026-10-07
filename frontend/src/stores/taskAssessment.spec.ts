import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

const files = vi.hoisted(() => ({ readVersion: vi.fn(), commitId: 'initial' as string | null }));
vi.mock('@/stores/files', async () => {
    const { reactive } = await import('vue');
    return { useFilesStore: () => reactive(files) };
});
import { useTaskAssessmentStore } from '@/stores/taskAssessment';
import { DEFAULT_TASK_ASSESSMENT_PROMPT } from '@/task-assessment';

const missing = () => Object.assign(new Error('Not found'), { isAxiosError: true, response: { status: 404 } });

// A file of `content` at `etag`, answering a read that names the version it holds with no content,
// as the server's 304 does.
function serve(content: string, etag: string) {
    files.readVersion.mockImplementation(async (_path: string, held?: string) => ({ content: held === etag ? null : content, etag }));
}

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.resetAllMocks();
    files.commitId = 'initial';
    files.readVersion.mockRejectedValue(missing());
});
afterEach(() => disposePinia(pinia));

describe('the task assessment prompt', () => {
    it('is the default while the repository holds none', async () => {
        const store = useTaskAssessmentStore();
        expect(await store.current()).toBe(DEFAULT_TASK_ASSESSMENT_PROMPT);
        expect(store.custom).toBeNull();
        expect(store.version).toBe('absent');
        expect(store.error).toBe('');
    });

    it('is what the file holds, without the space around it', async () => {
        serve('\nJudge the title only.\n', '"v1"');
        const store = useTaskAssessmentStore();
        expect(await store.current()).toBe('Judge the title only.');
        expect(store.version).toBe('"v1"');
    });

    it('is the default when the file is blank', async () => {
        serve(' \n', '"v1"');
        const store = useTaskAssessmentStore();
        expect(await store.current()).toBe(DEFAULT_TASK_ASSESSMENT_PROMPT);
        expect(store.custom).toBeNull();
    });

    it('is read before an assessment asked for at once is sent', async () => {
        let finish!: (file: { content: string; etag: string }) => void;
        files.readVersion.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const store = useTaskAssessmentStore();
        const asked = store.current();
        await vi.waitFor(() => expect(files.readVersion).toHaveBeenCalled());
        finish({ content: 'Mine.\n', etag: '"v1"' });
        expect(await asked).toBe('Mine.');
    });

    it('waits for a commit that arrives during a read', async () => {
        let finishOld!: (file: { content: string; etag: string }) => void;
        files.readVersion.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
        const store = useTaskAssessmentStore();
        await vi.waitFor(() => expect(files.readVersion).toHaveBeenCalledTimes(1));
        serve('Newer.\n', '"v2"');
        reactive(files).commitId = 'edited-during-read';
        await nextTick();
        const asked = store.current();
        finishOld({ content: 'Older.\n', etag: '"v1"' });
        expect(await asked).toBe('Newer.');
    });

    it('reads a commit not yet read when asked, rather than when its watcher runs', async () => {
        serve('First.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        serve('Second.\n', '"v2"');
        // Asked in the same tick as the commit, before the watcher has started a read.
        reactive(files).commitId = 'second';
        expect(await store.current()).toBe('Second.');
    });

    it('follows the file from commit to commit, without fetching a version it holds', async () => {
        serve('First.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        reactive(files).commitId = 'unrelated';
        expect(await store.current()).toBe('First.');
        expect(files.readVersion).toHaveBeenLastCalledWith('.mory/task-assessment.md', '"v1"');
        files.readVersion.mockRejectedValue(missing());
        reactive(files).commitId = 'deleted';
        await vi.waitFor(() => expect(store.prompt).toBe(DEFAULT_TASK_ASSESSMENT_PROMPT));
    });

    it('keeps the prompt last read when the file cannot be read, and says why', async () => {
        serve('Mine.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        files.readVersion.mockRejectedValue(new Error('Network Error'));
        reactive(files).commitId = 'unreachable';
        await vi.waitFor(() => expect(store.error).toBe('Error: Network Error'));
        expect(store.prompt).toBe('Mine.');
    });

    it('holds an assessment back until a read succeeds, and tries again when asked', async () => {
        files.readVersion.mockRejectedValue(new Error('Network Error'));
        const store = useTaskAssessmentStore();
        await expect(store.current()).rejects.toThrow('.mory/task-assessment.md could not be read: Error: Network Error');
        serve('Mine.\n', '"v1"');
        expect(await store.current()).toBe('Mine.');
        expect(store.error).toBe('');
    });
});
