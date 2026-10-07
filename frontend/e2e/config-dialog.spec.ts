import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import YAML from 'yaml';

import { API_URL, mockBackend } from './backend';

function configDialog(page: Page): Locator {
    return page.getByRole('dialog', { name: 'Config', exact: true });
}

async function openConfig(page: Page): Promise<void> {
    await page.locator('.account-item').click();
    await page.locator('.v-menu').getByText('Config', { exact: true }).click();
    await expect(configDialog(page)).toBeVisible();
}

for (const address of ['/files', '/calendar/week/2026/10/07', '/tasks-next/_/descendants/list']) {
    test(`opens Config over ${address} without replacing the view`, async ({ context, page }) => {
        await mockBackend(context, {});
        await page.goto(address);
        await expect(page.locator('.router-view')).toBeVisible();
        const view = await page.locator('.router-view').elementHandle();
        const title = await page.title();

        await openConfig(page);
        await expect(page).toHaveURL(new RegExp(`${address}$`));
        expect(await page.title()).toBe(title);
        await expect(configDialog(page).getByRole('tab', { selected: true })).toHaveText('General');
        await page.keyboard.press('Escape');
        await expect(configDialog(page)).toBeHidden();
        expect(await view!.evaluate((element) => element.isConnected)).toBe(true);
        await expect(page.locator('.account-item')).toBeFocused();
    });
}

test('keeps a note draft and its undo history while editing Config', async ({ context, page }) => {
    const repository = await mockBackend(context, {});
    await page.goto('/note/draft.md?mode=create');
    const editor = page.locator('.cm-content');
    await editor.fill('An unsaved note');
    await editor.press('End');
    await editor.pressSequentially(' with a draft');

    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    const font = configDialog(page).getByRole('textbox', { name: 'Font Family' });
    await font.fill('');
    await font.pressSequentially('Menlo, serif');
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await expect(configDialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/note\/draft\.md\?mode=create$/);
    await expect(page.locator('.cm-editor')).toHaveCSS('font-family', 'Menlo, serif');
    await expect(editor).toHaveText('An unsaved note with a draft');
    await editor.press('ControlOrMeta+z');
    await expect(editor).toHaveText('An unsaved note');
    expect(repository.writes).toEqual([]);

    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    await expect(configDialog(page).getByRole('textbox', { name: 'Font Family' })).toHaveValue('Menlo, serif');
});

test('applies loaded editor preferences to the current draft', async ({ context, page }) => {
    await mockBackend(context, {
        '.mory/default_config.yaml': YAML.stringify({
            useSimpleEditor: false,
            lockScroll: true,
            editorFontFamily: 'serif',
            editorFontSize: 18,
            editorIndentSize: 4,
            editorTheme: 'one-dark',
            editorKeybinding: 'default',
            editorEnableEmacsStyleBindings: false,
            editorVimInsertUnmapCtCd: false,
            highlightjsTheme: 'a11y-dark',
        }),
    });
    await page.goto('/note/draft.md?mode=create');
    const editor = page.locator('.cm-content');
    await editor.fill('Draft');
    await openConfig(page);
    await configDialog(page).getByRole('button', { name: 'Load from repository', exact: true }).click();
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await expect(page.locator('.cm-editor')).toHaveCSS('font-family', 'serif');
    await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '24px');
    await expect(page.locator('.cm-editor')).toHaveCSS('background-color', 'rgb(40, 44, 52)');
    await expect.poll(() => page.locator('.viewer-pane style').first().evaluate((element) => element.textContent)).toContain('background:#2b2b2b');
    await editor.press('Home');
    await editor.press('Tab');
    await expect(editor).toHaveText('    Draft');
    await editor.press('ControlOrMeta+z');
    await expect(editor).toHaveText('Draft');

    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    await configDialog(page).getByRole('combobox', { name: 'Keybinding', exact: true }).press('Enter');
    await page.getByRole('option', { name: 'Emacs', exact: true }).click();
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await expect(page.locator('.cm-scroller')).toHaveClass(/cm-emacsMode/);
    await editor.press('Control+Home');
    await editor.pressSequentially('X');
    await expect(editor).toHaveText('XDraft');
});

