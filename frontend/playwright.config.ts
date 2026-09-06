import { defineConfig, devices } from '@playwright/test';
import { API_URL } from './e2e/backend';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [
        ['list'],
        // The workflow uploads playwright-report/, which only the HTML reporter writes.
        ['html', { open: 'never' }],
    ],
    use: {
        baseURL: 'http://127.0.0.1:8080',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },
    ],
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1',
        // Vite reads VITE_* from the environment over `.env`, which is untracked.
        env: { VITE_APP_API_URL: API_URL },
        url: 'http://127.0.0.1:8080',
        reuseExistingServer: !process.env.CI,
    },
});
