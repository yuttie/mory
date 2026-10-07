import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

const files = vi.hoisted(() => ({ readVersion: vi.fn(), writeChecked: vi.fn(), remove: vi.fn(), commitId: 'initial' as string | null }));
vi.mock('@/stores/files', async () => {
    const { reactive } = await import('vue');
    return { useFilesStore: () => reactive(files) };
});
import { TaskAssessmentPromptConflict, useTaskAssessmentStore } from '@/stores/taskAssessment';
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

describe('saving the task assessment prompt', () => {
    it('writes the file whole, over the version it was based on', async () => {
        serve('Mine.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        files.writeChecked.mockImplementation(async () => serve('Judge the title only.\n', '"v2"'));
        await store.save('Judge the title only.  \n\n', '"v1"');
        expect(files.writeChecked).toHaveBeenCalledWith('.mory/task-assessment.md', 'Judge the title only.\n', '"v1"');
        expect(store.prompt).toBe('Judge the title only.');
        expect(store.version).toBe('"v2"');
    });

    it('creates the file when there is none', async () => {
        const store = useTaskAssessmentStore();
        await store.ready();
        await store.save('Mine.', 'absent');
        expect(files.writeChecked).toHaveBeenCalledWith('.mory/task-assessment.md', 'Mine.\n', 'absent');
    });

    it('keeps the default as no file, so a later default applies', async () => {
        serve('Mine.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        files.remove.mockImplementation(async () => {
            files.readVersion.mockRejectedValue(missing());
            return true;
        });
        await store.save(DEFAULT_TASK_ASSESSMENT_PROMPT, '"v1"');
        expect(files.remove).toHaveBeenCalledWith('.mory/task-assessment.md');
        expect(files.writeChecked).not.toHaveBeenCalled();
        expect(store.custom).toBeNull();
        expect(store.version).toBe('absent');
    });

    it('takes a blank prompt for the default', async () => {
        serve('Mine.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        await store.save('  \n', '"v1"');
        expect(files.remove).toHaveBeenCalledWith('.mory/task-assessment.md');
    });

    it('writes nothing when nothing changes', async () => {
        const store = useTaskAssessmentStore();
        await store.ready();
        await store.save(DEFAULT_TASK_ASSESSMENT_PROMPT, 'absent');
        serve('Mine.\n', '"v1"');
        reactive(files).commitId = 'mine';
        await store.ready();
        await store.save('Mine.\n', '"v1"');
        expect(files.writeChecked).not.toHaveBeenCalled();
        expect(files.remove).not.toHaveBeenCalled();
    });

    it('is refused over a version it was not based on, even one the store read since', async () => {
        serve('Mine.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        // Changed through MCP, and read here, while the field held an edit begun from v1.
        serve('Theirs.\n', '"v2"');
        reactive(files).commitId = 'theirs';
        await vi.waitFor(() => expect(store.version).toBe('"v2"'));
        files.writeChecked.mockRejectedValue(Object.assign(new Error('Precondition Failed'), { isAxiosError: true, response: { status: 412 } }));
        await expect(store.save('Yours.', '"v1"')).rejects.toBeInstanceOf(TaskAssessmentPromptConflict);
        expect(files.writeChecked).toHaveBeenCalledWith('.mory/task-assessment.md', 'Yours.\n', '"v1"');
        expect(store.prompt).toBe('Theirs.');
    });

    it('removes nothing that changed since it was read', async () => {
        serve('Mine.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        serve('Mine, edited.\n', '"v2"');
        await expect(store.save(DEFAULT_TASK_ASSESSMENT_PROMPT, '"v1"')).rejects.toThrow('.mory/task-assessment.md changed since this prompt was read.');
        expect(files.remove).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(store.prompt).toBe('Mine, edited.'));
    });

    it('removes nothing created since the default was read', async () => {
        const store = useTaskAssessmentStore();
        await store.ready();
        serve('Theirs.\n', '"v1"');
        await expect(store.save('', 'absent')).rejects.toBeInstanceOf(TaskAssessmentPromptConflict);
        expect(files.remove).not.toHaveBeenCalled();
    });

    it('takes a file already gone for the default it was saving', async () => {
        serve('Mine.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        files.remove.mockImplementation(async () => {
            files.readVersion.mockRejectedValue(missing());
            throw missing();
        });
        await store.save(DEFAULT_TASK_ASSESSMENT_PROMPT, '"v1"');
        expect(store.prompt).toBe(DEFAULT_TASK_ASSESSMENT_PROMPT);
    });

    it('uses a saved prompt even when reading it back fails', async () => {
        serve('Mine.\n', '"v1"');
        const store = useTaskAssessmentStore();
        await store.ready();
        files.writeChecked.mockImplementation(async () => files.readVersion.mockRejectedValue(new Error('Network Error')));
        await store.save('Yours.', '"v1"');
        expect(store.prompt).toBe('Yours.');
    });
});
