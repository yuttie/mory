import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { API_URL, TOKEN, signIn } from './backend';

const COMMIT = 'a'.repeat(40);

interface BackendOptions {
    onSearch?: (route: Route) => Promise<void>;
    onStatus?: (route: Route) => Promise<void>;
    stoppedIndexing?: { work: string, message: string }[];
}

async function mockBackend(context: BrowserContext, options: BackendOptions = {}): Promise<void> {
    await signIn(context);
    await context.route(`${API_URL}**`, async (route) => {
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
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0, failed_images: 0 },
                },
            });
            return;
        }
        if (url.pathname === '/api/v2/search/indexing') {
            await route.fulfill({ json: { stopped: options.stoppedIndexing ?? [] } });
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
        // A repository with no files in it, rather than one whose settings all read as `[]`, which
        // the health checks would report.
        if (url.pathname.startsWith('/api/notes/') || url.pathname.startsWith('/api/v2/files/')) {
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
        semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0, failed_images: 0 },
        warnings: [],
        hits: [],
    };
}

// A one-line passage of a Markdown note, as Text mode finds one.
function hit(path: string, title: string | undefined, line: number, snippet: string): object {
    return {
        path,
        blob_id: `blob-${path}`,
        passage_id: `${path}:${line}`,
        mime_type: 'text/markdown',
        title,
        start_line: line,
        end_line: line,
        snippet,
        content_kind: 'source',
        sources: ['text'],
        score: 1,
    };
}

test('says why indexing stopped and that a restart resumes it', async ({ context, page }) => {
    await mockBackend(context, {
        stoppedIndexing: [
            { work: 'embeddings', message: 'embedding provider returned HTTP 401 Unauthorized' },
        ],
    });
    await page.goto('/search?mode=text');

    await page.getByText('Indexing stopped').first().click();

    await expect(page.getByText('embedding provider returned HTTP 401 Unauthorized')).toBeVisible();
    await expect(page.getByText('restart moried to resume indexing')).toBeVisible();
});

test('shows no indexing notice while indexing runs', async ({ context, page }) => {
    await mockBackend(context);
    await page.goto('/search?mode=text');

    await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible();
    await expect(page.getByText('Indexing stopped')).toHaveCount(0);
});

// The hint decides whether a phone's action key submits at all: without one, Chrome and Firefox on
// Android make it Next, since the mode select's input is a text field after the query's, and Next
// moves the focus there without sending Enter. A desktop browser has no such key, so the attribute
// is all there is to check.
test('asks a phone\'s keyboard for a search key rather than Next', async ({ context, page }) => {
    await mockBackend(context);
    await page.goto('/search?mode=text');

    await expect(page.getByRole('textbox', { name: 'Search' })).toHaveAttribute('enterkeyhint', 'search');
});

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

// Each keydown the page sees, and whether it came while a word was being composed: the browser
// decides that, not the test sending the key, so a test of composing checks it did.
async function recordKeys(page: Page): Promise<() => Promise<string[]>> {
    await page.evaluate(() => {
        const keys: string[] = [];
        (window as unknown as { keys: string[] }).keys = keys;
        window.addEventListener('keydown', (event) => {
            keys.push(`${event.key}${event.isComposing ? ' (composing)' : ''}`);
        }, { capture: true });
    });
    return () => page.evaluate(() => (window as unknown as { keys: string[] }).keys);
}

// A phone's action key may send its Enter while the word typed is still composed: a keydown
// composing, then the keypress an input method's own keys never send, on which the browser
// submits. A keydown handler that skipped a composing Enter, as it must an input method's, would
// drop this one.
test('searches with an Enter that comes while the word is composed', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Composes through the DevTools protocol, which only Chromium speaks.');
    let submitted: { query: string, mode: string } | undefined;
    await mockBackend(context, {
        onSearch: async (route) => {
            submitted = route.request().postDataJSON();
            await route.fulfill({ json: emptySearchResponse(submitted!) });
        },
    });
    await page.goto('/search?mode=text');
    const query = page.getByRole('textbox', { name: 'Search' });
    await query.click();
    const devtools = await context.newCDPSession(page);
    await devtools.send('Input.imeSetComposition', { text: 'path', selectionStart: 4, selectionEnd: 4 });
    await expect(query).toHaveValue('path');
    const keys = await recordKeys(page);

    await page.keyboard.press('Enter');

    expect(await keys()).toEqual(['Enter (composing)']);
    await expect.poll(() => submitted).toMatchObject({ query: 'path', mode: 'text' });
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('path');
});

