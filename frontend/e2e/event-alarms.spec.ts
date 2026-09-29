import { generateKeyPairSync } from 'node:crypto';

import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { API_URL, mockBackend } from './backend';

// A P-256 public key as moried serves its VAPID key: uncompressed, base64url.
function vapidKey(): string {
    const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
    const raw = Buffer.concat([
        Buffer.from([4]),
        Buffer.from(jwk.x as string, 'base64url'),
        Buffer.from(jwk.y as string, 'base64url'),
    ]);
    return raw.toString('base64url');
}

// moried's push endpoints, recording what the page registers. Registered after `mockBackend`, so
// they answer before its catch-all.
async function mockPush(context: BrowserContext, key: string): Promise<unknown[]> {
    const registered: unknown[] = [];
    await context.route(`${API_URL}v2/push/**`, async (route) => {
        const request = route.request();
        if (request.url().endsWith('/push/key')) {
            await route.fulfill({ json: key });
            return;
        }
        if (request.method() === 'PUT') {
            registered.push(request.postDataJSON());
        }
        await route.fulfill({ status: 204 });
    });
    return registered;
}

test.beforeEach(async ({ context, baseURL }) => {
    await context.grantPermissions(['notifications'], { origin: baseURL });
});

// Playwright's Chromium has no push service to subscribe with, so the browser's half is stood in
// for: what is checked is what the page asks of it, and what it tells moried.
test('registers this browser for alarms, with the zone it reads the calendar in', async ({ context, page }) => {
    await mockBackend(context, { 'a.md': '# A\n' });
    const key = vapidKey();
    const registered = await mockPush(context, key);
    await context.addInitScript(() => {
        const subscription = {
            options: { applicationServerKey: null as ArrayBuffer | null },
            toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }),
            unsubscribe: async () => true,
        };
        PushManager.prototype.getSubscription = async () => null;
        PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
            const bytes = new Uint8Array(options!.applicationServerKey as ArrayBuffer);
            (window as unknown as { subscribedWith: number[] }).subscribedWith = [...bytes];
            return subscription as unknown as PushSubscription;
        };
    });

    await page.goto('/note/a.md');
    await expect.poll(() => registered).toHaveLength(1);
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(registered[0]).toEqual({
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p', auth: 'a' },
        zone,
    });
    const subscribedWith = await page.evaluate(() => (window as unknown as { subscribedWith: number[] }).subscribedWith);
    expect(Buffer.from(subscribedWith).toString('base64url')).toBe(key);
});

// The titles, bodies and notes of the notifications shown. They belong to the worker's
// registration, so they can be read whether or not the worker is running.
function notifications(page: Page): Promise<unknown[]> {
    return page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return (await registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, data: n.data }));
    });
}

// The reason alarms are pushed at all: Chrome stops a worker idle for 30 seconds, and a push is the
// one thing that starts it again at a time of someone else's choosing.
test('shows an alarm pushed after the browser stopped the service worker', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Delivering a push takes the Chrome DevTools Protocol.');
    await mockBackend(context, { 'a.md': '# A\n' });
    await mockPush(context, vapidKey());

    await page.goto('/note/a.md');
    await expect(page.getByRole('heading', { name: 'A' })).toBeVisible();

    const cdp = await context.newCDPSession(page);
    let registrationId: string | undefined;
    const stopped = new Promise<void>((resolve) => {
        cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
            registrationId ??= registrations[0]?.registrationId;
        });
        cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
            if (versions.length > 0 && versions.every((version) => version.runningStatus === 'stopped')) {
                resolve();
            }
        });
    });
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await stopped;

    await cdp.send('ServiceWorker.deliverPushMessage', {
        origin: new URL(page.url()).origin,
        registrationId: registrationId!,
        data: JSON.stringify({ title: 'Standup', body: 'Room 1', tag: 'a.md#Standup', path: 'a.md' }),
    });
    await expect.poll(() => notifications(page)).toEqual([
        { title: 'Standup', body: 'Room 1', data: { path: 'a.md' } },
    ]);
});

// What the worker does with a click on an alarm while a tab is open: the tab routes to the note, as
// a link inside the app would, and keeps what it had rather than loading afresh. The click itself
// cannot be simulated, as a worker refuses to wait on an event the browser did not send it.
test('routes an open tab to the note of a clicked alarm', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Reaching into the service worker takes Chromium.');
    await mockBackend(context, { 'a.md': '# A\n', 'meetings/b.md': '# B\n' });
    await mockPush(context, vapidKey());

    await page.goto('/note/a.md');
    await expect(page.getByRole('heading', { name: 'A' })).toBeVisible();
    await page.evaluate(() => {
        (window as unknown as { loaded: boolean }).loaded = true;
    });

    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
        const scope = self as unknown as ServiceWorkerGlobalScope;
        for (const client of await scope.clients.matchAll({ type: 'window' })) {
            client.postMessage({ type: 'open-note', path: 'meetings/b.md' });
        }
    });

    await expect(page).toHaveURL(/\/note\/meetings\/b\.md$/);
    await expect(page.getByRole('heading', { name: 'B' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
});
