import { computed, shallowRef } from 'vue';
import type { Ref, WritableComputedRef } from 'vue';

// Defaults shared by Config and its consumers.
export const EDITOR_FONT_SIZE = 14;

// How many rows the note tree shows before "Show older" is pressed, and how many each press adds.
export const NOTE_TREE_INITIAL_ROWS = 10;
export const NOTE_TREE_ROW_INCREMENT = 10;

const values = new Map<string, Ref<unknown>>();

export function loadConfigValue<T>(key: string, default_: T): T {
    const value = localStorage.getItem(key);
    return value === null ? default_ : JSON.parse(value);
}

export function saveConfigValue<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
    const shared = values.get(key);
    if (shared) {
        shared.value = value;
    }
}

// localStorage alone cannot notify the view behind Config: storage events only reach other tabs.
export function useConfigValue<T>(key: string, default_: T): WritableComputedRef<T> {
    let shared = values.get(key);
    if (!shared) {
        shared = shallowRef(loadConfigValue(key, default_));
        values.set(key, shared);
    }
    const value = shared;
    return computed({
        get: () => value.value as T,
        set: (next: T) => saveConfigValue(key, next),
    });
}