test('reconfigures Vim and restores its insert bindings when unmapping is turned off', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/note/draft.md?mode=create');
    const editor = page.locator('.cm-content');
    await editor.fill('    Draft');
    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    await configDialog(page).getByRole('combobox', { name: 'Keybinding', exact: true }).press('Enter');
    await page.getByRole('option', { name: 'Vim', exact: true }).click();
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await expect(page.locator('.cm-scroller')).toHaveClass(/cm-vimMode/);
    await editor.press('0');
    await editor.press('i');
    await editor.press('Control+d');
    await expect(editor).toHaveText('  Draft');

    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    await configDialog(page).getByLabel('Unmap <C-t>/<C-d> in Vim insert mode').check();
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await editor.press('Control+d');
    await expect(editor).toHaveText(/^ +Draft$/);

    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    await configDialog(page).getByLabel('Unmap <C-t>/<C-d> in Vim insert mode').uncheck();
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await editor.press('Control+d');
    await expect(editor).toHaveText('Draft');
});

test('switches to the simple editor and back without losing the rich editor history', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/note/draft.md?mode=create');
    const editor = page.locator('.cm-content');
    await editor.fill('Draft');
    const richEditor = await editor.elementHandle();
    await editor.press('End');
    await editor.pressSequentially(' with edits');
    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    await configDialog(page).getByLabel('Use Simple Editor', { exact: true }).check();
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await expect(page.locator('textarea.simple-editor')).toHaveValue('Draft with edits');
    await expect(editor).toBeHidden();

    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    await configDialog(page).getByLabel('Use Simple Editor', { exact: true }).uncheck();
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await expect(editor).toBeVisible();
    expect(await richEditor!.evaluate((element) => element.isConnected)).toBe(true);
    await editor.press('ControlOrMeta+z');
    await expect(editor).toHaveText('Draft');
});

test('loads and saves browser defaults from General', async ({ context, page }) => {
    const defaults = {
        useSimpleEditor: false,
        lockScroll: true,
        editorFontFamily: 'monospace',
        editorFontSize: 12,
        editorIndentSize: 4,
        editorTheme: 'default',
        editorKeybinding: 'default',
        editorEnableEmacsStyleBindings: false,
        editorVimInsertUnmapCtCd: false,
        highlightjsTheme: 'default',
        noteTreeInitialRows: 20,
        noteTreeRowIncrement: 30,
    };
    const repository = await mockBackend(context, { '.mory/default_config.yaml': YAML.stringify(defaults) });
    await page.goto('/files');
    await openConfig(page);
    await configDialog(page).getByRole('button', { name: 'Load from repository', exact: true }).click();
    await expect(configDialog(page).getByLabel('Lock Scroll by Default')).toBeChecked();
    expect(repository.writes).toEqual([]);

    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    await expect(configDialog(page).getByRole('textbox', { name: 'Font Family' })).toHaveValue('monospace');
    await configDialog(page).getByRole('textbox', { name: 'Font Family' }).fill('serif');
    await configDialog(page).getByRole('tab', { name: 'General', exact: true }).click();
    await configDialog(page).getByRole('button', { name: 'Save to repository', exact: true }).click();
    await expect.poll(() => repository.writes.length).toBe(1);
    expect(repository.writes[0].path).toBe('.mory/default_config.yaml');
    expect(YAML.parse(repository.writes[0].content)).toEqual({ ...defaults, editorFontFamily: 'serif' });
});

test('keeps browser focus and typing in Config over a note draft', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/note/draft.md?mode=create');
    const editor = page.locator('.cm-content');
    await editor.fill('An unsaved note');
    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    const font = configDialog(page).getByRole('textbox', { name: 'Font Family' });
    await font.fill('');
    await page.evaluate(() => {
        window.dispatchEvent(new FocusEvent('focus'));
        return new Promise<number>((resolve) => requestAnimationFrame(resolve));
    });
    await expect(font).toBeFocused();
    await page.keyboard.type('serif');
    await expect(font).toHaveValue('serif');
    await expect(editor).toHaveText('An unsaved note');
});

test('keeps trackpad scrolling in Config from navigating Calendar', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/calendar/month/2026/10/07');
    await openConfig(page);
    await configDialog(page).locator('.config-panels').hover();
    await page.mouse.wheel(120, 100);
    await page.evaluate(() => new Promise<number>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await expect(page).toHaveURL(/\/calendar\/month\/2026\/10\/07$/);
    await expect(configDialog(page)).toBeVisible();
});