// An Enter that confirms a conversion is the input method's: its keydown comes while the reading
// is composed, with the key code 229 an input method's keys have, and no keypress follows it. It
// is named Enter, as some browsers name it, for a handler of Enter to see it. Only the next Enter
// searches, for the word chosen.
test('leaves the Enter that confirms a conversion to the input method', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Composes through the DevTools protocol, which only Chromium speaks.');
    const submitted: string[] = [];
    await mockBackend(context, {
        onSearch: async (route) => {
            const request = route.request().postDataJSON();
            submitted.push(request.query);
            await route.fulfill({ json: emptySearchResponse(request) });
        },
    });
    await page.goto('/search?mode=text');
    const query = page.getByRole('textbox', { name: 'Search' });
    await query.click();
    const devtools = await context.newCDPSession(page);
    await devtools.send('Input.imeSetComposition', { text: 'けんさく', selectionStart: 4, selectionEnd: 4 });
    await expect(query).toHaveValue('けんさく');
    const keys = await recordKeys(page);

    const enter = { key: 'Enter', code: 'Enter' };
    await devtools.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...enter, windowsVirtualKeyCode: 229 });
    await devtools.send('Input.insertText', { text: '検索' });
    await devtools.send('Input.dispatchKeyEvent', { type: 'keyUp', ...enter, windowsVirtualKeyCode: 13 });
    // Long enough for a search the key started to have been sent, had it started one: the next
    // Enter would cancel its navigation before then.
    await page.waitForTimeout(500);
    expect(submitted).toEqual([]);
    await expect(query).toHaveValue('検索');

    await page.keyboard.press('Enter');

    expect(await keys()).toEqual(['Enter (composing)', 'Enter']);
    await expect.poll(() => submitted).toEqual(['検索']);
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('検索');
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
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0, failed_images: 0 },
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
                    semantic: { state: 'ready', indexed: 3, total: 3, failed: 0, failed_images: 0 },
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
                        ? { state: 'indexing', indexed: 2, total: 3, failed: 0, failed_images: 0 }
                        : { state: 'ready', indexed: 3, total: 3, failed: 0, failed_images: 0 },
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
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0, failed_images: 0 },
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
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0, failed_images: 0 },
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

test('keeps polling after a transient status failure during semantic indexing', async ({ context, page }) => {
    let searchAttempts = 0;
    let statusCalls = 0;
    await mockBackend(context, {
        onSearch: async (route) => {
            searchAttempts += 1;
            const request = route.request().postDataJSON();
            await route.fulfill({
                json: {
                    ...emptySearchResponse(request),
                    semantic: searchAttempts === 1
                        ? { state: 'indexing', indexed: 2, total: 3, failed: 0, failed_images: 0 }
                        : { state: 'ready', indexed: 3, total: 3, failed: 0, failed_images: 0 },
                },
            });
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
                    lexical: { state: 'ready', indexed_commit: COMMIT },
                    semantic: statusCalls === 1
                        ? { state: 'indexing', indexed: 2, total: 3, failed: 0, failed_images: 0 }
                        : { state: 'ready', indexed: 3, total: 3, failed: 0, failed_images: 0 },
                },
            });
        },
    });

    await page.goto('/search?q=semantic-status-retry&mode=semantic');

    await expect.poll(() => statusCalls, { timeout: 5_000 }).toBe(3);
    await expect.poll(() => searchAttempts).toBe(2);
    await expect(page.getByText('No results')).toBeVisible();
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
                        semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0, failed_images: 0 },
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
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0, failed_images: 0 },
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

test('does not rerun Grep when the independent Text index becomes ready', async ({ context, page }) => {
    let grepAttempts = 0;
    let statusCalls = 0;
    await mockBackend(context, {
        onSearch: async (route) => {
            grepAttempts += 1;
            await route.fulfill({ json: emptySearchResponse(route.request().postDataJSON()) });
        },
        onStatus: async (route) => {
            statusCalls += 1;
            await route.fulfill({
                json: {
                    commit: COMMIT,
                    head: COMMIT,
                    lexical: statusCalls === 1
                        ? { state: 'updating', indexed_commit: null }
                        : { state: 'ready', indexed_commit: COMMIT },
                    semantic: { state: 'disabled', indexed: 0, total: 0, failed: 0, failed_images: 0 },
                },
            });
        },
    });

    await page.goto('/search?q=grep-stays-current&mode=grep');

    await expect.poll(() => statusCalls, { timeout: 4_000 }).toBe(2);
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

    // Away to About, as its link in the drawer's account menu goes: by the router, which leaves the
    // page and its state in place where a reload would not.
    await page.evaluate(async () => {
        const app = (document.querySelector('#app') as HTMLElement & {
            __vue_app__: { config: { globalProperties: { $router: { push: (path: string) => Promise<unknown> } } } },
        }).__vue_app__;
        await app.config.globalProperties.$router.push('/about');
    });
    await expect.poll(() => new URL(page.url()).pathname).toBe('/about');
    await page.getByRole('textbox', { name: 'Username' }).fill('test');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Login' })).not.toBeVisible();
    await page.waitForTimeout(100);

    expect(searchAttempts).toBe(1);
});

