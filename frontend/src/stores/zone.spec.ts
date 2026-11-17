import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getZone: vi.fn<() => Promise<string>>(),
}));

vi.mock('@/api', () => apiMocks);

import { useZoneStore } from '@/stores/zone';

const READERS = Intl.DateTimeFormat().resolvedOptions().timeZone;

function storage(): Storage {
    const items = new Map<string, string>();
    return {
        get length() {
            return items.size;
        },
        clear: () => items.clear(),
        getItem: (key) => items.get(key) ?? null,
        key: (index) => [...items.keys()][index] ?? null,
        removeItem: (key) => {
            items.delete(key);
        },
        setItem: (key, value) => {
            items.set(key, String(value));
        },
    };
}

beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('useZoneStore', () => {
    it('reads in the reader\'s zone until moried says its own', async () => {
        const zones = useZoneStore();
        expect(zones.zone).toBe(READERS);
        apiMocks.getZone.mockResolvedValue('Pacific/Kiritimati');
        await zones.load();
        expect(zones.zone).toBe('Pacific/Kiritimati');
    });

    it('keeps what it has when moried names a zone this browser does not know, or cannot be asked', async () => {
        const zones = useZoneStore();
        apiMocks.getZone.mockResolvedValue('Pacific/Kiritimati');
        await zones.load();
        apiMocks.getZone.mockResolvedValue('Mars/Olympus_Mons');
        await zones.load();
        expect(zones.zone).toBe('Pacific/Kiritimati');
        apiMocks.getZone.mockRejectedValue(new Error('offline'));
        await zones.load();
        expect(zones.zone).toBe('Pacific/Kiritimati');
    });

    it('reads in the zone moried last said from the moment a page opens again', async () => {
        vi.stubGlobal('localStorage', storage());
        apiMocks.getZone.mockResolvedValue('Pacific/Kiritimati');
        await useZoneStore().load();

        setActivePinia(createPinia());
        expect(useZoneStore().zone).toBe('Pacific/Kiritimati');
        expect(apiMocks.getZone).toHaveBeenCalledTimes(1);

        // Nor does a value it cannot read take the page down.
        localStorage.setItem('moried-zone', 'Mars/Olympus_Mons');
        setActivePinia(createPinia());
        expect(useZoneStore().zone).toBe(READERS);
    });
});
