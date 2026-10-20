import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { API_URL, mockBackend } from './backend';

// Each settings file is written whole from what the settings hold, and settings that could not read
// their file hold none of it: one change saved then would leave the file holding that change alone.

function configDialog(page: Page): Locator {
    return page.getByRole('dialog', { name: 'Config', exact: true });
}

async function openTab(page: Page, name: string): Promise<void> {
    await page.locator('.account-item').click();
    await page.locator('.v-menu').getByText('Config', { exact: true }).click();
    await expect(configDialog(page)).toBeVisible();
    await configDialog(page).getByRole('tab', { name, exact: true }).click();
}

const CALENDARS = `calendars:
    - id: work
      name: Work
      url: https://example.invalid/work.ics
      enabled: true
categories:
    meeting:
        color: "#3f51b5"
`;

test('adds no calendar over a calendars.yaml that could not be read', async ({ context, page }) => {
    const repository = await mockBackend(context, { '.mory/calendars.yaml': CALENDARS });
    await page.route(`${API_URL}v2/files/.mory/calendars.yaml`, (route) => route.request().method() === 'GET'
        ? route.fulfill({ status: 500, json: {} })
        : route.fallback());
    await page.goto('/files');
    await openTab(page, 'Calendars');
    await expect(configDialog(page).getByText('Could not read .mory/calendars.yaml')).toBeVisible();

    await configDialog(page).getByRole('button', { name: 'Add calendar' }).click();
    const nested = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'iCal URL' }) });
    await nested.getByRole('textbox', { name: 'Name', exact: true }).fill('Holidays');
    await nested.getByRole('textbox', { name: 'iCal URL' }).fill('https://example.invalid/holidays.ics');
    await nested.getByRole('button', { name: 'Save', exact: true }).click();

    // In the dialog, which stays open over the section's own alert.
    await expect(nested.getByText('so saving would replace everything in it')).toBeVisible();
    expect(repository.writes).toEqual([]);
});

const ACTIONS = `[summarize]
name = "Summarize"
prompt = """
Summarize {{input}}"""
`;

// The load fails on a dropped connection, and by the time the action is added the file reads again.
test('adds an AI action to the file as it is, though it could not be loaded', async ({ context, page }) => {
    const repository = await mockBackend(context, { '.mory/ai-actions.toml': ACTIONS });
    await page.route(`${API_URL}notes/.mory/ai-actions.toml`, (route) => route.request().method() === 'GET'
        ? route.fulfill({ status: 500, json: {} })
        : route.fallback());
    await page.goto('/files');
    await openTab(page, 'AI Actions');
    await expect(page.getByText('Failed to load AI Actions')).toBeVisible();

    await configDialog(page).getByRole('button', { name: 'Add', exact: true }).click();
    const nested = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Prompt' }) });
    await nested.getByRole('textbox', { name: 'Identifier' }).fill('fix');
    await nested.getByRole('textbox', { name: 'Display name' }).fill('Fix');
    await nested.getByRole('textbox', { name: 'Prompt' }).fill('Fix {{input}}');
    await nested.getByRole('button', { name: 'Save', exact: true }).click();

    await expect.poll(() => repository.writes.length).toBe(1);
    expect(repository.writes[0].path).toBe('.mory/ai-actions.toml');
    expect(repository.writes[0].content).toContain('[summarize]');
    expect(repository.writes[0].content).toContain('[fix]');
    await expect(configDialog(page).getByText('Summarize', { exact: true })).toBeVisible();
});