test('preserves the draft across overlapping mode navigations', async ({ context, page }) => {
    await mockBackend(context, {
        onSearch: async (route) => {
            await route.fulfill({ json: emptySearchResponse(route.request().postDataJSON()) });
        },
    });
    await page.goto('/search?q=committed&mode=text');
    const query = page.getByRole('textbox', { name: 'Search' });
    await query.fill('draft-only');
    await page.evaluate(() => {
        const app = (document.querySelector('#app') as HTMLElement & {
            __vue_app__: { config: { globalProperties: { $router: {
                beforeEach: (guard: (to: { query: { mode?: string } }) => Promise<void> | undefined) => void,
            } } } },
        }).__vue_app__;
        const pending: Record<string, (() => void) | undefined> = {};
        Object.assign(window, { __searchModePending: pending });
        app.config.globalProperties.$router.beforeEach((to) => {
            if (to.query.mode !== 'semantic' && to.query.mode !== 'hybrid') {
                return undefined;
            }
            return new Promise<void>((resolve) => {
                pending[to.query.mode!] = resolve;
            });
        });
    });

    const mode = page.getByRole('combobox', { name: 'Mode' });
    await mode.focus();
    await mode.press('ArrowDown');
    await page.getByRole('option', { name: 'Semantic' }).click();
    await expect.poll(() => page.evaluate(() => Boolean(
        (window as typeof window & { __searchModePending?: Record<string, () => void> })
            .__searchModePending?.semantic,
    ))).toBe(true);

    await mode.focus();
    await mode.press('ArrowDown');
    await page.getByRole('option', { name: 'Hybrid' }).click();
    await expect.poll(() => page.evaluate(() => Boolean(
        (window as typeof window & { __searchModePending?: Record<string, () => void> })
            .__searchModePending?.hybrid,
    ))).toBe(true);
    await page.evaluate(() => {
        const pending = (window as typeof window & { __searchModePending: Record<string, () => void> })
            .__searchModePending;
        pending.semantic();
        pending.hybrid();
    });

    await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('hybrid');
    await expect(query).toHaveValue('draft-only');
});

