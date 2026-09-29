// The files URL this worker adds the token to, read from the URL the page registered it with. A
// message would not do: the browser stops a worker that has been idle for 30 seconds and starts a
// new one for the next request, which has none of the globals a message set in the old one, and the
// fetch handler has to decide synchronously whether to answer.
const filesUrl = new URL('files/', new URL(self.location.href).searchParams.get('api')).href;

// How long a request waits for a page to hand over the token. A busy page answers late rather than
// not at all, so this only gives up on one that never will, such as a tab still running an older
// version of the app, which does not know the question.
const TOKEN_REQUEST_TIMEOUT_MS = 10 * 1000;

// The token, asked of a page for each request rather than kept: a worker the browser has restarted
// has lost the one `configure` gave it, and a page's answer is always current. Any page will do, as
// they all hold the one token kept in localStorage. The page that made the request is asked when
// there is one. A page load, such as an image opened in a tab of its own, comes from no page, and
// passes through this worker whenever the API shares the app's origin; the page focused last is
// asked for it instead.
async function requestToken(clientId) {
    const client = await self.clients.get(clientId)
        ?? (await self.clients.matchAll({ type: 'window' }))[0];
    if (client === undefined) {
        return null;
    }
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        const timeoutId = setTimeout(() => {
            resolve(null);
        }, TOKEN_REQUEST_TIMEOUT_MS);
        channel.port1.onmessage = (event) => {
            clearTimeout(timeoutId);
            resolve(event.data);
        };
        client.postMessage('request-api-token', [channel.port2]);
    });
}

self.addEventListener('install', () => {
    // Replace the worker the open pages have now, rather than once every one of them has closed,
    // which reloading one never achieves: the reloaded page is handed to the old worker before the
    // new one can take over. `activate` then claims them.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
    if (event.data.type === 'configure') {
        const config = event.data.value;

        self.apiUrl = config.apiUrl;
        self.apiToken = config.apiToken;
        self.appRoot = config.appRoot;

        event.waitUntil((async () => {
            // A page loaded past the worker, as Shift+Reload loads one, is not controlled, and what it
            // loads from the files API would go out without the token. Take it over before letting it
            // show anything.
            await self.clients.claim();
            const allClients = await self.clients.matchAll({
                includeUncontrolled: true,
            });

            for (const client of allClients) {
                client.postMessage('configured');
            }
        })());
    }
    else if (event.data.type === 'update-api-token') {
        self.apiToken = event.data.value;
    }
});

// An event alarm, which moried sends at the event's start; see `backend/src/push.rs`. This worker
// cannot wait for one itself: the browser stops it after 30 seconds idle, and its timers with it.
self.addEventListener('push', (event) => {
    let alarm;
    try {
        alarm = event.data.json();
    }
    catch {
        // Not one of moried's, such as the test message DevTools sends. Something must still be
        // shown, as the subscription promised; the browser shows a warning of its own otherwise.
        alarm = { title: 'mory', body: event.data?.text() };
    }
    event.waitUntil(self.registration.showNotification(alarm.title, {
        body: alarm.body,
        tag: alarm.tag,
        icon: new URL('favicon.png', self.registration.scope).href,
        data: { path: alarm.path },
    }));
});

// Opens the note an alarm is for. A tab of the app already open is asked to route to it, as a
// link inside the app would, rather than loaded afresh, which would lose whatever it has unsaved.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const path = event.notification.data?.path;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const open = windows.find((client) => client.url.startsWith(self.registration.scope));
        if (open !== undefined) {
            if (path !== undefined) {
                open.postMessage({ type: 'open-note', path: path });
            }
            await open.focus();
            return;
        }
        await self.clients.openWindow(path === undefined
            ? self.registration.scope
            : new URL(`note/${path.split('/').map(encodeURIComponent).join('/')}`, self.registration.scope).href);
    })());
});

self.addEventListener('fetch', event => {
    if (event.request.url.startsWith(filesUrl)) {
        event.respondWith((async () => {
            const apiToken = await requestToken(event.clientId);
            // Without a token, no header at all: `Bearer null` would reach moried's log as a token
            // that failed to decode.
            const headers = apiToken === null ? {} : { 'Authorization': `Bearer ${apiToken}` };
            return fetch(event.request, {
                mode: 'cors',
                credentials: 'include',
                headers: headers,
            });
        })());
    }
    else {
        return;
    }
});
