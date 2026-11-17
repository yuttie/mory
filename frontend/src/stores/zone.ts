// The zone a time written without an offset is read in, which is moried's.
//
// A note means the same moments in every browser: moried rings its alarms and the MCP tools read
// such a time in moried's zone, so the web app reads one there too, wherever its reader is. Only
// what is shown is put in the reader's own zone. The calendar still reads one in the reader's, until
// it draws what moried expands.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import * as api from '@/api';

// Where the zone moried last said is kept, so that a page opened again reads a time as it will once
// moried answers.
const STORAGE_KEY = 'moried-zone';

export const useZoneStore = defineStore('zone', () => {
    const said = ref<string | null>(stored());
    // Until moried first says, the reader's own, which is moried's for most readers. One Intl does
    // not know would throw from every time read in it, and those are read inside computeds.
    const zone = computed(() => (isKnownZone(said.value) ? said.value : readersZone()));

    // Asked by the app store whenever there is a session, since moried refuses the question
    // without one.
    async function load(): Promise<void> {
        try {
            const answer = await api.getZone();
            if (!isKnownZone(answer)) {
                console.warn('moried reads times in a zone this browser does not know:', answer);
                return;
            }
            said.value = answer;
            try {
                localStorage.setItem(STORAGE_KEY, answer);
            }
            catch {
                // Kept for this page alone, then.
            }
        }
        catch (error) {
            console.warn('Failed to ask moried for its zone:', error);
        }
    }

    return { zone, load };
});

function stored(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    }
    catch {
        return null;
    }
}

function readersZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function isKnownZone(zone: unknown): zone is string {
    if (typeof zone !== 'string' || zone === '') {
        return false;
    }
    try {
        return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone !== '';
    }
    catch {
        return false;
    }
}
