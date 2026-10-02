import { generateKeyPairSync } from 'node:crypto';

import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { API_URL, mockBackend } from './backend';
import { pushToStoppedWorker } from './worker';

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

interface PushRequests {
    registered: unknown[];
    deleted: unknown[];
}

// moried's push endpoints, recording what the page registers and deletes. Registered after
// `mockBackend`, so they answer before its catch-all.
async function mockPush(context: BrowserContext, key: string): Promise<PushRequests> {
    const requests: PushRequests = { registered: [], deleted: [] };
    await context.route(`${API_URL}v2/push/**`, async (route) => {
        const request = route.request();
        if (request.url().endsWith('/push/key')) {
            await route.fulfill({ json: key });
            return;
        }
        if (request.method() === 'PUT') {
            requests.registered.push(request.postDataJSON());
        }
        if (request.method() === 'DELETE') {
            requests.deleted.push(request.postDataJSON());
        }
        await route.fulfill({ status: 204 });
    });
    return requests;
}

// What the page did with the browser's push subscription, as the stand-in below records it.
interface Recorded {
    subscribedWith?: string;
    unsubscribed?: boolean;
}

// Playwright's Chromium has no push service to subscribe with, so the browser's half is stood in
// for: what is checked is what the page asks of it, and what it tells moried. `existingKey` is the
// key an earlier subscription was made with, if there is one.
async function standInForPush(context: BrowserContext, existingKey?: string): Promise<void> {
    await context.addInitScript((existing) => {
        const recorded = {} as Recorded;
        (window as unknown as { recorded: Recorded }).recorded = recorded;
        const toBytes = (key: string) => Uint8Array.from(
            atob(key.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0)).buffer;
        const subscription = (key: ArrayBuffer | null) => ({
            endpoint: 'https://push.example/1',
            options: { applicationServerKey: key },
            toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }),
            unsubscribe: async () => {
                recorded.unsubscribed = true;
                return true;
            },
        }) as unknown as PushSubscription;
        let current = existing === undefined ? null : subscription(toBytes(existing));
        PushManager.prototype.getSubscription = async () => current;
        PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
            const key = options!.applicationServerKey as ArrayBuffer;
            recorded.subscribedWith = btoa(String.fromCharCode(...new Uint8Array(key)))
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            current = subscription(key);
            return current;
        };
    }, existingKey);
}

function recorded(page: Page): Promise<Recorded> {
    return page.evaluate(() => (window as unknown as { recorded: Recorded }).recorded);
}

test.beforeEach(async ({ context, baseURL }) => {
    await context.grantPermissions(['notifications'], { origin: baseURL });
});

test('registers this browser for alarms, with the zone it reads the calendar in', async ({ context, page }) => {
    await mockBackend(context, { 'a.md': '# A\n' });
    const key = vapidKey();
    const { registered } = await mockPush(context, key);
    await standInForPush(context);

    await page.goto('/note/a.md');
    await expect.poll(() => registered).toHaveLength(1);
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(registered[0]).toEqual({
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p', auth: 'a' },
        zone,
    });
    expect(await recorded(page)).toEqual({ subscribedWith: key });
});

// moried's key follows `MORIED_SECRET`, and a subscription made with the old one is refused by the
// push service once it is rotated.
test('subscribes afresh when moried has a new key', async ({ context, page }) => {
    await mockBackend(context, { 'a.md': '# A\n' });
    const key = vapidKey();
    const { registered } = await mockPush(context, key);
    await standInForPush(context, vapidKey());

    await page.goto('/note/a.md');
    await expect.poll(() => registered).toHaveLength(1);
    expect(await recorded(page)).toEqual({ unsubscribed: true, subscribedWith: key });
});

// Alarms name events from a private repository, so signing out on purpose ends them. A session
// that expires signs out too, and must not: the alarms are for when no page is looked at.
test('ends alarms on signing out, and keeps them when the session expires', async ({ context, page }) => {
    await mockBackend(context, { 'a.md': '# A\n', 'b.md': '# B\n' });
    const key = vapidKey();
    const { registered, deleted } = await mockPush(context, key);
    await standInForPush(context, key);
    // The session expires on the second note's first request.
    let expired = false;
    await context.route(`${API_URL}notes/b.md`, async (route) => {
        if (!expired) {
            expired = true;
            await route.fulfill({ status: 401, json: {} });
            return;
        }
        await route.fallback();
    });

    await page.goto('/note/b.md');
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    expect(deleted).toEqual([]);
    expect(await recorded(page)).toEqual({});

    await page.goto('/note/a.md');
    await expect.poll(() => registered.length).toBeGreaterThan(0);
    await page.getByRole('listitem').filter({ hasText: 'e2e' }).first().click();
    await page.getByText('Logout', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    expect(deleted).toEqual([{ endpoint: 'https://push.example/1' }]);
    expect(await recorded(page)).toEqual({ unsubscribed: true });
});

// The notifications shown, by title: what they say, how they are tagged, and the note each opens.
// They belong to the worker's registration, so they can be read whether or not the worker is running.
function shown(page: Page): Promise<{
    title: string;
    body: string;
    tag: string;
    renotify: boolean;
    data: unknown;
}[]> {
    return page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return (await registration.getNotifications())
            .map((n) => ({ title: n.title, body: n.body, tag: n.tag, renotify: n.renotify, data: n.data }))
            .sort((a, b) => a.title.localeCompare(b.title));
    });
}

