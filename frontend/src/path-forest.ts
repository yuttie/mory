// Turning a flat file listing into a forest.
//
// Notes are files in a Git repository, so a note's place in a tree is decided by its path. Both
// trees the app draws -- tasks under `.tasks/`, and ordinary notes -- follow one rule:
//
//     A node's parent is the entry that *covers* its containing directory: the entry whose path
//     minus its extension equals that directory. If no entry covers it, the directory itself
//     becomes a node.
//
// That single rule is what the task tree's UUID convention amounts to. `.tasks/A/B.md` sits in
// `.tasks/A`, which `.tasks/A.md` covers, so B's parent is the file A -- no UUID involved. The
// same rule nests `notes/proj/x.md` under `notes/proj.md` when that file exists, and under a
// synthesized `notes/proj` directory when it does not.
//
// What actually differs between the two trees is narrow enough to be a policy: what identifies a
// node, which entries may cover a directory, whether an uncovered directory becomes a node or
// its children are re-rooted, and how siblings are ordered.

import type { ListEntry2 } from '@/api';
import type { Forest, ForestNode } from '@/forest';
import { buildForest } from '@/forest';

export interface PathForestPolicy<N extends ForestNode> {
    // What identifies this entry's node. Returning `null` skips the entry, which is how a policy
    // rejects a path it considers malformed -- the task policy demands a UUIDv4 per component.
    idOf(entry: ListEntry2): string | null;

    // The directory this entry stands in for, normally its path minus the extension, so that
    // `.tasks/A.md` covers `.tasks/A`. `null` for an entry that never absorbs a directory: a note
    // policy can restrict covering to markdown so that `photo.jpg` does not swallow `photo/`.
    coverOf(entry: ListEntry2): string | null;

    // The node for a real file entry.
    node(entry: ListEntry2, id: string, parent: string | null): N;

    // The node for a directory no entry covers. Returning `null` declines to synthesize one, and
    // the children below it are re-rooted instead -- what the task tree wants, since an uncovered
    // directory there is an anomaly rather than structure.
    directory(path: string, id: string, parent: string | null): N | null;

    // Applied to every sibling list, the roots included.
    sort?(a: N, b: N): number;
}

// Build a forest from `entries`, treating `root` as the ground the tree stands on: directories at
// or above it are never nodes, so an entry directly inside it is a root.
//
// `root` is a prefix as the callers hold it -- `'.tasks/'` with the trailing slash, or `''` for
// the whole repository.
export function buildPathForest<N extends ForestNode>(
    entries: readonly ListEntry2[],
    root: string,
    policy: PathForestPolicy<N>,
): Forest<N> {
    const rootDir = root.endsWith('/') ? root.slice(0, -1) : root;

    // Which entry covers which directory. Built first, because a node's parent is decided by
    // looking its containing directory up in here.
    const coveredBy = new Map<string, ListEntry2>();
    const identified: { entry: ListEntry2; id: string }[] = [];
    let skipped = 0;
    for (const entry of entries) {
        const id = policy.idOf(entry);
        if (id === null) {
            skipped += 1;
            continue;
        }
        identified.push({ entry, id });
        const cover = policy.coverOf(entry);
        if (cover !== null && !coveredBy.has(cover)) {
            coveredBy.set(cover, entry);
        }
    }
    if (skipped > 0) {
        console.warn(`Path forest: skipped ${skipped} entry/entries the policy did not accept.`);
    }

    const nodes: N[] = [];
    // Directories synthesized so far, so a directory shared by many entries becomes one node.
    const directories = new Map<string, string | null>();

    // The id of the node `path`'s children hang from, synthesizing directory nodes up to `root`
    // as needed. `null` means "hang from the root".
    function containerOf(path: string): string | null {
        if (path === rootDir || path === '' || path === '.') {
            return null;
        }

        const covering = coveredBy.get(path);
        if (covering !== undefined) {
            // A file stands in for this directory, so its children are that file's children.
            return policy.idOf(covering);
        }

        const known = directories.get(path);
        if (known !== undefined) {
            return known;
        }

        // Reserve the slot before recursing so a pathological path cannot recurse forever.
        directories.set(path, null);
        const parent = containerOf(dirname(path, rootDir));
        const node = policy.directory(path, path, parent);
        if (node === null) {
            // The policy declines to represent this directory; its children re-root.
            return null;
        }
        directories.set(path, node.id);
        nodes.push(node);
        return node.id;
    }

    for (const { entry, id } of identified) {
        nodes.push(policy.node(entry, id, containerOf(dirname(entry.path, rootDir))));
    }

    return buildForest(nodes, policy.sort);
}

// The directory holding `path`, or `rootDir` once there is nothing left above it.
function dirname(path: string, rootDir: string): string {
    const cut = path.lastIndexOf('/');
    if (cut === -1) {
        return rootDir === '' ? '' : rootDir;
    }
    return path.slice(0, cut);
}

// A path with its final extension removed: `.tasks/A.md` -> `.tasks/A`. Used by policies as the
// default `coverOf`, and leaves a dotfile without an extension (`.gitignore`) alone.
export function stripExtension(path: string): string {
    const slash = path.lastIndexOf('/');
    const dot = path.lastIndexOf('.');
    if (dot <= slash + 1) {
        return path;
    }
    return path.slice(0, dot);
}
