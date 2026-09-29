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
