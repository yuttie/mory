// The note tree's flavour of the shared path-forest rule.
//
// Where the task tree identifies a node by the UUID in its filename and treats a directory nothing
// covers as an anomaly, the note tree identifies a node by its path and lets such a directory
// become a node of its own. Both parenting styles then work in one tree without a second code
// path: `notes/proj/x.md` nests under a synthesized `notes/proj`, and `notes/<uuid>/x.md` nests
// under the file `notes/<uuid>.md` because that file covers the directory.
//
// Ordering is by recency, mixing directories and files, with a directory taking the newest time
// anywhere beneath it -- which is why the forest is built unsorted and sorted afterwards.

import type { ListEntry2 } from '@/api';
import type { Forest, ForestNode } from '@/forest';
import { flatten, sortForest } from '@/forest';
import type { PathForestPolicy } from '@/path-forest';
import { buildPathForest, stripExtension } from '@/path-forest';
import { compareInstantsDesc } from '@/utils';

// The application's own directories -- `.tasks/`, `.mory/`, `.events/` -- are storage, not notes.
const HIDDEN_SEGMENT = /(^|\/)\./;

// Which files open in the media viewer rather than the note editor. Same rule as `Files.vue`.
const MEDIA_MIME = /^(image\/|video\/|application\/pdf)/i;

export interface NoteNode extends ForestNode {
    id: string;
    parent: string | null;
    path: string;
    // The last path segment: the filename for a file, the directory name for a directory.
    name: string;
    // What the row shows: the entry's title where it has one, otherwise the name.
    title: string;
    // `null` for a directory no file covers, which is the only kind of node with nothing behind it.
    entry: ListEntry2 | null;
    // This node's own commit time; empty for a synthesized directory, which has none.
    mtime: string;
    // The newest commit time in this node's subtree, including itself. What the tree sorts on.
    latest: string;
}

// The nested shape v-treeview consumes. `children` is absent, not empty, on a leaf.
export interface NoteTreeItem extends NoteNode {
    children?: NoteTreeItem[];
}

export function isHiddenPath(path: string): boolean {
    return HIDDEN_SEGMENT.test(path);
}

export function isDirectory(node: NoteNode): boolean {
    return node.entry === null;
}

function nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

const notePolicy: PathForestPolicy<NoteNode> = {
    idOf: (entry) => entry.path,

    // Only a note may stand in for a directory, so `photo.jpg` does not swallow `photo/` while
    // `manage.md` does absorb `manage/`.
    coverOf: (entry) => (entry.mime_type === 'text/markdown' ? stripExtension(entry.path) : null),

    node: (entry, id, parent) => ({
        id,
        parent,
        path: entry.path,
        name: nameOf(entry.path),
        title: entry.title ?? nameOf(entry.path),
        entry,
        mtime: entry.time,
        latest: entry.time,
    }),

    directory: (path, id, parent) => ({
        id,
        parent,
        path,
        name: nameOf(path),
        title: nameOf(path),
        entry: null,
        mtime: '',
        latest: '',
    }),

    // No `sort`: `latest` is not known until the tree is linked.
};

// Newest first, mixing directories and files. Ties break on the path so that the tree cannot
// reorder itself between renders.
export function compareByLatestDesc(a: NoteNode, b: NoteNode): number {
    return compareInstantsDesc(a.latest, b.latest) || a.id.localeCompare(b.id);
}

// Give every node the newest time in its subtree.
//
// `flatten` is pre-order, in which a parent always precedes all of its descendants, so walking it
// backwards visits every child before its parent and one pass suffices.
function assignLatest(forest: Forest<NoteNode>): void {
    const preOrder = flatten(forest);
    for (let i = preOrder.length - 1; i >= 0; i -= 1) {
        const node = preOrder[i];
        if (node.parent === null) {
            continue;
        }
        const parent = forest.byId.get(node.parent);
        if (parent !== undefined && compareInstantsDesc(node.latest, parent.latest) < 0) {
            parent.latest = node.latest;
        }
    }
}

// `prefix` is the ground the tree stands on -- `''` for the whole repository, or a subtree.
export function buildNoteForest(
    entries: readonly ListEntry2[],
    prefix = '',
): Forest<NoteNode> {
    // Filtered here rather than rejected in `idOf`, which would warn once on every rebuild for
    // the couple of hundred entries the application stores under its own directories.
    const visible = entries.filter((entry) => !isHiddenPath(entry.path));
    const forest = buildPathForest(visible, prefix, notePolicy);
    assignLatest(forest);
    sortForest(forest, compareByLatestDesc);
    return forest;
}

// Where clicking this row should go, or `null` for a directory, which only opens.
export function noteRouteFor(node: NoteNode): string | null {
    if (node.entry === null) {
        return null;
    }
    return MEDIA_MIME.test(node.entry.mime_type)
        ? `/media/${node.path}`
        : `/note/${node.path}`;
}
