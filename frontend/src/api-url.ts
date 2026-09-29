// The API's absolute URL, and that of the files it serves. The service worker adds the token to a
// request whose URL starts with the files URL, so every URL the app writes for a file has to start
// with this very string.
export const apiUrl = new URL(import.meta.env.VITE_APP_API_URL!, window.location.href).href;
export const apiFilesUrl = new URL('files/', apiUrl).href;
