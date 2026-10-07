// A view's shortcuts listen on `window`, so they see every key the page gets, including keys meant
// for something else. These tell a view when a key is not its to take.

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

// Window focus events have no element target, but a modal still owns the next keystroke.
export function hasActiveDialog(): boolean {
    return document.querySelector('.v-overlay--active[role="dialog"]') !== null;
}
