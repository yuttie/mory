import { watch } from 'vue';
import type { Ref } from 'vue';

import * as api from '@/api';

// The page's half of event alarms, which moried sends as Web Push at each event's start and the
// service worker shows; see its `push` handler for why the worker cannot wait for one itself, and
// `backend/src/push.rs` for the sender. This page only subscribes, and tells moried where to send.

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
    // `atob` does without the padding, but not without the standard alphabet.
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
    if (a === null || a.byteLength !== b.length) {
        return false;
    }
    const bytes = new Uint8Array(a);
    return bytes.every((byte, i) => byte === b[i]);
}

// Registered on every load, which is what refills moried's copy should its cache be deleted, and
// subscribed afresh when moried's key has changed, as it does when `MORIED_SECRET` is rotated.
async function subscribe(): Promise<void> {
    if (!('PushManager' in window) || !('Notification' in window)
        || Notification.permission !== 'granted') {
        return;
    }
    const key = base64UrlToBytes(await api.getPushKey());
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription !== null && !sameBytes(subscription.options.applicationServerKey, key)) {
        await subscription.unsubscribe();
        subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
    });
    const { endpoint, keys } = subscription.toJSON();
    if (endpoint === undefined || keys === undefined) {
        throw new Error('The push subscription has no endpoint or keys.');
    }
    await api.putPushSubscription({
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
}

/// Subscribes now, as once notifications have just been allowed.
export function requestEventAlarms(): void {
    subscribe().catch((error) => {
        console.warn('Failed to subscribe to event alarms:', error);
    });
}

/// Subscribes whenever there is a session: at once, and again on each sign-in, since moried
/// refuses a registration without one. After the flush, so that `useLocalStorage` has stored the
/// token `getAxios()` reads.
export function watchEventAlarms(token: Ref<string | null>): void {
    watch(token, (value) => {
        if (value !== null) {
            requestEventAlarms();
        }
    }, { immediate: true, flush: 'post' });
}

/// Stops this browser's alarms, which name events from a private repository.
export async function endEventAlarms(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
        return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription === null || subscription === undefined) {
        return;
    }
    // moried also forgets a subscription the push service reports ended, so a failure here only
    // leaves it to do so at the next alarm.
    await api.deletePushSubscription(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
}
