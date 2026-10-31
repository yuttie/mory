import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { API_URL, mockBackend, uuid } from './backend';

const PROJECT = uuid(1);
const REPORT = uuid(2);

const FILES = {
    'ideas.md': '# Ideas\n',
    'ideas/draft.md': '---\ntags: [thesis]\n---\n\n# Draft chapter\n',
    'journal/monday.md': '# Monday\n',
    [`.tasks/${PROJECT}.md`]: '---\ntask:\n    status: {kind: todo}\n---\n\n# Thesis\n',
    [`.tasks/${PROJECT}/${REPORT}.md`]: '---\ntask:\n    status: {kind: in_progress}\n---\n\n# Write the report\n',
    'lecture.template': '# XXX lecture YY\n',
};

const TIMES = {
    'ideas.md': '2026-10-01T09:00:00+00:00',
    'ideas/draft.md': '2026-10-21T09:00:00+00:00',
    'journal/monday.md': '2026-10-20T09:00:00+00:00',
    [`.tasks/${PROJECT}.md`]: '2026-10-10T09:00:00+00:00',
    [`.tasks/${PROJECT}/${REPORT}.md`]: '2026-10-15T09:00:00+00:00',
    'lecture.template': '2026-10-05T09:00:00+00:00',
};

function palette(page: Page): Locator {
    return page.getByRole('dialog').filter({ has: page.getByRole('listbox', { name: 'Files' }) });
}

function search(page: Page): Locator {
    return palette(page).getByRole('combobox', { name: 'Search' });
}

function titles(page: Page): Locator {
    return palette(page).getByRole('option').locator('.v-list-item-title');
}

function selected(page: Page): Locator {
    return palette(page).getByRole('option', { selected: true });
}

function tab(page: Page, name: string): Locator {
    return palette(page).getByRole('tab', { name, exact: true });
}

// Opened, and done opening: Vuetify leaves an Escape pressed while its dialog scales in unanswered.
async function open(page: Page): Promise<void> {
    await page.keyboard.press('Control+k');
    await expect(search(page)).toBeFocused();
    const content = page.locator('.v-overlay__content').filter({ has: page.getByRole('listbox', { name: 'Files' }) });
    await expect.poll(() => content.evaluate((element) => element.getAnimations().length)).toBe(0);
}

// What became of each key pressed from here on, as the window sees it once what has the focus has
// had it: one the palette answers, it keeps from the browser. So a key it left alone is told at
// once, rather than by waiting out a dialog's closing or a navigation to see that nothing came of it.
async function recordKeys(page: Page): Promise<() => Promise<string[]>> {
    await page.evaluate(() => {
        const keys: string[] = [];
        (window as unknown as { keys: string[] }).keys = keys;
        window.addEventListener('keydown', (event) => {
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
                return;
            }
            const name = `${event.ctrlKey ? 'Control+' : ''}${event.key}${event.isComposing ? ' (composing)' : ''}`;
            keys.push(`${name}: ${event.defaultPrevented ? 'taken' : 'left'}`);
        });
    });
    return () => page.evaluate(() => (window as unknown as { keys: string[] }).keys);
}

// More files than the list has room for, listed by their numbers: each changed a minute before the
// one numbered before it.
const MANY = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`many/${i}.md`, `# Many ${i}\n`]));
const MANY_TIMES = Object.fromEntries(Array.from(
    { length: 40 },
    (_, i) => [`many/${i}.md`, `2026-10-01T09:${String(59 - i).padStart(2, '0')}:00+00:00`],
));

function option(page: Page, index: number): Locator {
    return palette(page).getByRole('option').nth(index);
}

function selectedIndex(page: Page): Promise<number> {
    return palette(page).getByRole('option').evaluateAll(
        (options) => options.findIndex((each) => each.getAttribute('aria-selected') === 'true'),
    );
}

