import type { BrowserContext, Page } from '@playwright/test';

// Stops every service worker the page's browser runs, as the browser does to one idle for 30
// seconds, and resolves with the id of the registration they belong to.
//
// Waited for rather than taken from the command's reply, as a test that restarts a worker means
// something only once the old one is gone. Watched through the protocol, as Playwright's worker
// objects do not follow a worker stopped this way.
export async function stopServiceWorkers(context: BrowserContext, page: Page): Promise<string> {
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
    return registrationId!;
}

// Stops the service workers, and resolves with a function that delivers a push to the registration
// they belong to: the one thing that starts a stopped worker at a time of someone else's choosing.
// The payload is sent as it is if it is text, and as JSON otherwise. Delivering takes the Chrome
// DevTools Protocol, so this is for Chromium.
export async function pushToStoppedWorker(
    context: BrowserContext,
    page: Page,
): Promise<(payload: object | string) => Promise<unknown>> {
    const registrationId = await stopServiceWorkers(context, page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    return (payload) => cdp.send('ServiceWorker.deliverPushMessage', {
        origin: new URL(page.url()).origin,
        registrationId,
        data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
}
