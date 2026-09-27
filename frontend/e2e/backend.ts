import type { BrowserContext } from '@playwright/test';

// The backend origin the e2e run pins. `.env` is untracked, so CI has no
// VITE_APP_API_URL of its own: `playwright.config.ts` hands this value to the dev
// server, and the tests intercept the same origin instead of reaching a backend.
export const API_URL = 'http://localhost:3030/api/';

// A session token the app accepts. It is never checked: the tests answer every request themselves.
export const TOKEN = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJlMmUiLCJlbWFpbCI6ImVAZS5pbnZhbGlkIiwiZXhwIjo0MTAyNDQ0ODAwfQ.';

// Opens every page of the context signed in, as a stored session would.
export async function signIn(context: BrowserContext): Promise<void> {
    await context.addInitScript((token) => {
        window.localStorage.setItem('token', JSON.stringify(token));
    }, TOKEN);
}
