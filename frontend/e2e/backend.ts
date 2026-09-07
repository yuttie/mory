// The backend origin the e2e run pins. `.env` is untracked, so CI has no
// VITE_APP_API_URL of its own: `playwright.config.ts` hands this value to the dev
// server, and the tests intercept the same origin instead of reaching a backend.
export const API_URL = 'http://localhost:3030/api/';
