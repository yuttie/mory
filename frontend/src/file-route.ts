import type { RouteLocationRaw } from 'vue-router';

// What the media view shows rather than the note view.
export function isMediaType(mimeType: string): boolean {
    return /^(image\/|video\/|application\/pdf)/i.test(mimeType);
}

export function routeForMime(path: string, mimeType: string): RouteLocationRaw {
    return {
        name: isMediaType(mimeType) ? 'Media' : 'Note',
        params: { path: path.split('/') },
    };
}
