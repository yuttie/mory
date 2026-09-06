import type { RouteLocationRaw } from 'vue-router';

export function routeForMime(path: string, mimeType: string): RouteLocationRaw {
    return {
        name: /^(image\/|video\/|application\/pdf)/i.test(mimeType) ? 'Media' : 'Note',
        params: { path: path.split('/') },
    };
}
