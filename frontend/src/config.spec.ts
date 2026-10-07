import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { watch, nextTick } from 'vue';

beforeEach(() => {
    vi.resetModules();
    const entries = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

it('notifies an existing consumer when Config saves the same setting', async () => {
    const { useConfigValue, saveConfigValue } = await import('./config');
    const consumer = useConfigValue('font', 'monospace');
    const config = useConfigValue('font', 'monospace');
    const observed = vi.fn();
    const stop = watch(consumer, observed);
    config.value = 'serif';
    await nextTick();
    expect(consumer.value).toBe('serif');
    expect(observed).toHaveBeenCalledOnce();
    expect(localStorage.getItem('font')).toBe('"serif"');
    saveConfigValue('font', 'sans-serif');
    await nextTick();
    expect(consumer.value).toBe('sans-serif');
    expect(observed).toHaveBeenCalledTimes(2);
    stop();
});

it('reads a saved preference without writing a fallback during setup', async () => {
    const { useConfigValue } = await import('./config');
    localStorage.setItem('font', '"serif"');
    expect(useConfigValue('font', 'monospace').value).toBe('serif');
    expect(useConfigValue('size', 14).value).toBe(14);
    expect(localStorage.getItem('size')).toBeNull();
});
