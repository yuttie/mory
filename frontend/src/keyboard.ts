import { onMounted, onUnmounted } from 'vue';

// Shortcuts listen on `window`, so they see every key the page gets, including keys meant for
// something else. These tell a shortcut when a key is not its to take.

// A key typed into a text field, where a single-key shortcut would take a character from it.
export function isTyping(event: KeyboardEvent): boolean {
    const target = event.target;
    return target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
}

// A key pressed in a dialog or a menu drawn over the view. What is in it is not the view's, so none
// of the view's shortcuts apply, whatever the key.
export function isInOverlay(event: Event): boolean {
    const target = event.target;
    return target instanceof Element && target.closest('.v-overlay__content') !== null;
}

// Ctrl+S, which the note and the task editor save with. Caps Lock makes the key `S` without Shift;
// with Shift it is another shortcut, which the browser may have.
export function isSaveKey(event: KeyboardEvent): boolean {
    return event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 's';
}

// Ctrl+K, which opens the search dialog from any view and closes it again, as a command palette's
// key does. Caps Lock makes the key `K` without Shift.
export function isSearchKey(event: KeyboardEvent): boolean {
    return event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k';
}

// Window focus events have no element target, but a modal still owns the next keystroke.
export function hasActiveDialog(): boolean {
    return document.querySelector('.v-overlay--active[role="dialog"]') !== null;
}

// The dialog drawn over every other open one: a menu opened from it is drawn over it too, but is no
// dialog. Told by z-index, as it is drawn: Vuetify gives each overlay it opens one above every open
// overlay's.
function topDialog(): Element | null {
    let top: Element | null = null;
    let topZIndex = -Infinity;
    for (const dialog of document.querySelectorAll('.v-overlay--active[role="dialog"]')) {
        const zIndex = Number(getComputedStyle(dialog).zIndex) || 0;
        if (zIndex >= topZIndex) {
            top = dialog;
            topZIndex = zIndex;
        }
    }
    return top;
}

// Shortcuts come in layers, one for each thing drawn that a key can be meant for: the view at the
// bottom, and over it each open dialog, the last opened on top. A key goes to the top layer alone,
// wherever the focus is, which is not always inside it: the parent picker closed over a task's
// editor leaves it on the page. The order is the one Vuetify draws the dialogs in, read as each key
// comes rather than kept here, where every dialog would have to push and pop a layer of its own,
// and one that did not would let the layer under it take its keys.
//
// The handler's shortcuts are the view's, or with `within` those of the dialog that element is
// drawn in, the view's again if it is in none. A menu is no layer: a key typed in one goes to the
// layer on top, which opened it, and each shortcut there decides whether the key is its own.
//
// Ctrl+S is kept from the browser while a layer that saves with it is under the one on top: the
// browser's would offer to save the page, where the key means to save what that layer holds.
export function useShortcuts(
    handler: (event: KeyboardEvent) => void,
    within?: () => Element | null | undefined,
): void {
    function onKeydown(event: KeyboardEvent): void {
        let dialog: Element | null = null;
        if (within !== undefined) {
            const element = within();
            if (!element) {
                return;
            }
            dialog = element.closest('.v-overlay[role="dialog"]');
        }
        if (dialog === topDialog()) {
            handler(event);
        }
        else if (isSaveKey(event)) {
            event.preventDefault();
        }
    }

    onMounted(() => {
        window.addEventListener('keydown', onKeydown);
    });
    onUnmounted(() => {
        window.removeEventListener('keydown', onKeydown);
    });
}
