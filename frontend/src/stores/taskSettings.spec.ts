import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

const files = vi.hoisted(() => ({ read: vi.fn(), readVersion: vi.fn(), writeChecked: vi.fn(), commitId: 'initial', entries: [{ path: '.mory/tasks.yaml', time: '2026-10-04T00:00:00Z' }] }));
vi.mock('@/stores/files', async () => {
    const { reactive } = await import('vue');
    return { useFilesStore: () => reactive(files) };
});
import { useTaskSettingsStore } from '@/stores/taskSettings';

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
