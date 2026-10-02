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
// has lost every global it set, and a page's answer is always current. Any page will do, as
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
});

// How far from now a time may be before a weekday no longer says which day it is.
const WEEKDAY_ENOUGH_MS = 6 * 24 * 60 * 60 * 1000;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// How a time is said, which is in the locale and zone of whoever is reading it, as `undefined` is to
// `Intl`: the part of a day, a weekday, and the day itself.
const TIME = { hour: 'numeric', minute: '2-digit' };
const WEEKDAY = { weekday: 'short' };
const DATE = { weekday: 'short', month: 'short', day: 'numeric' };
const say = (date, options) => new Intl.DateTimeFormat(undefined, options).format(date);

// When the occurrence an alarm is for starts, as its reader would say it. moried sends the moment
// and leaves the words to this worker, which is in the reader's zone and locale where moried is not:
// the time alone for one today, a weekday and the time for one within the week, and the date as well
// beyond it, where a weekday would not say which. A whole day, which `start` then is, has no time.
// Nothing for a payload that carries no start, such as one from an older moried.
function whenIs(alarm, now) {
    if (typeof alarm.start !== 'string') {
        return undefined;
    }
    if (alarm.all_day === true) {
        const [year, month, day] = alarm.start.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return Number.isNaN(date.getTime()) ? undefined : say(date, DATE);
    }
    const start = new Date(alarm.start);
    if (Number.isNaN(start.getTime())) {
        return undefined;
    }
    if (startOfDay(start) === startOfDay(now)) {
        return say(start, TIME);
    }
    const near = Math.abs(start.getTime() - now.getTime()) < WEEKDAY_ENOUGH_MS;
    return say(start, near ? { ...WEEKDAY, ...TIME } : { ...DATE, ...TIME });
}

// What a notification says under its title: when the event is, then what moried added to it, such as
// where. Only text is said, and an empty part is no part.
function bodyOf(alarm, now) {
    return [whenIs(alarm, now), alarm.body]
        .filter((part) => typeof part === 'string' && part !== '')
        .join(' · ');
}

// An event alarm, which moried sends ahead of or at the event's start; see `backend/src/push.rs`.
// This worker cannot wait for one itself: the browser stops it after 30 seconds idle, and its
// timers with it.
self.addEventListener('push', (event) => {
    let alarm;
    try {
        alarm = event.data.json();
    }
    catch {
        alarm = null;
    }
    if (typeof alarm?.title !== 'string') {
        // Not one of moried's, such as the test message DevTools sends. Something must still be
        // shown, as the subscription promised; the browser shows a warning of its own otherwise.
        alarm = { title: 'mory', body: event.data?.text() };
    }
    // An alarm ahead of its event says when the event is, which the moment it is shown does not.
    const body = bodyOf(alarm, new Date());
    event.waitUntil(self.registration.showNotification(alarm.title, {
        body: body === '' ? undefined : body,
        tag: alarm.tag,
        // A later alarm for the same occurrence replaces the one still showing, and a replacement
        // is silent unless asked otherwise. The browser refuses `renotify` without a tag.
        renotify: typeof alarm.tag === 'string' && alarm.tag !== '',
        icon: new URL('favicon.png', self.registration.scope).href,
        data: { path: alarm.path },
    }));
});

// Where the app shows a note: `/note/:path*` in `src/router/index.ts`, a segment per directory.
function noteUrl(path) {
    return new URL(`note/${path.split('/').map(encodeURIComponent).join('/')}`, self.registration.scope).href;
}

// Opens the note an alarm is for. A tab of the app already open is asked to route to it, as a
// link inside the app would, rather than loaded afresh, which would lose whatever it has unsaved.
// Declared at the top level for the e2e tests to call, as a click on a notification cannot be
// simulated.
async function openNote(path) {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (open === undefined) {
        await self.clients.openWindow(path === undefined ? self.registration.scope : noteUrl(path));
        return;
    }
    if (path !== undefined) {
        open.postMessage({ type: 'open-note', path: path });
    }
    await open.focus();
}

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(openNote(event.notification.data?.path));
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