// Typed key by key, as a person types: the palette listens for `keydown`, which `fill` never sends.
test('opens from any view with Ctrl+K, and opens the file the arrows choose', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/calendar/month/2026/10/07');
    await open(page);
    // The files last changed first, as the Files view lists them until told otherwise.
    await expect(titles(page)).toHaveText(
        ['Draft chapter', 'Monday', 'Write the report', 'Thesis', 'lecture.template', 'Ideas', 'Show all 6 in Files'],
    );
    await expect(selected(page)).toContainText('Draft chapter');

    // In the words the Files view finds a file by: a tag, as well as a title.
    await search(page).pressSequentially('th');
    await expect(titles(page)).toHaveText(['Draft chapter', 'Write the report', 'Thesis', 'Show all 3 in Files']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(selected(page)).toContainText('Write the report');
    await expect(search(page)).toHaveAttribute('aria-activedescendant', await selected(page).getAttribute('id') ?? '');
    // A page at a time, and no further than the last. Not the calendar's, which turns back a year
    // with PageDown: the address is read once the calendar would have turned, had it taken the key.
    await page.keyboard.press('PageDown');
    await expect(selected(page)).toContainText('Show all 3 in Files');
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/calendar\/month\/2026\/10\/07$/);
    await page.keyboard.press('PageUp');
    await expect(selected(page)).toContainText('Draft chapter');
    await page.keyboard.press('ArrowDown');
    await expect(selected(page)).toContainText('Write the report');

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/note/.tasks/${PROJECT}/${REPORT}.md`);
    await expect(palette(page)).toBeHidden();
});

test('moves down and up with Ctrl+N and Ctrl+P too, and opens with Ctrl+M', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await open(page);
    await search(page).pressSequentially('th');
    await expect(titles(page)).toHaveText(['Draft chapter', 'Write the report', 'Thesis', 'Show all 3 in Files']);
    const keys = await recordKeys(page);
    await page.keyboard.press('Control+n');
    await page.keyboard.press('Control+n');
    await expect(selected(page)).toContainText('Thesis');
    await page.keyboard.press('Control+p');
    await expect(selected(page)).toContainText('Write the report');
    // Round from the first to the last, as the arrows go.
    await page.keyboard.press('Control+p');
    await page.keyboard.press('Control+p');
    await expect(selected(page)).toContainText('Show all 3 in Files');
    await expect(search(page)).toHaveValue('th');
    await expect(palette(page)).toBeVisible();

    // And opens the one chosen with Ctrl+M, as with Enter.
    await page.keyboard.press('Control+n');
    await expect(selected(page)).toContainText('Draft chapter');
    await page.keyboard.press('Control+m');
    await expect(page).toHaveURL('/note/ideas/draft.md');
    await expect(palette(page)).toBeHidden();
    // Each kept from the browser, which would print the page with Ctrl+P and mute it with Ctrl+M.
    expect(await keys()).toEqual([
        'Control+n: taken',
        'Control+n: taken',
        'Control+p: taken',
        'Control+p: taken',
        'Control+p: taken',
        'Control+n: taken',
        'Control+m: taken',
    ]);
});

test('moves between the kinds of file with Tab, as the Files view has them', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await open(page);
    await expect(tab(page, 'All')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Tab');
    await expect(tab(page, 'Notes')).toHaveAttribute('aria-selected', 'true');
    await expect(search(page)).toBeFocused();
    await expect(titles(page)).toHaveText(['Draft chapter', 'Monday', 'Ideas', 'Show all 3 in Files']);
    // Beside each, the folder it is in.
    await expect(selected(page)).toContainText('ideas');

    await page.keyboard.press('Tab');
    await expect(tab(page, 'Tasks')).toHaveAttribute('aria-selected', 'true');
    await expect(titles(page)).toHaveText(['Write the report', 'Thesis', 'Show all 2 in Files']);
    // The project it is part of, and its status.
    await expect(selected(page)).toContainText('Thesis · In progress');
    // Into the task's editor, as the Tasks tab opens it.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/tasks-next/${REPORT}/descendants/schedule?task=${REPORT}`);
    await expect(palette(page)).toBeHidden();
});

test('goes round the kinds the other way with Shift+Tab, and keeps the focus on a click', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await open(page);
    await page.keyboard.press('Shift+Tab');
    await expect(tab(page, 'Uncategorized')).toHaveAttribute('aria-selected', 'true');
    await expect(palette(page)).toContainText('Nothing to list.');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeVisible();

    await tab(page, 'Templates').click();
    await expect(tab(page, 'Templates')).toHaveAttribute('aria-selected', 'true');
    await expect(search(page)).toBeFocused();
    // By the name the Add menu offers it as.
    await expect(titles(page)).toHaveText(['lecture', 'Show all 1 in Files']);
});