test('restores the route query when history changes only the mode', async ({ context, page }) => {
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

    const mode = page.getByRole('combobox', { name: 'Mode' });
    await mode.focus();
    await mode.press('ArrowDown');
    await page.getByRole('option', { name: 'Semantic' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('semantic');

    const query = page.getByRole('textbox', { name: 'Search' });
    await query.fill('draft-only');
    await page.goBack();

    await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('text');
    await expect.poll(() => submitted.at(-1)).toMatchObject({ query: 'committed', mode: 'text' });
    await expect(query).toHaveValue('committed');
});

test('counts images that could not be described apart from passages', async ({ context, page }) => {
    let semantic = { state: 'ready', indexed: 2, total: 77, failed: 0, failed_images: 75 };
    await mockBackend(context, {
        onStatus: async (route) => {
            await route.fulfill({
                json: {
                    commit: COMMIT,
                    head: COMMIT,
                    lexical: { state: 'ready', indexed_commit: COMMIT },
                    semantic,
                },
            });
        },
    });

    // As production stood: every passage embedded, and images given up.
    await page.goto('/search?mode=semantic');
    await expect(page.getByText('75 images could not be described; coverage is partial.')).toBeVisible();
    await expect(page.getByText('could not be embedded')).toHaveCount(0);

    semantic = { state: 'ready', indexed: 3, total: 5, failed: 1, failed_images: 1 };
    await page.goto('/search?mode=hybrid');
    await expect(page.getByText(
        '1 passage could not be embedded and 1 image could not be described; coverage is partial.',
    )).toBeVisible();
});

test('groups the passages of each note under its one link, in the order the notes first ranked', async ({ context, page }) => {
    await mockBackend(context, {
        onSearch: async (route) => {
            const request = route.request().postDataJSON();
            await route.fulfill({
                json: {
                    ...emptySearchResponse(request),
                    // Ranked against the order of the paths and of the lines in each, so that
                    // sorting by either could not pass for keeping the ranks.
                    hits: [
                        hit('b.md', 'Note B', 7, 'seventh line of B'),
                        hit('a.md', 'Note A', 12, 'twelfth line of A'),
                        hit('b.md', 'Note B', 3, 'third line of B'),
                        hit('a.md', 'Note A', 3, 'third line of A'),
                    ],
                },
            });
        },
    });
    await page.goto('/search?q=grouped&mode=text');

    const notes = page.locator('#search').getByRole('listitem');
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(0)).toHaveAccessibleName('Note B');
    await expect(notes.nth(1)).toHaveAccessibleName('Note A');
    await expect(notes.nth(0).getByText(/line of B$/)).toHaveText(['seventh line of B', 'third line of B']);
    await expect(notes.nth(1).getByText(/line of A$/)).toHaveText(['twelfth line of A', 'third line of A']);
    await expect(notes.nth(1).getByText(/^line \d+/)).toHaveText([/^line 12 /, /^line 3 /]);
    await expect(page.locator('#search').getByRole('link', { name: /Note A/ })).toHaveCount(1);

    // A passage is text to select and copy; the note is reached by its header.
    await expect(page.locator('#search').getByRole('link').filter({ hasText: 'line of' })).toHaveCount(0);
    const address = page.url();
    await notes.nth(1).getByText('twelfth line of A').click({ clickCount: 3 });
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
        .toBe('twelfth line of A');
    expect(page.url()).toBe(address);
});

// Enough notes, a passage each, to scroll the page several times over.
async function mockManyNotes(context: BrowserContext): Promise<void> {
    await mockBackend(context, {
        onSearch: async (route) => {
            const request = route.request().postDataJSON();
            await route.fulfill({
                json: {
                    ...emptySearchResponse(request),
                    hits: Array.from({ length: 30 }, (_, index) => hit(
                        `note-${index}.md`,
                        `Note ${index}`,
                        1,
                        `passage of note ${index}`,
                    )),
                },
            });
        },
    });
}

test('leaves the arrow keys to the page after a click in a passage', async ({ context, page }) => {
    await mockManyNotes(context);
    await page.goto('/search?q=many&mode=text');
    const passage = page.locator('#search').getByText('passage of note 20', { exact: true });

    // A click in a passage, which is no link, focuses what holds it. When that was a v-list, it
    // took the arrow keys for its own navigation: one moved to its first link and scrolled the
    // passage away, and Shift with one could not extend a selection.
    await passage.click();
    const { y } = (await passage.boundingBox())!;
    await page.keyboard.press('ArrowDown');

    await expect.poll(async () => (await passage.boundingBox())!.y).toBeLessThan(y);
    await expect(passage).toBeInViewport();
    await expect(page.locator('#search').getByRole('link').first()).not.toBeFocused();
});

test('reaches each note by Tab', async ({ context, page }) => {
    await mockManyNotes(context);
    await page.goto('/search?q=many&mode=text');
    const links = page.locator('#search').getByRole('link');

    // The arrow keys no longer move between the notes, so Tab has to.
    await links.first().focus();
    await page.keyboard.press('Tab');
    await expect(links.nth(1)).toBeFocused();
    await expect(links.nth(1)).toHaveAccessibleName('Note 1 note-1.md');
});

test('scrolls a long passage to its end rather than cutting it', async ({ context, page }) => {
    const long = Array.from({ length: 100 }, (_, index) => `line ${index + 1} of a long passage`).join('\n');
    await mockBackend(context, {
        onSearch: async (route) => {
            const request = route.request().postDataJSON();
            await route.fulfill({
                json: { ...emptySearchResponse(request), hits: [hit('long.md', 'Long', 1, long)] },
            });
        },
    });
    await page.goto('/search?q=long&mode=text');
    const snippet = page.locator('#search').getByText(/^line 1 of a long passage/);

    // A passage does not lead to its note, so what of it is not drawn here cannot be read: its last
    // character has to come into view, where a point on it hits the passage itself.
    await snippet.hover({ position: { x: 20, y: 20 } });
    await expect(async () => {
        // Firefox scrolls a few lines for a wheel event, whatever its delta.
        await page.mouse.wheel(0, 1_000);
        expect(await snippet.evaluate((element) => {
            const text = element.firstChild!;
            const end = text.textContent!.trimEnd().length;
            const range = document.createRange();
            range.setStart(text, end - 1);
            range.setEnd(text, end);
            const { x, y, height } = range.getBoundingClientRect();
            return document.elementFromPoint(x + 1, y + height / 2) === element;
        })).toBe(true);
    }).toPass({ timeout: 5_000 });
});

test('names an untitled note by its path once', async ({ context, page }) => {
    await mockBackend(context, {
        onSearch: async (route) => {
            const request = route.request().postDataJSON();
            await route.fulfill({
                json: {
                    ...emptySearchResponse(request),
                    hits: [
                        hit('titled.md', 'Titled', 1, 'a passage'),
                        hit('untitled.md', undefined, 1, 'another passage'),
                    ],
                },
            });
        },
    });
    await page.goto('/search?q=passage&mode=text');

    await expect(page.locator('#search').getByRole('link', { name: 'Titled titled.md' })).toBeVisible();
    await expect(page.locator('#search').getByRole('link', { name: 'untitled.md', exact: true })).toBeVisible();
    await expect(page.locator('#search').getByText('untitled.md', { exact: true })).toHaveCount(1);
});
