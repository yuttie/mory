// The task tree as a search and a status filter leave it, and which of its branches are open: for
// a tree drawn below the search bar (TaskTreeSearch), which sets `search` and the statuses hidden.

import { type MaybeRefOrGetter, type Ref, computed, ref, toValue, watch } from 'vue';

import type { TaskTreeItem } from '@/task-forest';
import { branchIds, filterTaskTree, searchTerms } from '@/task-tree-filter';

export function useTaskTreeFilter(
    items: MaybeRefOrGetter<TaskTreeItem[]>,
    hiddenStatuses: Ref<string[]>,
    // The branches open without a search, which the caller keeps as it likes.
    openNodes: Ref<string[]>,
) {
    // What the tree is searched for: the search field's words once typing pauses.
    const search = ref('');

    const terms = computed<string[]>(() => searchTerms(search.value));

    const filtered = computed(() => filterTaskTree(toValue(items), { query: search.value, hiddenStatuses: hiddenStatuses.value }));

    // The branches open while a search is under way, apart from `openNodes`, so clearing the search
    // leaves the tree as it was before it.
    const searchOpenNodes = ref<string[]>([]);

    // A search opens every branch it keeps, each being there for a task found under it. So does the
    // next search, and a change to the notes that changes which branches it keeps. Otherwise a branch
    // closed meanwhile stays closed, when a save only reorders the branches too.
    const searchBranches = computed<string[]>(() => terms.value.length > 0 ? branchIds(filtered.value.items) : []);
    watch(() => [search.value, ...[...searchBranches.value].sort()].join('\n'), () => {
        searchOpenNodes.value = searchBranches.value;
    });

    const open = computed<string[]>({
        get: () => terms.value.length > 0 ? searchOpenNodes.value : openNodes.value,
        set: (ids) => {
            if (terms.value.length > 0) {
                searchOpenNodes.value = ids;
            }
            else {
                openNodes.value = ids;
            }
        },
    });

    // Opens the branches `ids` in the tree drawn without a search, and in the one drawn while a
    // search is under way, which opens and closes apart.
    function openAlso(ids: readonly string[]) {
        openNodes.value = [...new Set([...openNodes.value, ...ids])];
        if (terms.value.length > 0) {
            searchOpenNodes.value = [...new Set([...searchOpenNodes.value, ...ids])];
        }
    }

    return { search, terms, filtered, open, openAlso };
}