test('closes with Escape or Ctrl+K, giving the focus back, and opens afresh', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/files');
    const filesSearch = page.getByRole('textbox', { name: 'Search' });
    await filesSearch.click();
    await open(page);
    await search(page).pressSequentially('mon');
    await page.keyboard.press('Tab');
    await expect(titles(page)).toHaveText(['Monday', 'Show all 1 in Files']);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(filesSearch).toBeFocused();
    await expect(filesSearch).toHaveValue('');

    await open(page);
    await expect(search(page)).toHaveValue('');
    await expect(tab(page, 'All')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeHidden();
    await expect(filesSearch).toBeFocused();
});

test('goes round from the first file to the search in the Files view', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await open(page);
    await search(page).pressSequentially('th');
    await page.keyboard.press('Tab');
    await expect(titles(page)).toHaveText(['Draft chapter', 'Show all 1 in Files']);
    await page.keyboard.press('ArrowUp');
    await expect(selected(page)).toContainText('Show all 1 in Files');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/files/notes?q=th');
    await expect(page.getByRole('textbox', { name: 'Search' })).toHaveValue('th');
    await expect(page.locator('.file-table tbody tr')).toHaveCount(1);
});

test('opens over a note being written, and gives the focus back to it', async ({ context, page }) => {
    await mockBackend(context, { 'plan.md': '# Plan\n' });
    await page.goto('/note/plan.md');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await page.keyboard.press('e');
    await expect(page.locator('.cm-content')).toBeFocused();

    await open(page);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(page.locator('.cm-content')).toBeFocused();
});

// Typed straight after the key, before the dialog has even begun to scale in: what had the focus
// would take them otherwise, as the note being written would its text.
test('takes the keys typed straight after Ctrl+K', async ({ context, page }) => {
    await mockBackend(context, { 'plan.md': '# Plan\n' });
    await page.goto('/note/plan.md');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await page.keyboard.press('e');
    await expect(page.locator('.cm-content')).toBeFocused();

    await page.keyboard.press('Control+k');
    await page.keyboard.type('pla');
    await expect(search(page)).toHaveValue('pla');
    await expect(page.locator('.cm-line')).toHaveText(['# Plan', '']);
});

// As an editor whose keymap binds the key takes it, as Emacs bindings would to kill a line: the
// keymap runs before the key reaches the window, and marks the key as handled.
test('leaves Ctrl+K to an editor that has taken it', async ({ context, page }) => {
    await mockBackend(context, { 'plan.md': '# Plan\n' });
    await page.goto('/note/plan.md');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await page.keyboard.press('e');
    await expect(page.locator('.cm-content')).toBeFocused();
    await page.locator('.cm-content').evaluate((element) => {
        element.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.key === 'k') {
                event.preventDefault();
            }
        });
    });

    await page.keyboard.press('Control+k');
    // As long again as the dialog would take to open, had the key opened it.
    await page.waitForTimeout(500);
    await expect(palette(page)).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeFocused();
});

// A reading and its candidates are the input method's to move through and to commit.
test('leaves the keys of an input method to it', async ({ context, page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Composes through the DevTools protocol, which only Chromium speaks.');
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await open(page);
    const devtools = await context.newCDPSession(page);
    await devtools.send('Input.imeSetComposition', { text: 'mon', selectionStart: 3, selectionEnd: 3 });
    await expect(search(page)).toHaveValue('mon');
    const keys = await recordKeys(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await keys()).toEqual(['ArrowDown (composing): left', 'Enter (composing): left']);

    await devtools.send('Input.insertText', { text: 'mon' });
    await expect(titles(page)).toHaveText(['Monday', 'Show all 1 in Files']);
    await expect(selected(page)).toContainText('Monday');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/note/journal/monday.md');
});

// Opened again at once, while the dialog is still scaling out: Vuetify keeps the closing one until
// it has, and the keys typed then would go back where the closing gave the focus.
test('opens afresh when opened again while it closes', async ({ context, page }) => {
    await mockBackend(context, { 'plan.md': '# Plan\n', 'journal/monday.md': '# Monday\n' });
    await page.goto('/note/plan.md');
    await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await page.keyboard.press('e');
    await expect(page.locator('.cm-content')).toBeFocused();

    await open(page);
    await search(page).pressSequentially('mon');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('pla');
    await expect(search(page)).toHaveValue('pla');
    await expect(search(page)).toBeFocused();
    await expect(page.locator('.cm-line')).toHaveText(['# Plan', '']);
});

// A key held down repeats, and each repeat would close the dialog or open it again.
test('opens and closes once for each press of Ctrl+K, however long it is held', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await page.keyboard.down('Control');
    await page.keyboard.down('k');
    await expect(search(page)).toBeFocused();
    // Again while still held, as the key repeats.
    await page.keyboard.down('k');
    await page.keyboard.up('k');
    await page.keyboard.up('Control');
    await page.keyboard.type('mon');
    await expect(search(page)).toHaveValue('mon');
    await expect(titles(page)).toHaveText(['Monday', 'Show all 1 in Files']);

    await page.keyboard.down('Control');
    await page.keyboard.down('k');
    await expect(palette(page)).toBeHidden();
    await page.keyboard.down('k');
    await page.keyboard.up('k');
    await page.keyboard.up('Control');
    await expect(palette(page)).toBeHidden();
});

