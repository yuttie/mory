self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (event.data.type === 'api-url') {
    self.apiUrl = event.data.value;
    self.filesUrl = new URL('files/', self.apiUrl).href;
  }
  else if (event.data.type === 'api-token') {
    self.apiToken = event.data.value;
    event.waitUntil((async () => {
      const allClients = await self.clients.matchAll({
        includeUncontrolled: true
      });

      for (const client of allClients) {
        client.postMessage('api-token-received');
      }
    })());
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
