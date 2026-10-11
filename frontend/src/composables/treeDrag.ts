import { onScopeDispose, shallowRef } from 'vue';

// Dragging a row of a tree onto another row.
//
// Sortable, which the task lists drag with, moves the element it drags into the list it is held
// over, and wants each list to hold its items as children. A v-treeview is Vuetify's DOM, groups
// nested in groups, and Vue patches it believing every row is where it put it. So nothing here moves
// a row: a drag only reports which row it was let go over, and the tree is redrawn from whatever
// the caller makes of that.
//
// What a drag shows on the rows is drawn as classes set on them directly, not through their props:
// changing the props of one row re-renders every row of the tree, and the row under the pointer
// changes each time it crosses one. Vue writes a row's classes only when its own change, so these
// stay until the drag takes them off.

export interface TreeDragOptions {
    // Whether the row `id` can be picked up at all.
    canDrag: (id: string) => boolean;
    // Whether the row `id`, once picked up, can be dropped on the row `target`.
    canDrop: (id: string, target: string) => boolean;
    drop: (id: string, target: string) => void;
}

// A row, by the id the tree puts on it.
const ROW = '[data-tree-id]';

// How far a mouse moves, pressed, before the press is a drag rather than a click.
const MOUSE_SLOP = 4;

// A finger picks a row up by resting on it, as long as it rests on a task in the Status view. One
// that moves first is scrolling, and the browser ends the press itself with a `pointercancel`.
const TOUCH_DELAY = 500;

// How near the top or bottom of the tree a held row scrolls it, and how fast at the very edge, in
// pixels a frame. A tree can be short -- the task tree is 200px tall on a phone -- and a drop has to
// reach the rows it hides.
const SCROLL_EDGE = 40;
const SCROLL_SPEED = 12;

interface Press {
    id: string;
    pointerId: number;
    x: number;
    y: number;
    root: HTMLElement;
    touch: boolean;
    timer?: number;
}

