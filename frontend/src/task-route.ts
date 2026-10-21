import type { RouteLocationRaw } from 'vue-router';

// The task view's address: the node selected in its tree (`_` for none), whose descendants it lists,
// the view it lists them in, and the task open in the editor over the list, if any. An address
// rather than a navigation, so a link can point where a click would go and still be opened in a new
// tab. The editor is a query on the list's address, so closing it leaves the list as it was.
export function tasksRoute(selectedNodeId?: string, viewMode?: string, task?: string): RouteLocationRaw {
    return {
        name: 'TasksNextWithParams',
        params: {
            selectedNodeId: selectedNodeId || '_',
            viewMode: viewMode || 'schedule',
        },
        ...(task ? { query: { task } } : {}),
    };
}

// A task opened from outside the list it is in: selected, in its editor.
export function taskRoute(uuid: string, viewMode?: string): RouteLocationRaw {
    return tasksRoute(uuid, viewMode, uuid);
}
