// The files URL this worker adds the token to, read from the URL the page registered it with. A
// message would not do: the browser stops a worker that has been idle for 30 seconds and starts a
// new one for the next request, which has none of the globals a message set in the old one, and the
// fetch handler has to decide synchronously whether to answer.
const filesUrl = new URL('files/', new URL(self.location.href).searchParams.get('api')).href;

// How long a request waits for a page to hand over the token. A busy page answers late rather than
// not at all, so this only gives up on one that never will, such as a tab still running an older
// version of the app, which does not know the question.
const TOKEN_REQUEST_TIMEOUT_MS = 10 * 1000;

function updateEvents() {
    fetch(self.apiUrl + 'notes', {
        mode: 'cors',
        credentials: 'include',
        headers: {
            'Authorization': `Bearer ${self.apiToken}`,
        },
    })
        .then((res) => {
            if (!res.ok) {
                throw new Error(`HTTP error! Status: ${res.status}`);
            }
            return res.json();
        })
        .then((notes) => {
            self.events = [];
            const now = Date.now();
            for (const note of notes) {
                if (note.metadata && note.metadata.events) {
                    for (const [name, event] of Object.entries(note.metadata.events)) {
                        if (event.start) {
                            const time = Date.parse(event.start);
                            if (time >= now) {
                                self.events.push([time, name]);
                            }
                        }
                        else if (event.times) {
                            for (const instance of event.times) {
                                if (instance.start) {
                                    const time = Date.parse(instance.start);
                                    if (time >= now) {
                                        self.events.push([time, name]);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
    self.updateEventsThread = setTimeout(updateEvents, 5 * 60 * 1000);
}

function checkEvents() {
    const now = Date.now();
    for (const [time, name] of self.events) {
        const remainingTime = time - now;
        if (0 <= remainingTime && remainingTime < 5 * 1000) {
            setTimeout(() => {
                self.registration.showNotification(name, {
                    icon: self.appRoot + 'favicon.png',
                });
            }, remainingTime);
        }
    }
    self.checkEventsThread = setTimeout(checkEvents, 5 * 1000);
}

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
            const allClients = await self.clients.matchAll({
                includeUncontrolled: true,
            });

            for (const client of allClients) {
                client.postMessage('configured');
            }
        })());

        // Start event watching
        if (!self.events) {
            self.events = [];
        }
        if (!self.updateEventsThread) {
            self.updateEventsThread = setTimeout(updateEvents, 0);
        }
        if (!self.checkEventsThread) {
            self.checkEventsThread = setTimeout(checkEvents, 0);
        }
    }
    else if (event.data.type === 'update-api-token') {
        self.apiToken = event.data.value;

        if (self.apiToken !== null) {
            self.clients.matchAll({
                includeUncontrolled: true,
            }).then((allClients) => {
                for (const client of allClients) {
                    client.postMessage('api-token-updated');
                }
            });
        }
    }
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
