import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

const files = vi.hoisted(() => ({ read: vi.fn(), readVersion: vi.fn(), writeChecked: vi.fn(), commitId: 'initial', entries: [{ path: '.mory/tasks.yaml', time: '2026-10-04T00:00:00Z' }] }));
vi.mock('@/stores/files', async () => {
    const { reactive } = await import('vue');
    return { useFilesStore: () => reactive(files) };
});
import { untextTagKeys, useTaskSettingsStore } from '@/stores/taskSettings';

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.resetAllMocks();
    files.commitId = 'initial';
    files.read.mockResolvedValue('default_lead_time: 7d\n');
});
afterEach(() => disposePinia(pinia));

describe('task settings freshness', () => {
    it('loads settings even when the listing was already populated', async () => {
        const store = useTaskSettingsStore();
        await store.load();
        expect(store.settings.default_lead_time).toBe('7d');
    });
    it('reloads settings committed in the same second', async () => {
        const store = useTaskSettingsStore();
        await store.load();
        files.read.mockResolvedValue('default_lead_time: 30d\n');
        const shared = reactive(files);
        shared.entries = [...shared.entries];
        shared.commitId = 'same-second-edit';
        await vi.waitFor(() => expect(store.settings.default_lead_time).toBe('30d'));
    });
    // Every task's urgency is worked out from them, so an equal value read again must not replace them.
    it('keeps what it holds when a commit leaves the file as it was', async () => {
        files.read.mockResolvedValue('default_lead_time: 7d\nstatus_colors:\n    done: light-green\n');
        const store = useTaskSettingsStore();
        await store.load();
        const { settings, statusColors, problems } = store;
        reactive(files).commitId = 'unrelated-edit';
        await vi.waitFor(() => expect(files.read).toHaveBeenCalledTimes(2));
        await store.load();
        expect(store.settings).toBe(settings);
        expect(store.statusColors).toBe(statusColors);
        expect(store.problems).toBe(problems);
    });
    it('reads the newer commit after an older response finishes', async () => {
        let finishOld!: (content: string) => void;
        files.read.mockImplementationOnce(() => new Promise<string>((resolve) => { finishOld = resolve; }));
        const store = useTaskSettingsStore();
        await vi.waitFor(() => expect(files.read).toHaveBeenCalledTimes(1));
        files.read.mockResolvedValue('default_lead_time: 30d\n');
        reactive(files).commitId = 'edited-during-read';
        await nextTick();
        finishOld('default_lead_time: 7d\n');
        await vi.waitFor(() => expect(store.settings.default_lead_time).toBe('30d'));
        expect(files.read).toHaveBeenCalledTimes(2);
    });
});

describe('the commit a read is of', () => {
    it('is the one the read began at, whatever the file held', async () => {
        const store = useTaskSettingsStore();
        await store.load();
        expect(store.readAt).toBe('initial');
        files.read.mockResolvedValue('default_lead_time: [\n');
        reactive(files).commitId = 'broken';
        await vi.waitFor(() => expect(store.readAt).toBe('broken'));
        expect(store.problems).toHaveLength(1);
        files.read.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
        reactive(files).commitId = 'removed';
        await vi.waitFor(() => expect(store.readAt).toBe('removed'));
        expect(store.problems).toEqual([]);
    });

    // A moried restarting, or the network gone: the problem it leaves says nothing of the file.
    it('is none when the read reached no file', async () => {
        const store = useTaskSettingsStore();
        await store.load();
        files.read.mockRejectedValue({ isAxiosError: true, response: { status: 502 }, message: 'Request failed with status code 502' });
        await store.load();
        expect(store.readAt).toBeNull();
        expect(store.problems).toHaveLength(1);
    });
});