for (const view of ['Calendar', 'Home']) {
    test(`refreshes subscribed events on ${view} after saving Config`, async ({ context, page }) => {
        const repository = await mockBackend(context, {
            '.mory/calendars.yaml': YAML.stringify({ calendars: [{
                id: 'work', name: 'Work', url: 'https://example.invalid/work.ics', enabled: true,
            }] }),
        });
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        const start = `${year}-${month}-${day}`;
        let requests = 0;
        await context.route(`${API_URL}v2/imported-events**`, async (route) => {
            requests += 1;
            await route.fulfill({ json: {
                calendars: [{ id: 'work', name: 'Work', error: null }],
                events: [{ calendar: 'work', uid: 'standup', recurrence_id: start, name: 'Imported standup', start }],
                series: {}, truncated: false,
            } });
        });
        await page.goto(view === 'Calendar' ? `/calendar/month/${year}/${month}/${day}` : '/');
        await expect(page.getByText('Imported standup', { exact: true }).first()).toBeVisible();
        await openConfig(page);
        await configDialog(page).getByRole('tab', { name: 'Calendars', exact: true }).click();
        await configDialog(page).locator('.v-list-item').filter({ hasText: 'Work' }).locator('.v-icon-btn').first().click();
        const nested = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'iCal URL' }) });
        await nested.getByRole('textbox', { name: 'Name', exact: true }).fill('Work renamed');
        await nested.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(() => repository.writes.length).toBe(1);
        await expect.poll(() => requests).toBe(2);
        await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
        await expect(configDialog(page)).toBeHidden();
        await expect(page.getByText('Imported standup', { exact: true }).first()).toBeVisible();
    });
}

test('closes a nested settings dialog before Config on Escape', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/files');
    await openConfig(page);
    await configDialog(page).getByRole('tab', { name: 'Calendars', exact: true }).click();
    await configDialog(page).getByRole('button', { name: 'Add calendar' }).click();
    const nested = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'iCal URL' }) });
    await expect(nested).toBeVisible();
    await nested.getByRole('textbox', { name: 'iCal URL' }).click();
    await page.keyboard.press('Escape');
    await expect(nested).toBeHidden();
    await expect(configDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(configDialog(page)).toBeHidden();
});

test('opens the former Config address over Home', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/config');
    await expect(configDialog(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await expect(configDialog(page)).toBeHidden();
    await expect(page.locator('#home')).toBeVisible();
});

test('links vertical settings tabs to their named panels for keyboard navigation', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/files');
    await openConfig(page);
    await expect(configDialog(page).getByRole('tablist', { name: 'Settings groups' })).toHaveAttribute('aria-orientation', 'vertical');
    const general = configDialog(page).getByRole('tab', { name: 'General', exact: true });
    await general.focus();
    await general.press('ArrowDown');
    const editorTab = configDialog(page).getByRole('tab', { name: 'Editor', exact: true });
    await expect(editorTab).toBeFocused();
    await editorTab.press('Enter');
    const editorPanel = configDialog(page).getByRole('tabpanel', { name: 'Editor', exact: true });
    await expect(editorPanel).toBeVisible();
    await expect(editorTab).toHaveAttribute('aria-selected', 'true');
    expect(await editorTab.getAttribute('aria-controls')).toBe(await editorPanel.getAttribute('id'));
    expect(await editorPanel.getAttribute('aria-labelledby')).toBe(await editorTab.getAttribute('id'));
    await expect(configDialog(page).getByRole('tabpanel', { name: 'General', exact: true })).toBeHidden();
    await editorTab.press('Tab');
    await expect(editorPanel).toBeFocused();
});

