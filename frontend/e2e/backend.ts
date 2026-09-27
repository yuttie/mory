import type { BrowserContext } from '@playwright/test';
import YAML from 'yaml';

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

// A UUIDv4 told apart by `n`: a task whose file is not named with one is left out of the tree.
export function uuid(n: number): string {
    return `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

export interface Repository {
    writes: { path: string; content: string }[];
}

// A repository of notes, listed with the metadata their frontmatter holds, so a write shows up in
// the listing the way the backend would show it.
export async function mockBackend(context: BrowserContext, notes: Record<string, string>): Promise<Repository> {
    const files = new Map(Object.entries(notes));
    const repository: Repository = { writes: [] };
    let commit = 1;
    const commitId = () => String(commit).padStart(40, '0');

    await signIn(context);
    await context.route(`${API_URL}**`, async (route) => {
        const request = route.request();
        const path = decodeURIComponent(new URL(request.url()).pathname);
        if (path === '/api/v2/entries') {
            const entries = [...files].map(([notePath, content]) => ({
                path: notePath,
                size: content.length,
                mime_type: 'text/markdown',
                metadata: YAML.parse(content.split(/^---$/m)[1]),
                title: /^# (.*)$/m.exec(content.split(/^---$/m)[2])?.[1] ?? null,
                time: '2026-09-01T12:00:00+00:00',
            }));
            await route.fulfill({ json: { kind: 'full', commit: commitId(), head: commitId(), entries } });
            return;
        }
        if (path === '/api/v2/commits/head') {
            await route.fulfill({ json: commitId() });
            return;
        }
        if (path === '/api/login') {
            await route.fulfill({ json: TOKEN });
            return;
        }
        if (path.startsWith('/api/notes/')) {
            const notePath = path.slice('/api/notes/'.length);
            if (request.method() === 'PUT') {
                const content = request.postDataJSON().Save.content as string;
                files.set(notePath, content);
                repository.writes.push({ path: notePath, content });
                commit += 1;
                await route.fulfill({ json: null });
                return;
            }
            const content = files.get(notePath);
            if (content === undefined) {
                await route.fulfill({ status: 404, json: {} });
                return;
            }
            await route.fulfill({ body: content, contentType: 'text/markdown' });
            return;
        }
        await route.fulfill({ json: [] });
    });
    return repository;
}
