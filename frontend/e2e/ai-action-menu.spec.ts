import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mockBackend } from './backend';

// Groups come from slashes in an action's name: `Text` holds Shorten and the group Translate.
const NOTES = {
    '.mory/ai-actions.toml': [
        '[shorten]',
        'name = "Text/Shorten"',
        'prompt = "Shorten {{input}}"',
        '[english]',
        'name = "Text/Translate/English"',
        'prompt = "Translate to English: {{input}}"',
        '[fix]',
        'name = "Fix"',
        'prompt = "Fix {{input}}"',
        '',
    ].join('\n'),
};

// A note not saved yet opens in the editor, whose toolbar holds the menu.
const ADDRESS = '/note/new.md?mode=create';

function menuButton(page: Page): Locator {
    return page.getByTitle('AI Actions');
}

function group(page: Page, name: string): Locator {
    return page.getByRole('listitem').filter({ hasText: new RegExp(`^${name}$`) });
}

function action(page: Page, name: string): Locator {
    return page.getByText(name, { exact: true });
}

test('opens a group on a click, keeping the menu open', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(ADDRESS);
    await menuButton(page).click();
    // Without hovering first, as a tap does. The click must not reach the menu around the row,
    // which closes on a click in its content.
    await group(page, 'Text').click();
    await expect(action(page, 'Shorten')).toBeVisible();
    await expect(action(page, 'Fix')).toBeVisible();
    await group(page, 'Translate').click();
    await expect(action(page, 'English')).toBeVisible();
    await expect(action(page, 'Shorten')).toBeVisible();
});

test('reaches a group and its submenu by keyboard', async ({ context, page }) => {
    await mockBackend(context, NOTES);
    await page.goto(ADDRESS);
    // Opened from the keyboard, so that focus moves into the menu: a click leaves it on the button.
    await menuButton(page).focus();
    await page.keyboard.press('Enter');
    // Arrows walk the menu's items; a row the keyboard cannot focus is walked past for good.
    for (let steps = 0; steps < 6 && !(await group(page, 'Text').evaluate((el) => el.contains(document.activeElement))); steps += 1) {
        await page.keyboard.press('ArrowDown');
    }
    await expect(group(page, 'Text')).toBeFocused();
    // Opens the submenu with focus left on the row, and the next arrow goes into it.
    await page.keyboard.press('ArrowRight');
    await expect(action(page, 'Shorten')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('listitem').filter({ hasText: /^Shorten$/ })).toBeFocused();
});

test.describe('on a touch screen', () => {
    test.use({ hasTouch: true });

    test('taps through nested groups', async ({ context, page }) => {
        await mockBackend(context, NOTES);
        await page.goto(ADDRESS);
        await menuButton(page).tap();
        await group(page, 'Text').tap();
        await expect(action(page, 'Shorten')).toBeVisible();
        await group(page, 'Translate').tap();
        await expect(action(page, 'English')).toBeVisible();
    });
});