// Synced as it opens, so a commit made elsewhere since the view synced is listed.
test('lists a commit made elsewhere as it opens', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await expect(page.getByText('Upcoming Due Dates')).toBeVisible();
    await page.waitForLoadState('networkidle');

    await page.route(`${API_URL}v2/entries**`, (route) => route.fulfill({
        json: listing({ ...FILES, 'news.md': '# Latest news\n' }, 2),
    }));
    await open(page);
    await expect(titles(page)).toHaveText(
        ['Latest news', 'Draft chapter', 'Monday', 'Write the report', 'Thesis', 'lecture.template', 'Ideas', 'Show all 7 in Files'],
    );
});

// Synced as it opens, but a sync that finds nothing changed keeps the listing every view derives
// from, so the view under the dialog has nothing to work out again.
test('keeps the listing the views derive from when the sync finds nothing changed', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await expect(page.getByText('Upcoming Due Dates')).toBeVisible();
    await page.waitForLoadState('networkidle');

    const asked: (string | null)[] = [];
    await page.route(`${API_URL}v2/entries**`, (route) => {
        const since = new URL(route.request().url()).searchParams.get('since');
        asked.push(since);
        return route.fulfill({ json: { kind: 'delta', commit: since, head: since, base: since, changed: [], deleted: [] } });
    });
    // The files store as the views read it, and the listing it held before the dialog opened.
    await page.evaluate(() => {
        const app = (document.querySelector('#app') as unknown as { __vue_app__: VueApp }).__vue_app__;
        const held = window as unknown as HeldListing;
        held.files = app.config.globalProperties.$pinia._s.get('files')!;
        held.listed = held.files.entries;
    });
    await open(page);
    await expect(titles(page)).toHaveText(
        ['Draft chapter', 'Monday', 'Write the report', 'Thesis', 'lecture.template', 'Ideas', 'Show all 6 in Files'],
    );
    await expect.poll(() => asked).toEqual([expect.stringMatching(/^0+1$/)]);
    await expect.poll(() => page.evaluate(() => (window as unknown as HeldListing).files.isLoading)).toBe(false);
    expect(await page.evaluate(() => {
        const held = window as unknown as HeldListing;
        return held.files.entries === held.listed;
    })).toBe(true);
});

