/**
 * UI-only state: open tab, dialogs, the context menu and toasts.
 */
import type {MenuItem} from './menus';

export type Tab = 'fixture' | 'patch' | 'universe' | 'sources' | 'log';

type AddDialogState = {open: boolean; x?: number; y?: number; universe?: number};
type ReaddressDialogState = {open: boolean; ids: string[]};
type MenuState = {x: number; y: number; items: MenuItem[]} | null;
type Toast = {id: number; message: string; ok: boolean} | null;

class Ui {
    /** The floating details panel: whether it shows, and which tab. */
    panelOpen = $state(false);
    tab = $state<Tab>('fixture');
    /** Universe shown in the Universe tab. */
    universe = $state(1);
    addDialog = $state<AddDialogState>({open: false});
    readdressDialog = $state<ReaddressDialogState>({open: false, ids: []});
    helpOpen = $state(false);
    menu = $state<MenuState>(null);
    toast = $state<Toast>(null);

    private toastTimer: ReturnType<typeof setTimeout> | undefined;

    /** Open the details panel on a tab. */
    show(tab: Tab): void {
        this.tab = tab;
        this.panelOpen = true;
    }

    togglePanel(): void {
        this.panelOpen = !this.panelOpen;
    }

    showToast(message: string, ok = false): void {
        this.toast = {id: Date.now(), message, ok};
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => (this.toast = null), ok ? 2500 : 6000);
    }

    openMenu(x: number, y: number, items: MenuItem[]): void {
        this.menu = {x, y, items};
    }

    closeMenu(): void {
        this.menu = null;
    }

    /** True while a dialog or menu is open (keyboard shortcuts pause). */
    get modal(): boolean {
        return this.addDialog.open || this.readdressDialog.open || this.helpOpen;
    }
}

export const ui = new Ui();
