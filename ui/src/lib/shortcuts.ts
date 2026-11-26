/**
 * Keyboard shortcuts. Each entry matches a key (plus modifiers) and calls an
 * action. `mod` means ⌘ on macOS and Ctrl elsewhere.
 */
import * as act from './actions';
import {live} from './live.svelte';
import {selection} from './selection.svelte';
import {ui} from './ui.svelte';
import {view} from './view.svelte';

type Shortcut = {
    key: string;
    mod?: boolean;
    shift?: boolean;
    /** Needs edit rights (ignored in read-only mode). */
    edit?: boolean;
    run: (e: KeyboardEvent) => void;
};

const nudge = (dx: number, dy: number) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 50 : 10;
    act.nudge(dx * step, dy * step);
};

export const SHORTCUTS: Shortcut[] = [
    // Esc closes, one thing at a time: the menu, then the selection, then the panel.
    {key: 'Escape', run: () => (ui.menu ? ui.closeMenu() : !selection.empty ? selection.clear() : (ui.panelOpen = false))},
    {key: 'i', run: () => ui.togglePanel()},
    // Fixture size: [ smaller, ] bigger.
    {key: '[', edit: true, run: () => act.resizeBy(1 / 1.25)},
    {key: ']', edit: true, run: () => act.resizeBy(1.25)},
    // Zoom: + and - step, 0 fits everything, 1 is 100%.
    {key: '=', run: () => view.zoomIn()},
    {key: '+', shift: true, run: () => view.zoomIn()},
    {key: '+', run: () => view.zoomIn()},
    {key: '-', run: () => view.zoomOut()},
    {key: '0', run: () => view.fit()},
    {key: '1', run: () => view.zoomTo(1)},
    {key: 'a', mod: true, run: () => selection.selectAll()},
    {key: 'Delete', edit: true, run: () => act.deleteSelection()},
    {key: 'Backspace', edit: true, run: () => act.deleteSelection()},
    {key: 'd', mod: true, edit: true, run: () => act.duplicateSelection()},
    {key: 'z', mod: true, edit: true, run: () => act.undo()},
    {key: 'z', mod: true, shift: true, edit: true, run: () => act.redo()},
    {key: 'y', mod: true, edit: true, run: () => act.redo()},
    {key: 'ArrowLeft', edit: true, run: nudge(-1, 0)},
    {key: 'ArrowRight', edit: true, run: nudge(1, 0)},
    {key: 'ArrowUp', edit: true, run: nudge(0, -1)},
    {key: 'ArrowDown', edit: true, run: nudge(0, 1)},
    {key: 'ArrowLeft', shift: true, edit: true, run: nudge(-1, 0)},
    {key: 'ArrowRight', shift: true, edit: true, run: nudge(1, 0)},
    {key: 'ArrowUp', shift: true, edit: true, run: nudge(0, -1)},
    {key: 'ArrowDown', shift: true, edit: true, run: nudge(0, 1)},
];

/** Window keydown handler. Ignores keys typed into form fields or while a dialog is open. */
export function handleKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, select, textarea, [contenteditable]') || ui.modal) return;
    const mod = act.isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const shortcut = SHORTCUTS.find((s) => s.key === key && !!s.mod === mod && !!s.shift === e.shiftKey);
    if (!shortcut || (shortcut.edit && live.readonly)) return;
    e.preventDefault();
    shortcut.run(e);
}