// It syncs as it opens, so a sync starting and ending must not draw its rows again: that drew every
// one twice, a frame lost at each opening.
test('draws none of its rows again as the files sync', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await expect(page.getByText('Upcoming Due Dates')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.route(`${API_URL}v2/entries**`, (route) => {
        const since = new URL(route.request().url()).searchParams.get('since');
        return route.fulfill({ json: { kind: 'delta', commit: since, head: since, base: since, changed: [], deleted: [] } });
    });
    await open(page);
    await expect(titles(page)).toHaveText(
        ['Draft chapter', 'Monday', 'Write the report', 'Thesis', 'lecture.template', 'Ideas', 'Show all 6 in Files'],
    );
    await expect(palette(page).getByRole('progressbar')).toBeHidden();

    const drawn = await page.evaluate(async () => {
        // Every component in the palette, its renders counted. A row is drawn by whichever of them
        // renders the slot it is in, so the palette's own render alone would not show it.
        const element = document.querySelector('.file-search') as unknown as { __vueParentComponent: Instance };
        let palette = element.__vueParentComponent;
        while (palette.type.__name !== 'FileSearchPalette') {
            palette = palette.parent!;
        }
        let rows = 0;
        const visit = (vnode: VNode | null | undefined): void => {
            if (vnode === null || typeof vnode !== 'object') {
                return;
            }
            const instance = vnode.component;
            if (instance) {
                const render = instance.effect.fn;
                instance.effect.fn = function (this: unknown, ...args: unknown[]) {
                    if (instance.type.name === 'VListItem') {
                        rows += 1;
                    }
                    return render.apply(this, args);
                };
                visit(instance.subTree);
            }
            if (Array.isArray(vnode.children)) {
                vnode.children.forEach(visit);
            }
        };
        visit(palette.subTree);
        const app = (document.querySelector('#app') as unknown as { __vue_app__: VueApp }).__vue_app__;
        await app.config.globalProperties.$pinia._s.get('files')!.refresh();
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        return rows;
    });
    expect(drawn).toBe(0);
});

interface FilesStore {
    entries: unknown;
    isLoading: boolean;
    refresh(): Promise<unknown>;
}

interface Instance {
    type: { name?: string; __name?: string };
    parent: Instance | null;
    subTree: VNode;
    effect: { fn: (...args: unknown[]) => unknown };
}

interface VNode {
    component: Instance | null;
    children: unknown;
}

interface VueApp {
    config: { globalProperties: { $pinia: { _s: Map<string, FilesStore> } } };
}

interface HeldListing {
    files: FilesStore;
    listed: unknown;
}

