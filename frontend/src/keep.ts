import type { Ref } from 'vue';

/// Put `next` in `target` only if it differs from what `target` holds.
///
/// A store reading a configuration file again at each commit nearly always finds it as it was, and
/// an equal value put in place of the old one makes everything derived from it work itself out
/// again. Compared as JSON, so for plain data read from a file: no `Map`s, no functions, and a key
/// holding `undefined` the same as one absent.
export function keepEqual<T>(target: Ref<T>, next: T): void {
    if (JSON.stringify(target.value) !== JSON.stringify(next)) {
        target.value = next;
    }
}
