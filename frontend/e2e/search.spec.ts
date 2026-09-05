import { expect, test } from '@playwright/test';
import type { BrowserContext, Route } from '@playwright/test';

const COMMIT = 'a'.repeat(40);
const TOKEN = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJlMmUiLCJlbWFpbCI6ImVAZS5pbnZhbGlkIiwiZXhwIjo0MTAyNDQ0ODAwfQ.';

interface BackendOptions {
    onSearch?: (route: Route) => Promise<void>;
    onStatus?: (route: Route) => Promise<void>;
}

async function mockBackend(context: BrowserContext, options: BackendOptions = {}): Promise<void> {
    await context.addInitScript((token) => {
        window.localStorage.setItem('token', JSON.stringify(token));
    }, TOKEN);
    await context.route('http://localhost:3030/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/v2/search/status' && options.onStatus !== undefined) {
            await options.onStatus(route);
            return;
        }
        if (url.pathname === '/api/v2/search/status') {
            await route.fulfill({
                json: {
                    commit: COMMIT,
                    head: COMMIT,
                    lexical: { state: 'ready', indexed_commit: COMMIT },
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0 },
                },
            });
            return;
        }
        if (url.pathname === '/api/v2/search' && options.onSearch !== undefined) {
            await options.onSearch(route);
            return;
        }
        if (url.pathname === '/api/v2/entries') {
            await route.fulfill({
                json: { kind: 'full', commit: COMMIT, head: COMMIT, entries: [] },
            });
            return;
        }
        if (url.pathname.startsWith('/api/notes/.mory/custom.')) {
            await route.fulfill({ status: 404, json: {} });
            return;
        }
        await route.fulfill({ json: [] });
    });
}

function emptySearchResponse(request: { mode: string }): object {
    return {
        requested_mode: request.mode,
        executed_modes: [request.mode],
        commit: COMMIT,
        head: COMMIT,
        lexical: { state: 'ready', indexed_commit: COMMIT },
        semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0 },
        warnings: [],
        hits: [],
    };
}

test('allows slash input and submits the query with Enter', async ({ context, page }) => {
    let submitted: { query: string, mode: string } | undefined;
    await mockBackend(context, {
        onSearch: async (route) => {
            submitted = route.request().postDataJSON();
            await route.fulfill({ json: emptySearchResponse(submitted!) });
        },
    });
    await page.goto('/search?mode=text');
    const query = page.getByRole('textbox', { name: 'Search' });

    await query.fill('path');
    await query.press('/');
    await query.type('research');
    await query.press('Enter');

    await expect.poll(() => submitted).toMatchObject({ query: 'path/research', mode: 'text' });
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('path/research');
});

test('retries an updating search when the first status response is ready', async ({ context, page }) => {
    let attempts = 0;
    let releaseStatus: (() => void) | undefined;
    const searchFailed = new Promise<void>((resolve) => {
        releaseStatus = resolve;
    });
    await mockBackend(context, {
        onSearch: async (route) => {
            attempts += 1;
            if (attempts === 1) {
                await route.fulfill({
                    status: 503,
                    json: { code: 'lexical_index_updating', message: 'Indexing' },
                });
                releaseStatus!();
                return;
            }
            const request = route.request().postDataJSON();
            await route.fulfill({ json: emptySearchResponse(request) });
        },
        onStatus: async (route) => {
            await searchFailed;
            await new Promise((resolve) => setTimeout(resolve, 50));
            await route.fulfill({
                json: {
                    commit: COMMIT,
                    head: COMMIT,
                    lexical: { state: 'ready', indexed_commit: COMMIT },
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0 },
                },
            });
        },
    });

    await page.goto('/search?q=retry-me&mode=text');

    await expect.poll(() => attempts).toBe(2);
    await expect(page.getByText('No results')).toBeVisible();
});