// Choosing the page already shown goes nowhere, so the dialog closes as with Escape.
test('closes over the page chosen if it is the one shown, giving the focus back', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/note/journal/monday.md');
    await expect(page.getByRole('heading', { name: 'Monday' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await page.keyboard.press('e');
    await expect(page.locator('.cm-content')).toBeFocused();
    await open(page);
    await search(page).pressSequentially('mon');
    await expect(selected(page)).toContainText('Monday');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page.locator('.cm-content')).toBeFocused();
    await expect(page).toHaveURL('/note/journal/monday.md');

    // And the search in the Files view shown.
    await page.goto('/files?q=mon');
    const filesSearch = page.getByRole('textbox', { name: 'Search' });
    await filesSearch.click();
    await open(page);
    await search(page).pressSequentially('mon');
    await page.keyboard.press('ArrowUp');
    await expect(selected(page)).toContainText('Show all 1 in Files');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(filesSearch).toBeFocused();
    await expect(page).toHaveURL('/files?q=mon');
});

// The listing as moried would list `files` at commit `n`, with no metadata: the rows of the All tab
// show none.
function listing(files: Record<string, string>, n: number) {
    const commit = String(n).padStart(40, '0');
    const entries = Object.entries(files).map(([path, content]) => ({
        path,
        size: content.length,
        mime_type: 'text/markdown',
        metadata: null,
        title: /^# (.*)$/m.exec(content)?.[1] ?? null,
        time: TIMES[path] ?? '2026-10-22T09:00:00+00:00',
    }));
    return { kind: 'full', commit, head: commit, entries };
}

// A sync while the dialog is open moves the files under the one chosen, as the calendar syncs when
// the window takes the focus again.
test('keeps the file chosen as a sync moves it, and the place of one that has gone', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/calendar/month/2026/10/07');
    await open(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(selected(page)).toContainText('Write the report');

    let files: Record<string, string> = { ...FILES, 'news.md': '# Latest news\n' };
    let commit = 2;
    await page.route(`${API_URL}v2/entries**`, (route) => route.fulfill({ json: listing(files, commit) }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(titles(page)).toHaveText(
        ['Latest news', 'Draft chapter', 'Monday', 'Write the report', 'Thesis', 'lecture.template', 'Ideas', 'Show all 7 in Files'],
    );
    await expect(selected(page)).toContainText('Write the report');

    files = Object.fromEntries(Object.entries(files).filter(([path]) => path !== `.tasks/${PROJECT}/${REPORT}.md`));
    commit = 3;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(titles(page)).toHaveText(
        ['Latest news', 'Draft chapter', 'Monday', 'Thesis', 'lecture.template', 'Ideas', 'Show all 6 in Files'],
    );
    await expect(selected(page)).toContainText('Thesis');
    await expect(search(page)).toHaveAttribute('aria-activedescendant', await selected(page).getAttribute('id') ?? '');
});

// What a screen reader says: the dialog's name, the file chosen whenever another is, as it is told
// by the ID the field names, and that nothing is listed, from outside the list of files.
test('tells a screen reader its name, the file chosen and that none is listed', async ({ context, page }) => {
    const LONG_DAY = 'journal/a long day.md';
    await mockBackend(
        context,
        { ...FILES, [LONG_DAY]: '# A long day\n' },
        { times: { ...TIMES, [LONG_DAY]: '2026-10-22T09:00:00+00:00' } },
    );
    await page.goto('/');
    await open(page);
    await expect(page.getByRole('dialog', { name: 'Search files' })).toBeVisible();

    // Its path holds spaces, which an ID cannot.
    await expect(selected(page)).toContainText('A long day');
    const inAll = await selected(page).getAttribute('id') ?? '';
    expect(inAll).not.toMatch(/\s/);
    await expect(search(page)).toHaveAttribute('aria-activedescendant', inAll);
    // The same file heads the next kind too, and is chosen there afresh.
    await page.keyboard.press('Tab');
    await expect(selected(page)).toContainText('A long day');
    const inNotes = await selected(page).getAttribute('id') ?? '';
    expect(inNotes).not.toBe(inAll);
    await expect(search(page)).toHaveAttribute('aria-activedescendant', inNotes);
    await search(page).pressSequentially('mon');
    await expect(selected(page)).toContainText('Monday');
    await expect(search(page)).toHaveAttribute('aria-activedescendant', await selected(page).getAttribute('id') ?? '');

    await search(page).pressSequentially('zzz');
    await expect(palette(page).getByRole('status')).toHaveText('Nothing matches.');
    await expect(palette(page).getByRole('listbox')).toHaveText('');
    await expect(search(page)).not.toHaveAttribute('aria-activedescendant');
});

// Escape gives up a reading being composed, and leaves the dialog open.
test('leaves Escape to an input method while it composes', async ({ context, page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Composes through the DevTools protocol, which only Chromium speaks.');
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await open(page);
    const devtools = await context.newCDPSession(page);
    await devtools.send('Input.imeSetComposition', { text: 'もん', selectionStart: 2, selectionEnd: 2 });
    await expect(search(page)).toHaveValue('もん');
    await page.keyboard.press('Escape');
    // Still open, as the app tells an open dialog: the field keeps the focus a moment after a
    // dialog closes over it.
    await expect(page.locator('.v-overlay--active[role="dialog"]')).toHaveCount(1);
    await expect(search(page)).toBeFocused();

    await devtools.send('Input.insertText', { text: 'mon' });
    await expect(titles(page)).toHaveText(['Monday', 'Show all 1 in Files']);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
});

// The dialog on top has every key, as the task being written has here.
test('opens over no other dialog', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await page.getByRole('listitem').filter({ hasText: /^Add$/ }).first().click();
    await page.locator('.v-menu').getByText('New task', { exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('.task-editor-next') });
    const title = dialog.getByRole('textbox', { name: 'Title', exact: true });
    await title.click();
    const keys = await recordKeys(page);
    await page.keyboard.press('Control+k');
    expect(await keys()).toEqual(['Control+k: left']);
    await expect(palette(page)).toHaveCount(0);
    await expect(title).toBeFocused();

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await open(page);
});

// For Enter to open the file that matches best, whichever was chosen before.
test('starts from the first file again as the search or the kind changes', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await open(page);
    await search(page).pressSequentially('th');
    await expect(titles(page)).toHaveText(['Draft chapter', 'Write the report', 'Thesis', 'Show all 3 in Files']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(selected(page)).toContainText('Thesis');
    // Narrowed, though it lists the same files.
    await search(page).pressSequentially('e');
    await expect(titles(page)).toHaveText(['Draft chapter', 'Write the report', 'Thesis', 'Show all 3 in Files']);
    await expect(selected(page)).toContainText('Draft chapter');

    await page.keyboard.press('ArrowDown');
    await expect(selected(page)).toContainText('Write the report');
    await page.keyboard.press('Tab');
    await expect(titles(page)).toHaveText(['Draft chapter', 'Show all 1 in Files']);
    await expect(selected(page)).toContainText('Draft chapter');
});

test('keeps the file chosen in sight, round from the first to the last', async ({ context, page }) => {
    await mockBackend(context, MANY, { times: MANY_TIMES });
    await page.goto('/');
    await open(page);
    await expect(option(page, 0)).toContainText('Many 0');
    for (let i = 0; i < 30; i++) {
        await page.keyboard.press('ArrowDown');
    }
    await expect(selected(page)).toContainText('Many 30');
    await expect(selected(page)).toBeInViewport({ ratio: 1 });
    for (let i = 0; i < 25; i++) {
        await page.keyboard.press('ArrowUp');
    }
    await expect(selected(page)).toContainText('Many 5');
    await expect(selected(page)).toBeInViewport({ ratio: 1 });
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press('ArrowUp');
    }
    await expect(selected(page)).toContainText('Show all 40 in Files');
    await expect(selected(page)).toBeInViewport({ ratio: 1 });
});

// The file moved from still in sight, to tell where the move went from.
test('moves a page at a time with PageDown and PageUp', async ({ context, page }) => {
    await mockBackend(context, MANY, { times: MANY_TIMES });
    await page.goto('/');
    await open(page);
    await page.keyboard.press('PageDown');
    await expect.poll(() => selectedIndex(page)).toBeGreaterThan(1);
    const step = await selectedIndex(page);
    await expect(option(page, 0)).toBeInViewport({ ratio: 1 });
    await expect(selected(page)).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('PageDown');
    await expect.poll(() => selectedIndex(page)).toBe(2 * step);
    await expect(option(page, step)).toBeInViewport({ ratio: 1 });
    await expect(selected(page)).toBeInViewport({ ratio: 1 });

    await page.keyboard.press('PageUp');
    await expect.poll(() => selectedIndex(page)).toBe(step);
    await expect(option(page, 2 * step)).toBeInViewport({ ratio: 1 });
    await expect(selected(page)).toBeInViewport({ ratio: 1 });
    // No further than the first.
    await page.keyboard.press('PageUp');
    await page.keyboard.press('PageUp');
    await expect.poll(() => selectedIndex(page)).toBe(0);
});

const EVENTS = {
    '.events/holiday.md': '---\nevents:\n    Holiday:\n        start: 2026-09-22\n---\n\n# Holiday\n',
    '.events/later.md': '---\nevents:\n    Later:\n        start: 2026-12-01\n---\n\n# Later\n',
    '.events/meeting.md': '---\nevents:\n    Meeting:\n        start: 2026-04-06 10:00\n        repeat: {freq: weekly, byday: [mon]}\n---\n\n# Meeting\n',
    '.events/someday.md': '---\nevents:\n    Someday:\n        note: Whenever there is time.\n---\n\n# Someday\n',
};

// The last changed first, which is not the order they start in.
const EVENT_TIMES = {
    '.events/someday.md': '2026-10-04T09:00:00+00:00',
    '.events/meeting.md': '2026-10-03T09:00:00+00:00',
    '.events/holiday.md': '2026-10-02T09:00:00+00:00',
    '.events/later.md': '2026-10-01T09:00:00+00:00',
};

test('lists the events the last to start first, as the Files view does', async ({ context, page }) => {
    await mockBackend(context, EVENTS, { times: EVENT_TIMES });
    await page.goto('/');
    await open(page);
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
    }
    await expect(tab(page, 'Events')).toHaveAttribute('aria-selected', 'true');
    // One that starts nowhere after the rest.
    await expect(titles(page)).toHaveText(['Later', 'Holiday', 'Meeting', 'Someday', 'Show all 4 in Files']);
    await expect(selected(page)).toContainText('2026-12-01');
});

test('opens the file clicked', async ({ context, page }) => {
    await mockBackend(context, FILES, { times: TIMES });
    await page.goto('/');
    await open(page);
    await palette(page).getByRole('option').filter({ hasText: 'Monday' }).click();
    await expect(page).toHaveURL('/note/journal/monday.md');
    await expect(palette(page)).toBeHidden();
});
