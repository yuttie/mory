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
      for (const note of notes) {
        if (note.metadata && note.metadata.events) {
          for (const [name, event] of Object.entries(note.metadata.events)) {
            if (event.start) {
              const time = Date.parse(event.start);
              if (time >= Date.now()) {
                self.events.push([time, name]);
              }
            }
            else if (event.times) {
              for (const instance of event.times) {
                if (instance.start) {
                  const time = Date.parse(instance.start);
                  if (time >= Date.now()) {
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
          icon: 'favicon.png',
        });
      }, remainingTime);
    }
  }
  self.checkEventsThreadc = setTimeout(checkEvents, 5 * 1000);
}

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (event.data.type === 'configure') {
    const config = event.data.value;

    self.apiUrl = config.apiUrl;
    self.filesUrl = new URL('files/', self.apiUrl).href;
    self.apiToken = config.apiToken;

    event.waitUntil((async () => {
      const allClients = await self.clients.matchAll({
        includeUncontrolled: true
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
        includeUncontrolled: true
      }).then((allClients) => {
        for (const client of allClients) {
          client.postMessage('api-token-updated');
        }
      });
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