// The reason alarms are pushed at all: a push is the one thing that starts a stopped worker at a
// time of someone else's choosing.
test('shows an alarm pushed after the browser stopped the service worker', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Delivering a push takes the Chrome DevTools Protocol.');
    await mockBackend(context, { 'a.md': '# A\n' });
    await mockPush(context, vapidKey());

    await page.goto('/note/a.md');
    await expect(page.getByRole('heading', { name: 'A' })).toBeVisible();
    const push = await pushToStoppedWorker(context, page);

    await push({ title: 'Standup', body: 'Room 1', tag: 'a.md#Standup', path: 'a.md' });
    await expect.poll(() => shown(page)).toMatchObject([
        { title: 'Standup', body: 'Room 1', data: { path: 'a.md' } },
    ]);
});

// An alarm ahead of its event says when the event is, in the reader's words: moried sends the
// moment and the worker, which is in the reader's zone and locale, says it.
test('says when the event is, as its reader would say it', async ({ browserName, context, page }) => {
    test.skip(browserName !== 'chromium', 'Delivering a push takes the Chrome DevTools Protocol.');
    await mockBackend(context, { 'a.md': '# A\n' });
    await mockPush(context, vapidKey());

    await page.goto('/note/a.md');
    await expect(page.getByRole('heading', { name: 'A' })).toBeVisible();
    const push = await pushToStoppedWorker(context, page);

    // The same moments, said as the page's own locale says them: what the worker is held to.
    const day = 24 * 60 * 60 * 1000;
    const { now, soon, later, today, wanted } = await page.evaluate((day) => {
        const now = new Date();
        const time = { hour: 'numeric', minute: '2-digit' } as const;
        const say = (date: Date, options: Intl.DateTimeFormatOptions) =>
            new Intl.DateTimeFormat(undefined, options).format(date);
        const soon = new Date(now.getTime() + 3 * day);
        const later = new Date(now.getTime() + 20 * day);
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return {
            now: now.toISOString(),
            soon: soon.toISOString(),
            later: later.toISOString(),
            today,
            wanted: {
                now: say(now, time),
                soon: say(soon, { weekday: 'short', ...time }),
                later: say(later, { weekday: 'short', month: 'short', day: 'numeric', ...time }),
                today: say(now, { weekday: 'short', month: 'short', day: 'numeric' }),
            },
        };
    }, day);

    await push({ title: 'Today', tag: 'a.md#Today', path: 'a.md', start: now, all_day: false, body: 'Room 1' });
    await push({ title: 'This week', tag: 'a.md#Week', path: 'a.md', start: soon, all_day: false });
    await push({ title: 'Later', tag: 'a.md#Later', path: 'a.md', start: later, all_day: false });
    await push({ title: 'Whole day', tag: 'a.md#Day', path: 'a.md', start: today, all_day: true });
    // From an older moried, with no start: shown as it always was.
    await push({ title: 'Older', tag: 'a.md#Older', path: 'a.md', body: 'Room 2' });
    // Not moried's at all, so with no tag: it has nothing to replace, which the browser would refuse
    // to be told to.
    await push('Sent from DevTools');

    await expect.poll(async () => (await shown(page)).length).toBe(6);
    // In the order `shown` gives them, which is by title.
    expect(await shown(page)).toMatchObject([
        { title: 'Later', body: wanted.later, tag: 'a.md#Later', renotify: true },
        { title: 'mory', body: 'Sent from DevTools', tag: '', renotify: false },
        { title: 'Older', body: 'Room 2', tag: 'a.md#Older', renotify: true },
        { title: 'This week', body: wanted.soon, tag: 'a.md#Week', renotify: true },
        { title: 'Today', body: `${wanted.now} \u00b7 Room 1`, tag: 'a.md#Today', renotify: true },
        { title: 'Whole day', body: wanted.today, tag: 'a.md#Day', renotify: true },
    ]);
});

// A click on an alarm while a tab is open: the tab routes to the note, as a link inside the app
// would, and keeps what it had rather than loading afresh. The worker's own `openNote` is called,
// as the click itself cannot be simulated.
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
    const refusal = await worker.evaluate(async (path) => {
        const scope = self as unknown as { openNote(path: string): Promise<void> };
        // Only a click lets the worker focus a tab, so the focus is refused here; the routing
        // happens before it.
        return scope.openNote(path).then(() => null, (error: Error) => error.name);
    }, 'meetings/b.md');
    expect([null, 'InvalidAccessError']).toContain(refusal);

    await expect(page).toHaveURL(/\/note\/meetings\/b\.md$/);
    await expect(page.getByRole('heading', { name: 'B' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { loaded?: boolean }).loaded)).toBe(true);
});
