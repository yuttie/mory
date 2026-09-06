import { defineConfig, devices } from '@playwright/test';
import { API_URL } from './e2e/backend';

// The origin the dev server serves the app on, and the one the tests navigate to.
const APP_URL = 'http://127.0.0.1:8080';

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
        baseURL: APP_URL,
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
        // Bind the port the tests wait on, and fail loudly rather than let Vite fall
        // back to another port that nothing is watching.
        command: `npm run dev -- --host 127.0.0.1 --port ${new URL(APP_URL).port} --strictPort`,
        // Vite reads VITE_* from the environment over `.env`, which is untracked.
        env: { VITE_APP_API_URL: API_URL },
        url: APP_URL,
        reuseExistingServer: !process.env.CI,
    },
});
