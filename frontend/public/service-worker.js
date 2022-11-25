self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (event.data.type === 'configure') {
    const config = event.data.value;
    if (config.apiUrl) {
      self.apiUrl = config.apiUrl;
      self.filesUrl = new URL('files/', self.apiUrl).href;
    }
    if (config.apiToken) {
      self.apiToken = config.apiToken;
    }
    if (self.apiUrl && self.apiToken) {
      event.waitUntil((async () => {
        const allClients = await self.clients.matchAll({
          includeUncontrolled: true
        });

        for (const client of allClients) {
          client.postMessage('configured');
        }
      })());
    }
  }
});

self.addEventListener('fetch', event => {
  if (event.request.url.startsWith(self.filesUrl)) {
    event.respondWith(
      fetch(event.request, {
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${self.apiToken}`,
        },
      })
    );
  }
  else {
    return;
  }
});
