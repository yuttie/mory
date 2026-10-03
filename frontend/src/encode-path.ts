// A file's path as the tail of a URL. Each segment is encoded on its own, so `/` stays the
// separator while a `#`, a `?` or a `%` in a name stays part of it: written raw, the first `#` or
// `?` ends the path and the rest is read as a fragment or a query, which names another file.
export function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
}