export function useTreeDrag(options: TreeDragOptions) {
    // The row being dragged, and where the pointer holds it: what the copy following the pointer is
    // drawn from.
    const dragged = shallowRef<string | null>(null);
    const pointer = shallowRef({ x: 0, y: 0, touch: false });

    let press: Press | null = null;
    // The row the pointer was last over, and the same row if it takes the dragged one.
    let over: HTMLElement | null = null;
    let target: HTMLElement | null = null;
    // What scrolls the tree's rows, and the frame that next scrolls it.
    let scroller: HTMLElement | null = null;
    let frame = 0;

    function rowAt(root: HTMLElement, x: number, y: number): HTMLElement | null {
        const row = document.elementFromPoint(x, y)?.closest<HTMLElement>(ROW) ?? null;
        return row !== null && root.contains(row) ? row : null;
    }

    function onPointerDown(event: PointerEvent) {
        if (press !== null || !event.isPrimary || event.button !== 0) {
            return;
        }
        const root = event.currentTarget as HTMLElement;
        const element = event.target as Element;
        // A row's buttons -- its chevron, its add button -- are pressed, not picked up with it.
        if (element.closest('button') !== null) {
            return;
        }
        const row = element.closest<HTMLElement>(ROW);
        if (row === null || !root.contains(row) || !options.canDrag(row.dataset.treeId!)) {
            return;
        }
        const pressed: Press = {
            id: row.dataset.treeId!,
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            root,
            touch: event.pointerType === 'touch',
        };
        press = pressed;
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
        if (pressed.touch) {
            pressed.timer = window.setTimeout(() => lift(pressed), TOUCH_DELAY);
            // Not passive, so that it can keep the page from scrolling once the row is picked up.
            window.addEventListener('touchmove', onTouchMove, { passive: false });
            window.addEventListener('contextmenu', onContextMenu, true);
        }
    }

    // Picks the row up where the finger rests on it.
    function lift(from: Press) {
        start(from);
        pointer.value = { x: from.x, y: from.y, touch: true };
        aim();
    }

    function onPointerMove(event: PointerEvent) {
        if (press === null || event.pointerId !== press.pointerId) {
            return;
        }
        // Released without a word: a menu the browser opened over the press, for one, takes the
        // release for itself. The pointer moves on holding nothing, and the next click would drop
        // the row wherever it was.
        if ((event.buttons & 1) === 0) {
            cancel();
            return;
        }
        if (dragged.value === null) {
            if (press.touch || Math.hypot(event.clientX - press.x, event.clientY - press.y) < MOUSE_SLOP) {
                return;
            }
            start(press);
        }
        pointer.value = { x: event.clientX, y: event.clientY, touch: press.touch };
        aim();
    }

    // A finger moving a row it holds would otherwise scroll what is under it. Before the row is
    // picked up, that scroll is what the finger is for.
    function onTouchMove(event: TouchEvent) {
        if (dragged.value !== null && event.cancelable) {
            event.preventDefault();
        }
    }

    // A long press is what picks a row up, and on a link it also opens the browser's menu for the
    // link, which takes over the touch and ends the drag.
    function onContextMenu(event: Event) {
        event.preventDefault();
    }

    function onPointerUp(event: PointerEvent) {
        if (press === null || event.pointerId !== press.pointerId) {
            return;
        }
        const id = dragged.value;
        const dropped = target?.dataset.treeId;
        cancel();
        if (id !== null && dropped !== undefined) {
            options.drop(id, dropped);
        }
    }

    // Another pointer's cancel, such as a second finger's, is no end of this press.
    function onPointerCancel(event: PointerEvent) {
        if (event.pointerId === press?.pointerId) {
            cancel();
        }
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            cancel();
        }
    }

    function start(from: Press) {
        dragged.value = from.id;
        from.root.classList.add('tree-dragging');
        // Marked once, when the drag begins: the rows drawn are the open ones, and nothing opens
        // while a task is held.
        for (const row of from.root.querySelectorAll<HTMLElement>(ROW)) {
            if (!options.canDrop(from.id, row.dataset.treeId!)) {
                row.classList.add('tree-drop-refused');
            }
        }
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('blur', cancel);
        scroller = scrollerOf(from.root);
        frame = requestAnimationFrame(tick);
    }

    // Aims again each frame, not only when the pointer moves: a wheel, the scrolling here, or a sync
    // redrawing the tree each bring another row under a pointer that stays put, and letting go there
    // drops the task on that row.
    function tick() {
        frame = requestAnimationFrame(tick);
        scroll();
        aim();
    }

    // Scrolls the tree while the pointer is near its top or bottom, faster the nearer.
    function scroll() {
        if (scroller === null) {
            return;
        }
        const { x, y } = pointer.value;
        const area = scroller.getBoundingClientRect();
        if (x < area.left || x > area.right) {
            return;
        }
        // How far into the band along the top the pointer is, or, below zero, along the bottom.
        const depth = Math.max(0, area.top + SCROLL_EDGE - y) - Math.max(0, y - (area.bottom - SCROLL_EDGE));
        if (depth === 0) {
            return;
        }
        // At least a pixel, which is as fine as some browsers scroll.
        const step = Math.max(1, Math.round(Math.min(1, Math.abs(depth) / SCROLL_EDGE) * SCROLL_SPEED));
        scroller.scrollTop -= Math.sign(depth) * step;
    }

    // Marks the row under the pointer as the target, if it takes the dragged row.
    function aim() {
        if (press === null || dragged.value === null) {
            return;
        }
        const row = rowAt(press.root, pointer.value.x, pointer.value.y);
        if (row === over) {
            return;
        }
        over = row;
        const next = row !== null && options.canDrop(dragged.value, row.dataset.treeId!) ? row : null;
        if (next !== target) {
            target?.classList.remove('tree-drop-target');
            next?.classList.add('tree-drop-target');
            target = next;
        }
    }

    // Ends the press, or the drag it became, without dropping anything.
    function cancel() {
        if (press === null) {
            return;
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('contextmenu', onContextMenu, true);
        window.clearTimeout(press.timer);
        if (dragged.value !== null) {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('blur', cancel);
            cancelAnimationFrame(frame);
            press.root.classList.remove('tree-dragging');
            for (const row of press.root.querySelectorAll('.tree-drop-refused, .tree-drop-target')) {
                row.classList.remove('tree-drop-refused', 'tree-drop-target');
            }
            swallowClick();
        }
        press = null;
        over = null;
        target = null;
        scroller = null;
        dragged.value = null;
    }

    onScopeDispose(cancel);

    return { dragged, pointer, onPointerDown };
}

// The nearest element that scrolls `element`, itself included.
function scrollerOf(element: HTMLElement): HTMLElement | null {
    for (let current: HTMLElement | null = element; current !== null; current = current.parentElement) {
        const { overflowY } = getComputedStyle(current);
        if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
            return current;
        }
    }
    return null;
}

// Releasing a drag clicks where it was pressed, if it is let go there, and a row is a link: the
// drag would open the row it was moving. The click comes before the next press or key, if it comes
// at all, so either is what stops waiting for it.
function swallowClick() {
    const swallow = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        stop();
    };
    const stop = () => {
        window.removeEventListener('click', swallow, true);
        window.removeEventListener('pointerdown', stop, true);
        window.removeEventListener('keydown', stop, true);
    };
    window.addEventListener('click', swallow, true);
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('keydown', stop, true);
}
