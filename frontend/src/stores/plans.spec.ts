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
    it('reads again at each commit a month it knows only by its error', async () => {
        repository.set('.mory/plans/2026-07.yaml', { content: '2026-07-05: invalid', etag: 'bad' });
        repository.set('.mory/plans/2026-08.yaml', { content: '2026-08-05: invalid', etag: 'bad' });
        files.entries = [{ path: '.mory/plans/2026-07.yaml' }, { path: '.mory/plans/2026-08.yaml' }];
        const store = usePlansStore();
        // As the home page asks for today's month alone, holding no month that read.
        await expect(store.loadMonths(['2026-07', '2026-08'])).rejects.toThrow('2026-08');
        expect(Object.keys(store.errors)).toEqual(['2026-07', '2026-08']);
        repository.set('.mory/plans/2026-07.yaml', { content: YAML.stringify({ '2026-07-05': [{ task: A, origin: 'planned' }] }), etag: 'fixed' });
        repository.delete('.mory/plans/2026-08.yaml');
        const shared = reactive(files);
        shared.entries = [{ path: '.mory/plans/2026-07.yaml' }];
        shared.commitId = 'fixed';
        await vi.waitFor(() => expect(store.errors).toEqual({}));
        expect(store.plannedDays(A)).toEqual(['2026-07-05']);
    });
    it('says which commit each month was last read at, and none for a read that reached no file', async () => {
        repository.set('.mory/plans/2026-07.yaml', { content: YAML.stringify({ '2026-07-05': [{ task: A, origin: 'planned' }] }), etag: 'good' });
        repository.set('.mory/plans/2026-08.yaml', { content: '2026-08-05: invalid', etag: 'bad' });
        reactive(files).commitId = 'c1';
        const store = usePlansStore();
        await expect(store.loadMonths(['2026-07', '2026-08', '2026-09'])).rejects.toThrow('2026-08');
        expect(['2026-07', '2026-08', '2026-09'].map(store.readAt)).toEqual(['c1', 'c1', 'c1']);
        files.readVersion.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
        await expect(store.loadMonths(['2026-07'])).rejects.toThrow('2026-07');
        expect(store.readAt('2026-07')).toBeNull();
        expect(store.readAt('2026-10')).toBeNull();
    });
    it('reads for a commit only the months the reload at that commit has not read', async () => {
        repository.set('.mory/plans/2026-07.yaml', { content: YAML.stringify({ '2026-07-05': [{ task: A, origin: 'planned' }] }), etag: 'v' });
        files.entries = [{ path: '.mory/plans/2026-07.yaml' }];
        const store = usePlansStore();
        await store.loadMonths(['2026-07']);
        // Set past the stores of the tests before, which would each read their months again.
        files.commitId = 'c2';
        // The store's own reload at the commit, queued before the read for it, which waits for it.
        void store.loadMonths(['2026-07']);
        await store.loadMonthsAt('c2', ['2026-07', '2026-08']);
        const read = () => files.readVersion.mock.calls.map(([path]) => path);
        expect(read()).toEqual(['.mory/plans/2026-07.yaml', '.mory/plans/2026-07.yaml', '.mory/plans/2026-08.yaml']);
        files.readVersion.mockRejectedValueOnce({ isAxiosError: true, message: 'Network Error' });
        await expect(store.loadMonthsAt('c3', ['2026-07'])).rejects.toThrow('2026-07');
        await store.loadMonthsAt('c3', ['2026-07']);
        expect(read()).toHaveLength(5);
        expect(store.readAt('2026-07')).toBe('c2');
    });
    it('keeps what it holds of months a commit leaves as they were', async () => {
        repository.set('.mory/plans/2026-10.yaml', { content: YAML.stringify({ '2026-10-05': [{ task: A, origin: 'planned' }] }), etag: 'october' });
        const store = usePlansStore();
        await store.loadMonths(['2026-10', '2026-11']);
        const { days } = store;
        const [october, november] = [store.months['2026-10'], store.months['2026-11']];
        await store.loadMonths(['2026-10', '2026-11']);
        expect(store.months['2026-10']).toBe(october);
        expect(store.months['2026-11']).toBe(november);
        expect(store.days).toBe(days);
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
    it('inserts a dropped task at its day position in one write and preserves existing work records', async () => {
        const store = usePlansStore();
        await store.planTask('2026-10-05', A, 'interruption');
        const before = files.writeChecked.mock.calls.length;
        await store.planTask('2026-10-05', B, 'planned', 0);
        expect(files.writeChecked).toHaveBeenCalledTimes(before + 1);
        expect(store.days['2026-10-05']).toEqual([{ task: B, origin: 'planned' }, { task: A, origin: 'interruption', result: 'worked' }]);
        await store.planTask('2026-10-05', A, 'planned', 0);
        expect(store.days['2026-10-05']).toEqual([{ task: B, origin: 'planned' }, { task: A, origin: 'interruption', result: 'worked' }]);
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
    it('moves an entry within a month in one write, retaining its origin and result', async () => {
        const store = usePlansStore();
        await store.planTask('2026-10-05', A, 'interruption');
        await store.planTask('2026-10-06', B);
        files.writeChecked.mockClear();
        await store.moveTask('2026-10-05', '2026-10-06', A, 0);
        expect(files.writeChecked).toHaveBeenCalledTimes(1);
        expect(store.days['2026-10-05']).toEqual([]);
        expect(store.days['2026-10-06']).toEqual([{ task: A, origin: 'interruption', result: 'worked' }, { task: B, origin: 'planned' }]);
        expect(store.plannedDays(A)).toEqual(['2026-10-06']);
    });
    it('moves across months, saving the destination before removing the source', async () => {
        const store = usePlansStore();
        await store.planTask('2026-10-31', A);
        await store.recordResult('2026-10-31', A, 'missed');
        files.writeChecked.mockClear();
        await store.moveTask('2026-10-31', '2026-11-01', A, 0);
        expect(files.writeChecked.mock.calls.map(([path]) => path)).toEqual(['.mory/plans/2026-11.yaml', '.mory/plans/2026-10.yaml']);
        expect(store.days['2026-10-31']).toEqual([]);
        expect(store.days['2026-11-01']).toEqual([{ task: A, origin: 'planned', result: 'missed' }]);
    });
    it('keeps the source when a destination write fails and refuses missing or duplicate moves', async () => {
        const store = usePlansStore();
        await store.planTask('2026-10-31', A);
        const source = repository.get('.mory/plans/2026-10.yaml')!.content;
        files.writeChecked.mockImplementationOnce(async () => { throw new Error('Offline'); });
        await expect(store.moveTask('2026-10-31', '2026-11-01', A, 0)).rejects.toThrow('Offline');
        expect(repository.get('.mory/plans/2026-10.yaml')!.content).toBe(source);
        expect(store.days['2026-10-31']).toEqual([{ task: A, origin: 'planned' }]);
        await store.planTask('2026-11-01', A);
        files.writeChecked.mockClear();
        await expect(store.moveTask('2026-10-31', '2026-11-01', A, 0)).rejects.toThrow('already planned');
        await expect(store.moveTask('2026-10-30', '2026-11-02', A, 0)).rejects.toThrow('no longer planned');
        expect(files.writeChecked).not.toHaveBeenCalled();
    });
    it('keeps both records and reports a partial move when source removal fails', async () => {
        const store = usePlansStore();
        await store.planTask('2026-10-31', A);
        const write = files.writeChecked.getMockImplementation()!;
        files.writeChecked.mockImplementation(async (path: string, content: string, expected: string) => {
            if (path.endsWith('2026-10.yaml')) {
                throw new Error('Offline');
            }
            await write(path, content, expected);
        });
        await expect(store.moveTask('2026-10-31', '2026-11-01', A, 0)).rejects.toThrow('destination was saved');
        expect(store.plannedDays(A)).toEqual(['2026-10-31', '2026-11-01']);
        for (const month of ['2026-10', '2026-11']) {
            expect(YAML.parse(repository.get(`.mory/plans/${month}.yaml`)!.content)[`${month}-${month.endsWith('10') ? '31' : '01'}`]).toEqual([{ task: A, origin: 'planned' }]);
        }
    });
    it('reads every other month when one does not read, and refuses only that one', async () => {
        repository.set('.mory/plans/2026-07.yaml', { content: '2026-07-05: invalid', etag: 'bad' });
        repository.set('.mory/plans/2026-08.yaml', { content: YAML.stringify({ '2026-08-05': [{ task: A, origin: 'planned' }] }), etag: 'august' });
        files.entries = [{ path: '.mory/plans/2026-07.yaml' }, { path: '.mory/plans/2026-13.yaml' }, { path: '.mory/plans/2026-08.yaml' }];
        const store = usePlansStore();
        await expect(store.loadAll()).rejects.toThrow('2026-07');
        expect(store.plannedDays(A)).toEqual(['2026-08-05']);
        expect(Object.keys(store.errors)).toEqual(['2026-07']);
        await expect(store.loadMonths(['2026-07', '2026-08'])).rejects.toThrow('2026-07');
        await expect(store.planTask('2026-07-06', A)).rejects.toThrow('2026-07');
        await store.planTask('2026-08-06', A);
        expect(files.writeChecked.mock.calls.map(([path]) => path)).toEqual(['.mory/plans/2026-08.yaml']);
        expect(repository.get('.mory/plans/2026-07.yaml')!.content).toBe('2026-07-05: invalid');
    });
    it('collects from the months that read and names the one it left out', async () => {
        repository.set('.mory/plans/2026-08.yaml', { content: YAML.stringify({ '2026-08-05': [{ task: A, origin: 'planned' }] }), etag: 'august' });
        repository.set('.mory/plans/2026-09.yaml', { content: YAML.stringify({ '2026-09-30': [{ task: B, origin: 'planned' }] }), etag: 'september' });
        files.entries = [{ path: '.mory/plans/2026-08.yaml' }, { path: '.mory/plans/2026-09.yaml' }];
        const store = usePlansStore();
        await store.loadAll();
        // Read cleanly once, then broken: what the store still holds of it must not be collected.
        repository.set('.mory/plans/2026-08.yaml', { content: '2026-08-05: invalid', etag: 'bad' });
        await expect(store.loadAll()).rejects.toThrow('2026-08');
        expect(store.plannedDays(A)).toEqual([]);
        await expect(store.collect('2026-10-04', () => 'todo')).rejects.toThrow(/Left out 2026-08,/);
        expect(files.writeChecked.mock.calls.map(([path]) => path)).toEqual(['.mory/plans/2026-10.yaml', '.mory/plans/2026-09.yaml']);
        expect(store.days['2026-10-04']).toEqual([{ task: B, origin: 'planned' }]);
        expect(repository.get('.mory/plans/2026-08.yaml')!.content).toBe('2026-08-05: invalid');
        // Once its file is gone, the month neither fails nor is left out.
        repository.delete('.mory/plans/2026-08.yaml');
        files.entries = [{ path: '.mory/plans/2026-09.yaml' }, { path: '.mory/plans/2026-10.yaml' }];
        await store.collect('2026-10-04', () => 'todo');
        expect(store.errors).toEqual({});
    });
    it('collects a month it left out once that reads, adding nothing twice', async () => {
        repository.set('.mory/plans/2026-08.yaml', { content: '2026-08-05: invalid', etag: 'bad' });
        repository.set('.mory/plans/2026-09.yaml', { content: YAML.stringify({ '2026-09-30': [{ task: A, origin: 'planned' }, { task: B, origin: 'planned' }] }), etag: 'september' });
        files.entries = [{ path: '.mory/plans/2026-08.yaml' }, { path: '.mory/plans/2026-09.yaml' }];
        const store = usePlansStore();
        await expect(store.collect('2026-10-04', () => 'todo')).rejects.toThrow(/Left out 2026-08,/);
        repository.set('.mory/plans/2026-08.yaml', { content: YAML.stringify({ '2026-08-05': [{ task: A, origin: 'planned' }] }), etag: 'fixed' });
        files.entries = [...files.entries, { path: '.mory/plans/2026-10.yaml' }];
        files.writeChecked.mockClear();
        await store.collect('2026-10-04', () => 'todo');
        expect(files.writeChecked.mock.calls.map(([path]) => path)).toEqual(['.mory/plans/2026-08.yaml']);
        expect(store.days['2026-08-05']).toEqual([{ task: A, origin: 'planned', result: 'missed' }]);
        expect(store.days['2026-09-30']).toEqual([{ task: A, origin: 'planned', result: 'missed' }, { task: B, origin: 'planned', result: 'missed' }]);
        expect(store.days['2026-10-04']).toEqual([{ task: A, origin: 'planned' }, { task: B, origin: 'planned' }]);
    });
    it('keeps showing a month that could not be fetched, but neither writes nor collects it', async () => {
        repository.set('.mory/plans/2026-09.yaml', { content: YAML.stringify({ '2026-09-30': [{ task: A, origin: 'planned' }] }), etag: 'september' });
        files.entries = [{ path: '.mory/plans/2026-09.yaml' }];
        const store = usePlansStore();
        await store.loadAll();
        const read = files.readVersion.getMockImplementation()!;
        files.readVersion.mockImplementation(async (path: string, etag?: string) => {
            if (path.endsWith('2026-09.yaml')) {
                throw new Error('Network Error');
            }
            return read(path, etag);
        });
        await expect(store.loadAll()).rejects.toThrow('Network Error');
        // Its file may well be unchanged, so what was last read of it is still shown.
        expect(store.plannedDays(A)).toEqual(['2026-09-30']);
        await expect(store.planTask('2026-09-29', B)).rejects.toThrow('Network Error');
        await expect(store.collect('2026-10-04', () => 'todo')).rejects.toThrow(/Left out 2026-09,/);
        expect(files.writeChecked).not.toHaveBeenCalled();
    });
    it('collects nothing when the month it would add today to does not read', async () => {
        repository.set('.mory/plans/2026-09.yaml', { content: YAML.stringify({ '2026-09-30': [{ task: B, origin: 'planned' }] }), etag: 'september' });
        repository.set('.mory/plans/2026-10.yaml', { content: '2026-10-01: invalid', etag: 'bad' });
        files.entries = [{ path: '.mory/plans/2026-09.yaml' }, { path: '.mory/plans/2026-10.yaml' }];
        const store = usePlansStore();
        await expect(store.collect('2026-10-04', () => 'todo')).rejects.toThrow('2026-10');
        expect(files.writeChecked).not.toHaveBeenCalled();
    });
    it('collects past an unreadable month later than today', async () => {
        repository.set('.mory/plans/2026-09.yaml', { content: YAML.stringify({ '2026-09-30': [{ task: B, origin: 'planned' }] }), etag: 'september' });
        repository.set('.mory/plans/2026-12.yaml', { content: '2026-12-01: invalid', etag: 'bad' });
        files.entries = [{ path: '.mory/plans/2026-09.yaml' }, { path: '.mory/plans/2026-12.yaml' }];
        const store = usePlansStore();
        await store.collect('2026-10-04', () => 'todo');
        expect(store.days['2026-10-04']).toEqual([{ task: B, origin: 'planned' }]);
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
