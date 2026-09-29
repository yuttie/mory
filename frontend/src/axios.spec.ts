import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAxios } from '@/axios';

// Where the app store keeps the token, which `getAxios()` reads on every call.
function storeToken(token: string | null): void {
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => key === 'token' ? JSON.stringify(token) : null,
    });
}

describe('getAxios', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends the stored token', () => {
        storeToken('first');
        expect(getAxios().defaults.headers.common['Authorization']).toBe('Bearer first');
    });

    // The client is one instance for the whole app, so a header left on it after a logout goes out
    // with every request that follows.
    it('stops sending the token once it is gone', () => {
        storeToken('first');
        getAxios();
        storeToken(null);
        expect(getAxios().defaults.headers.common['Authorization']).toBeUndefined();
    });
});
