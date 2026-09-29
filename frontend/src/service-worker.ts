import { ref, watch } from 'vue';
import type { Ref } from 'vue';

import * as api from '@/api';
import { apiUrl } from '@/api-url';

// The page's half of the conversation with the service worker, `public/service-worker.js`, which
// adds the token to what the page loads from the files API by URL: an <img> or a <video> cannot
// send it. Returns whether a worker has been configured, since the app shows nothing until one has.
export function connectServiceWorker(token: Ref<string | null>): Ref<boolean> {
    const configured = ref(false);
    if (!('serviceWorker' in navigator)) {
        console.error('Service workers are not supported.');
        return configured;
    }

    // The API URL goes in the script's URL, where every copy of the worker the browser starts can
    // read it; see `filesUrl` in the worker.
    const scriptUrl = `${import.meta.env.BASE_URL}service-worker.js?${new URLSearchParams({ api: apiUrl })}`;
    navigator.serviceWorker.register(scriptUrl).then(() => {
        console.log('Service worker registration succeeded.');
    }).catch((error) => {
        console.error(`Service worker registration failed: ${error}`);
    });

    function configure(target: ServiceWorker) {
        target.postMessage({ type: 'configure' });
    }

    navigator.serviceWorker.ready
        .then((registration) => {
            console.log(`A service worker is active: ${registration.active}`);
            configure(registration.active!);
        });

    // A new version of the worker takes over the page as soon as it is installed, which can be
    // while the page is still waiting for the old one to answer `configure`. The old one is then
    // discarded without answering, and the page, which shows nothing until it hears back, would
    // stay blank.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (navigator.serviceWorker.controller !== null) {
            configure(navigator.serviceWorker.controller);
        }
    });

    // Once there is a worker to receive alarms and a session to register it with, and again on
    // each sign-in, since moried refuses a registration without one.
    watch([configured, token], ([isConfigured, value]) => {
        if (isConfigured && value !== null) {
            subscribeToEventAlarms().catch((error) => {
                console.warn('Failed to subscribe to event alarms:', error);
            });
        }
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data === 'configured') {
            configured.value = true;
        }
        else if (event.data === 'request-api-token') {
            // The worker asks with each file it loads; see `requestToken` there for why.
            event.ports[0].postMessage(token.value);
        }
    });

    return configured;
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '='));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
    if (a === null || a.byteLength !== b.length) {
        return false;
    }
    const bytes = new Uint8Array(a);
    return bytes.every((byte, i) => byte === b[i]);
}

// Event alarms come by Web Push: moried sends each at its event's start, and the worker shows it.
// The worker cannot wait for one itself, as the browser stops it after 30 seconds idle, timers
// and all. This page only subscribes, and tells moried where to send.
//
// Registered on every load, which is what refills moried's copy should its cache be deleted, and
// subscribed afresh when moried's key has changed, as it does when `MORIED_SECRET` is rotated.
export async function subscribeToEventAlarms(): Promise<void> {
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

// Stops this browser's alarms, which name events from a private repository. For signing out on
// purpose only: an expired session signs out too, and should not end them.
export async function unsubscribeFromEventAlarms(): Promise<void> {
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
