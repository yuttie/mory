if ('workbox' in self) {
  workbox.core.setCacheNameDetails({prefix: "mory"});
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // https://developers.google.com/web/tools/workbox/guides/advanced-recipes
    console.log("skip-waiting");
    self.skipWaiting();
  }
  else if (event.data.type === 'api-url') {
    console.log("api-url");
    self.apiUrl = event.data.value;
  }
  else if (event.data.type === 'api-token') {
    console.log("api-token");
    self.apiToken = event.data.value;
  }
});

self.addEventListener('fetch', event => {
  console.log("fetch");
  if (event.request.url.startsWith(new URL('files/', self.apiUrl).href)) {
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
    console.log("I don't know about this:");
    console.log(event);
    return;
  }
});

if ('workbox' in self) {
  /**
   * The workboxSW.precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  self.__precacheManifest = [].concat(self.__precacheManifest || []);
  workbox.precaching.precacheAndRoute(self.__precacheManifest, {});
}