describe('status colours', () => {
    it('reads them beside the lead times, and reports the ones it drops with the rest', async () => {
        files.read.mockResolvedValue('default_lead_time: nope\nstatus_colors:\n    done: light-green\n    todo: not a colour\n');
        const store = useTaskSettingsStore();
        await store.load();
        expect(store.statusColors).toEqual({ done: 'light-green' });
        expect(store.resolvedStatusColors).toEqual({ done: 'rgb(139, 195, 74)' });
        expect(store.problems).toEqual([
            'Invalid default_lead_time; use whole days or weeks, such as 7d or 2w.',
            'Invalid colour for status todo.',
        ]);
    });

    it('makes the edits to the file as it is now, so a colour set meanwhile survives', async () => {
        files.read.mockResolvedValue('status_colors:\n    done: green\n');
        const store = useTaskSettingsStore();
        await store.load();
        // Set by hand since this read the file.
        files.readVersion.mockResolvedValue({ content: '# Mine\nstatus_colors:\n    done: green\n    blocked: purple\n', etag: '"v2"' });
        await store.saveStatusColors({ waiting: 'orange', done: null });
        expect(files.writeChecked).toHaveBeenCalledWith('.mory/tasks.yaml', '# Mine\nstatus_colors:\n    blocked: purple\n    waiting: orange\n', '"v2"');
        expect(store.statusColors).toEqual({ blocked: 'purple', waiting: 'orange' });
    });

    it('creates the file when there is none', async () => {
        files.readVersion.mockRejectedValue(Object.assign(new Error('Not found'), { isAxiosError: true, response: { status: 404 } }));
        const store = useTaskSettingsStore();
        await store.saveStatusColors({ done: 'red' });
        expect(files.writeChecked).toHaveBeenCalledWith('.mory/tasks.yaml', 'status_colors:\n    done: red\n', 'absent');
    });

    it('reads the file again, and says so, when it changes before the write lands', async () => {
        files.readVersion.mockResolvedValue({ content: 'default_lead_time: 7d\n', etag: '"v1"' });
        files.writeChecked.mockRejectedValue(Object.assign(new Error('Precondition failed'), { isAxiosError: true, response: { status: 412 } }));
        const store = useTaskSettingsStore();
        await vi.waitFor(() => expect(files.read).toHaveBeenCalledTimes(1));
        await expect(store.saveStatusColors({ done: 'red' })).rejects.toThrow('changed while saving');
        await vi.waitFor(() => expect(files.read).toHaveBeenCalledTimes(2));
        expect(store.statusColors).toEqual({});
    });

    it('commits nothing when nothing changes', async () => {
        files.readVersion.mockResolvedValue({ content: 'status_colors:\n    done: red\n', etag: '"v1"' });
        const store = useTaskSettingsStore();
        await store.saveStatusColors({ done: 'red', todo: null });
        expect(files.writeChecked).not.toHaveBeenCalled();
    });

    it('writes nothing to a file it cannot edit', async () => {
        files.readVersion.mockResolvedValue({ content: 'tasks:\n    backlog: []\n', etag: '"v1"' });
        const store = useTaskSettingsStore();
        await expect(store.saveStatusColors({ done: 'red' })).rejects.toThrow('legacy task data');
        expect(files.writeChecked).not.toHaveBeenCalled();
    });

});

describe('untextTagKeys', () => {
    it('reports a key of lead_time_by_tag that is not text, and passes one quoted', () => {
        expect(untextTagKeys('lead_time_by_tag:\n    2024: 3d\n    "2025": 3d\n    true: 1w\n    work: 2d\n')).toEqual([
            'Tag 2024 in lead_time_by_tag is not text, so moried\'s list_tasks ignores its lead time; quote it, as "2024".',
            'Tag true in lead_time_by_tag is not text, so moried\'s list_tasks ignores its lead time; quote it, as "true".',
        ]);
        expect(untextTagKeys('default_lead_time: 7d\n')).toEqual([]);
        expect(untextTagKeys('lead_time_by_tag: 3\n')).toEqual([]);
    });
});

describe('task settings problems', () => {
    it('include a tag key moried does not take', async () => {
        files.read.mockResolvedValue('lead_time_by_tag:\n    2024: 3d\n');
        const store = useTaskSettingsStore();
        await store.load();
        expect(store.problems).toEqual(['Tag 2024 in lead_time_by_tag is not text, so moried\'s list_tasks ignores its lead time; quote it, as "2024".']);
    });
});