test('groups settings tabs by where they are stored without trapping the arrow keys', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/files');
    await openConfig(page);
    const groups = {
        'This browser': ['General', 'Editor', 'Markdown Rendering', 'Navigation Drawer'],
        'Repository': ['Tasks', 'Calendars', 'AI Actions'],
    };
    for (const [group, names] of Object.entries(groups)) {
        for (const name of names) {
            await expect(configDialog(page).getByRole('tab', { name, exact: true })).toHaveAccessibleDescription(group);
        }
    }
    await expect(configDialog(page).getByRole('tab')).toHaveCount(7);

    // The headings sit between the tabs, so each key below would stop on one if it could.
    const general = configDialog(page).getByRole('tab', { name: 'General', exact: true });
    const navigation = configDialog(page).getByRole('tab', { name: 'Navigation Drawer', exact: true });
    const tasks = configDialog(page).getByRole('tab', { name: 'Tasks', exact: true });
    const aiActions = configDialog(page).getByRole('tab', { name: 'AI Actions', exact: true });
    await navigation.focus();
    await page.keyboard.press('ArrowDown');
    await expect(tasks).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(navigation).toBeFocused();
    await page.keyboard.press('Home');
    await expect(general).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(aiActions).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(general).toBeFocused();
});

test('names the file each repository settings panel is stored in', async ({ context, page }) => {
    await mockBackend(context, {});
    await page.goto('/files');
    await openConfig(page);
    const files = {
        'Tasks': '.mory/tasks.yaml',
        'Calendars': '.mory/calendars.yaml',
        'AI Actions': '.mory/ai-actions.toml',
    };
    for (const [name, path] of Object.entries(files)) {
        await configDialog(page).getByRole('tab', { name, exact: true }).click();
        const panel = configDialog(page).getByRole('tabpanel', { name, exact: true });
        const notice = panel.locator('.v-alert').filter({ hasText: 'Stored in the repository' });
        await expect(notice).toContainText(`Stored in the repository as ${path} and shared by every browser.`);
    }
});

for (const width of [320, 340, 360, 390]) {
    test(`fits task colours and calendar fields within Config at ${width}px`, async ({ context, page }) => {
        await page.setViewportSize({ width, height: 844 });
        await mockBackend(context, {});
        await page.goto('/files');
        await page.locator('.v-app-bar-nav-icon').click();
        await openConfig(page);
        for (const name of ['Tasks', 'Calendars']) {
            await configDialog(page).getByRole('tab', { name, exact: true }).click();
            const panel = configDialog(page).getByRole('tabpanel', { name, exact: true });
            await expect(panel).toBeVisible();
            // Only measure once the previous panel has finished sliding out.
            await expect.poll(() => configDialog(page).getByRole('tabpanel').count()).toBe(1);
            const panels = configDialog(page).locator('.config-panels');
            await expect.poll(() => panels.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
            for (const grid of await panel.locator('.status-colors, .task-date-colors, .alarm-defaults').all()) {
                const bounds = await grid.boundingBox();
                const available = await panels.boundingBox();
                expect(bounds!.x).toBeGreaterThanOrEqual(available!.x);
                expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(available!.x + available!.width);
            }
        }
        await expect(configDialog(page).getByRole('button', { name: 'Close Config' })).toBeInViewport();
    });
}

test('keeps vertical tabs and the close button reachable on a phone', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBackend(context, {});
    await page.goto('/files');
    await page.locator('.v-app-bar-nav-icon').click();
    await openConfig(page);
    await expect(configDialog(page).locator('.v-tabs--vertical')).toBeVisible();
    await configDialog(page).getByRole('tab', { name: 'Editor', exact: true }).click();
    await configDialog(page).getByLabel('Unmap <C-t>/<C-d> in Vim insert mode').check();
    await expect(configDialog(page).getByRole('button', { name: 'Close Config' })).toBeInViewport();
    for (const slider of await configDialog(page).locator('.v-slider__container').all()) {
        expect((await slider.boundingBox())!.width).toBeGreaterThan(80);
    }
    const panels = configDialog(page).locator('.config-panels');
    expect(await panels.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await configDialog(page).getByRole('tab', { name: 'AI Actions', exact: true }).click();
    await expect(configDialog(page).getByText('No AI Actions defined yet.')).toBeVisible();
    await configDialog(page).getByRole('button', { name: 'Close Config' }).click();
    await expect(configDialog(page)).toBeHidden();
    await expect(page.locator('.v-navigation-drawer')).not.toBeInViewport();
    await expect(page.locator('.v-app-bar-nav-icon')).toBeFocused();
    await expect(page).toHaveURL(/\/files$/);
});
