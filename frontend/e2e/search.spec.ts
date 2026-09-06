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
        if (url.pathname === '/api/login') {
            await route.fulfill({ json: TOKEN });
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

test('does not repeat a semantic search already covered by ready status', async ({ context, page }) => {
    let attempts = 0;
    let statusCalls = 0;
    await mockBackend(context, {
        onSearch: async (route) => {
            attempts += 1;
            const request = route.request().postDataJSON();
            await route.fulfill({
                json: {
                    ...emptySearchResponse(request),
                    semantic: { state: 'ready', indexed: 3, total: 3, failed: 0 },
                },
            });
        },
        onStatus: async (route) => {
            statusCalls += 1;
            await route.fulfill({
                json: {
                    commit: COMMIT,
                    head: COMMIT,
                    lexical: { state: 'ready', indexed_commit: COMMIT },
                    semantic: statusCalls === 1
                        ? { state: 'indexing', indexed: 2, total: 3, failed: 0 }
                        : { state: 'ready', indexed: 3, total: 3, failed: 0 },
                },
            });
        },
    });

    await page.goto('/search?q=already-current&mode=semantic');
    await expect.poll(() => statusCalls, { timeout: 4_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(100);

    expect(attempts).toBe(1);
});

test('links result paths containing URL metacharacters literally', async ({ context, page }) => {
    const path = 'notes/name#draft?100%.md';
    await mockBackend(context, {
        onSearch: async (route) => {
            const request = route.request().postDataJSON();
            await route.fulfill({
                json: {
                    ...emptySearchResponse(request),
                    hits: [{
                        path,
                        blob_id: 'blob',
                        passage_id: 'passage',
                        mime_type: 'text/markdown',
                        title: 'Special path result',
                        snippet: 'Result body',
                        content_kind: 'source',
                        sources: ['text'],
                        score: 1,
                    }],
                },
            });
        },
    });
    await page.goto('/search?q=special&mode=text');

    const href = await page.getByRole('link', { name: /Special path result/ }).getAttribute('href');
    const target = new URL(href!, page.url());

    expect(decodeURIComponent(target.pathname)).toBe(`/note/${path}`);
    expect(target.search).toBe('');
    expect(target.hash).toBe('');
});

test('shows a status failure once instead of retrying forever', async ({ context, page }) => {
    let statusCalls = 0;
    await mockBackend(context, {
        onStatus: async (route) => {
            statusCalls += 1;
            await route.fulfill({
                status: 500,
                json: { message: 'Search status is unavailable' },
            });
        },
    });

    await page.goto('/search?mode=text');

    await expect(page.getByText('Search status is unavailable')).toBeVisible();
    await page.waitForTimeout(2_100);
    expect(statusCalls).toBe(1);
});

test('hands a status authentication failure to the login flow', async ({ context, page }) => {
    let statusCalls = 0;
    await mockBackend(context, {
        onStatus: async (route) => {
            statusCalls += 1;
            await route.fulfill({ status: 401, json: { message: 'Expired' } });
        },
    });

    await page.goto('/search?mode=text');

    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    await page.waitForTimeout(100);
    expect(statusCalls).toBe(1);
});

test('keeps an unsubmitted draft while a mode change reruns the committed query', async ({ context, page }) => {
    const submitted: { query: string, mode: string }[] = [];
    await mockBackend(context, {
        onSearch: async (route) => {
            const request = route.request().postDataJSON();
            submitted.push(request);
            await route.fulfill({ json: emptySearchResponse(request) });
        },
    });
    await page.goto('/search?q=committed&mode=text');
    await expect.poll(() => submitted.length).toBe(1);
    await expect(page.getByText('No results')).toBeVisible();
    const query = page.getByRole('textbox', { name: 'Search' });
    await query.fill('draft-only');

    await page.getByRole('combobox', { name: 'Mode' }).focus();
    await page.getByRole('combobox', { name: 'Mode' }).press('ArrowDown');
    await page.getByRole('option', { name: 'Semantic' }).click();

    await expect(query).toHaveValue('draft-only');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('committed');
    await expect.poll(() => submitted.at(-1)).toMatchObject({ query: 'committed', mode: 'semantic' });
});

test('keeps search errors visible until the user can act on them', async ({ context, page }) => {
    await mockBackend(context, {
        onSearch: async (route) => {
            await route.fulfill({
                status: 400,
                json: { code: 'invalid_query', message: 'The query syntax is invalid' },
            });
        },
    });

    await page.goto('/search?q=broken&mode=text');
    const error = page.getByText('The query syntax is invalid');

    await expect(error).toBeVisible();
    await page.waitForTimeout(5_100);
    await expect(error).toBeVisible();
});

test('does not restart a slow search when ready status already covers its response', async ({ context, page }) => {
    const firstCommit = '1'.repeat(40);
    const secondCommit = '2'.repeat(40);
    let statusCalls = 0;
    let searchCalls = 0;
    await mockBackend(context, {
        onSearch: async (route) => {
            searchCalls += 1;
            const request = route.request().postDataJSON();
            if (searchCalls === 2) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
            const commit = searchCalls === 1 ? firstCommit : secondCommit;
            await route.fulfill({
                json: { ...emptySearchResponse(request), commit, head: commit },
            });
        },
        onStatus: async (route) => {
            statusCalls += 1;
            const commit = statusCalls === 1 ? firstCommit : secondCommit;
            await route.fulfill({
                json: {
                    commit,
                    head: commit,
                    lexical: { state: 'ready', indexed_commit: commit },
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0 },
                },
            });
        },
    });
    await page.goto('/search?q=first&mode=text');
    await expect(page.getByText('No results')).toBeVisible();
    const query = page.getByRole('textbox', { name: 'Search' });

    await query.fill('second');
    await query.press('Enter');
    await expect.poll(() => searchCalls).toBe(2);
    await expect(page.getByText('No results')).toBeVisible();
    await page.waitForTimeout(100);

    expect(searchCalls).toBe(2);
});

test('keeps polling after a transient status failure while a search awaits indexing', async ({ context, page }) => {
    let searchAttempts = 0;
    let statusCalls = 0;
    await mockBackend(context, {
        onSearch: async (route) => {
            searchAttempts += 1;
            if (searchAttempts === 1) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                await route.fulfill({
                    status: 503,
                    json: { code: 'lexical_index_updating', message: 'Indexing' },
                });
                return;
            }
            await route.fulfill({ json: emptySearchResponse(route.request().postDataJSON()) });
        },
        onStatus: async (route) => {
            statusCalls += 1;
            if (statusCalls === 2) {
                await route.fulfill({
                    status: 500,
                    json: { message: 'Search status is temporarily unavailable' },
                });
                return;
            }
            await route.fulfill({
                json: {
                    commit: COMMIT,
                    head: COMMIT,
                    lexical: statusCalls === 1
                        ? { state: 'updating', indexed_commit: null }
                        : { state: 'ready', indexed_commit: COMMIT },
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0 },
                },
            });
        },
    });

    await page.goto('/search?q=retry-after-status-error&mode=text');

    await expect.poll(() => searchAttempts, { timeout: 4_000 }).toBe(2);
    await expect(page.getByText('No results')).toBeVisible();
    await expect(page.getByText('Search status is temporarily unavailable')).not.toBeVisible();
    expect(statusCalls).toBe(3);
});

