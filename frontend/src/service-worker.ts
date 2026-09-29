import { ref, watch } from 'vue';
import type { Ref } from 'vue';

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

    // The worker to tell when the token changes: the one configured last.
    let worker: ServiceWorker | null = null;

    function configure(target: ServiceWorker) {
        worker = target;
        target.postMessage({
            type: 'configure',
            value: {
                apiUrl: apiUrl,
                apiToken: token.value,
                appRoot: import.meta.env.VITE_APP_APPLICATION_ROOT,
            },
        });
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

    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data === 'configured') {
            configured.value = true;
        }
        else if (event.data === 'request-api-token') {
            // The worker asks with each file it loads; see `requestToken` there for why.
            event.ports[0].postMessage(token.value);
        }
    });

    // The worker's event notifications read the token it was given last. A change before any worker
    // is configured needs no message, as `configure` carries the token as it is then.
    watch(token, (value) => {
        worker?.postMessage({
            type: 'update-api-token',
            value: value,
        });
    });

    return configured;
}
