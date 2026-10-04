import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

const files = vi.hoisted(() => ({ read: vi.fn(), commitId: 'initial', entries: [{ path: '.mory/tasks.yaml', time: '2026-10-04T00:00:00Z' }] }));
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