test('does not apply an old indexing retry to a newer Grep search', async ({ context, page }) => {
    let grepAttempts = 0;
    let statusCalls = 0;
    let releaseReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
        releaseReady = resolve;
    });
    await mockBackend(context, {
        onSearch: async (route) => {
            const request = route.request().postDataJSON();
            if (request.mode === 'text') {
                await new Promise((resolve) => setTimeout(resolve, 100));
                await route.fulfill({
                    status: 503,
                    json: { code: 'lexical_index_updating', message: 'Indexing' },
                });
                return;
            }
            grepAttempts += 1;
            await route.fulfill({ json: emptySearchResponse(request) });
        },
        onStatus: async (route) => {
            statusCalls += 1;
            if (statusCalls === 1) {
                await route.fulfill({
                    json: {
                        commit: COMMIT,
                        head: COMMIT,
                        lexical: { state: 'updating', indexed_commit: null },
                        semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0 },
                    },
                });
                return;
            }
            await ready;
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
    await page.goto('/search?q=old-query&mode=text');
    await expect(page.getByText('Indexing')).toBeVisible();

    const mode = page.getByRole('combobox', { name: 'Mode' });
    await mode.focus();
    await mode.press('ArrowDown');
    await page.getByRole('option', { name: 'Grep' }).click();
    await expect.poll(() => grepAttempts).toBe(1);
    releaseReady!();
    await expect(page.getByText('No results')).toBeVisible();
    await page.waitForTimeout(100);

    expect(grepAttempts).toBe(1);
});

test('does not retry an authenticated search after leaving the view', async ({ context, page }) => {
    let searchAttempts = 0;
    await mockBackend(context, {
        onSearch: async (route) => {
            searchAttempts += 1;
            await route.fulfill({ status: 401, json: { message: 'Expired' } });
        },
    });
    await page.goto('/search?q=expired&mode=text');
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    expect(searchAttempts).toBe(1);

    await page.getByRole('link', { name: 'About' }).click({ force: true });
    await expect.poll(() => new URL(page.url()).pathname).toBe('/about');
    await page.getByRole('textbox', { name: 'Username' }).fill('test');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Login' })).not.toBeVisible();
    await page.waitForTimeout(100);

    expect(searchAttempts).toBe(1);
});
