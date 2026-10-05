import type { RouteLocationRaw } from 'vue-router';

// The task view's address: the node selected in its tree (`_` for none), the tab beside the tree,
// and the view the Descendants tab lists in. An address rather than a navigation, so a link can
// point where a click would go and still be opened in a new tab.
export function tasksRoute(selectedNodeId?: string, tab?: string, viewMode?: string): RouteLocationRaw {
    return {
        name: 'TasksNextWithParams',
        params: {
            selectedNodeId: selectedNodeId || '_',
            tab: tab || 'descendants',
            viewMode: viewMode || 'status',
        },
    };
}

// A task opened from outside the task view: selected, in its editor.
export function taskRoute(uuid: string): RouteLocationRaw {
    return tasksRoute(uuid, 'selected');
}
