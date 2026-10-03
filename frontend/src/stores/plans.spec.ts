import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { reactive } from 'vue';

const files = vi.hoisted(() => ({ readVersion: vi.fn(), writeChecked: vi.fn(), refresh: vi.fn(), entries: [] as { path: string }[], commitId: null as string | null }));
vi.mock('@/stores/files', async () => {
    const { reactive } = await import('vue');
    return { useFilesStore: () => reactive(files) };
});
import { usePlansStore } from '@/stores/plans';
const A = '4955857d-3267-4b94-83f2-538a428970d7';
const B = '2a997a71-0d2b-4938-b8ff-5178c28a5ad9';
let repository: Map<string, { content: string; etag: string }>;
let version: number;
beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    repository = new Map();
    version = 0;
    files.entries = [];
    files.commitId = null;
    files.refresh.mockResolvedValue([]);
    files.readVersion.mockImplementation(async (path: string, etag?: string) => {
        const file = repository.get(path);
        if (!file) {
            throw { isAxiosError: true, response: { status: 404 } };
        }
        return { content: etag === file.etag ? null : file.content, etag: file.etag };
    });
    files.writeChecked.mockImplementation(async (path: string, content: string, expected: string) => {
        expect(expected).toBe(repository.get(path)?.etag ?? 'absent');
        repository.set(path, { content, etag: `v${++version}` });
    });
});

describe('monthly plan store', () => {
    it('discovers the first external plan after an empty history load', async () => {
        const store = usePlansStore();
        await store.loadAll();
        repository.set('.mory/plans/2026-11.yaml', { content: YAML.stringify({ '2026-11-05': [{ task: A, origin: 'planned' }] }), etag: 'external' });
        const shared = reactive(files);
        shared.entries = [{ path: '.mory/plans/2026-11.yaml' }];
        shared.commitId = 'first-plan';
        await vi.waitFor(() => expect(store.plannedDays(A)).toEqual(['2026-11-05']));
    });
    it('discovers months added externally after history was first loaded', async () => {
        const store = usePlansStore();
        await store.loadMonths(['2026-10']);
        repository.set('.mory/plans/2026-11.yaml', { content: YAML.stringify({ '2026-11-05': [{ task: A, origin: 'planned' }] }), etag: 'external' });
        const shared = reactive(files);
        shared.entries = [{ path: '.mory/plans/2026-11.yaml' }];
        shared.commitId = 'external';
        await vi.waitFor(() => expect(store.plannedDays(A)).toEqual(['2026-11-05']));
    });
    it('serializes additions, ordering and effort records with one month per change', async () => {
        const store = usePlansStore();
        await Promise.all([store.planTask('2026-10-05', A), store.planTask('2026-10-05', B, 'interruption')]);
        await store.reorder('2026-10-05', [B, A]);
        await store.recordResult('2026-10-05', A, 'worked');
        expect(store.days['2026-10-05']).toEqual([{ task: B, origin: 'interruption', result: 'worked' }, { task: A, origin: 'planned', result: 'worked' }]);
        expect(files.writeChecked.mock.calls.every(([path]) => path === '.mory/plans/2026-10.yaml')).toBe(true);
        expect(store.plannedDays(A)).toEqual(['2026-10-05']);
        await store.unplanTask('2026-10-05', B);
        expect(store.days['2026-10-05']).toHaveLength(1);
    });
    it('refuses invalid months and never overwrites malformed plan files', async () => {
        const store = usePlansStore();
        repository.set('.mory/plans/2026-10.yaml', { content: '2026-10-05: invalid', etag: 'v0' });
        await expect(store.planTask('2026-10-05', A)).rejects.toThrow();
        await expect(store.loadMonths(['../../bad'])).rejects.toThrow();
        expect(files.writeChecked).not.toHaveBeenCalled();
    });
    it('reloads a concurrent edit after a rejected version check', async () => {
        const store = usePlansStore();
        await store.planTask('2026-10-05', A);
        files.writeChecked.mockImplementationOnce(async () => {
            repository.set('.mory/plans/2026-10.yaml', { content: YAML.stringify({ '2026-10-05': [{ task: B, origin: 'planned' }] }), etag: 'external' });
            throw { isAxiosError: true, response: { status: 412 } };
        });
        await expect(store.recordResult('2026-10-05', A, 'worked')).rejects.toThrow('changed elsewhere');
        expect(store.days['2026-10-05']).toEqual([{ task: B, origin: 'planned' }]);
    });
    it('collects all past months, saves today first and counts missed days', async () => {
        const store = usePlansStore();
        repository.set('.mory/plans/2026-09.yaml', { content: YAML.stringify({ '2026-09-30': [{ task: A, origin: 'planned' }] }), etag: 'old' });
        files.entries = [{ path: '.mory/plans/2026-09.yaml' }];
        await store.collect('2026-10-04', () => 'todo');
        expect(files.writeChecked.mock.calls.map(([path]) => path)).toEqual(['.mory/plans/2026-10.yaml', '.mory/plans/2026-09.yaml']);
        expect(store.days['2026-09-30'][0].result).toBe('missed');
        expect(store.days['2026-10-04']).toEqual([{ task: A, origin: 'planned' }]);
        expect(store.missedCount(A)).toBe(1);
        await store.collect('2026-10-04', () => 'todo');
        expect(files.writeChecked).toHaveBeenCalledTimes(2);
    });
});
