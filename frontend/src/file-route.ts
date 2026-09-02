export function routeForMime(path: string, mimeType: string): string {
    return /^(image\/|video\/|application\/pdf)/i.test(mimeType)
        ? `/media/${path}`
        : `/note/${path}`;
}
