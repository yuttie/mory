import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';

// A note is text, whatever it happens to parse as.
test('opens a note holding JSON as the text it holds', async ({ context, page }) => {
    await mockBackend(context, { 'data.json': '{"unit": "cm", "values": [1, 2]}\n' });
    await page.goto('/note/data.json');
    // In the editor, which a note that is not Markdown opens in; the viewer, hidden, has it too.
    await expect(page.locator('.cm-content')).toContainText('"values": [1, 2]');
});
