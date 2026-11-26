/**
 * Everything the user can do to the rig. Context menus, keyboard shortcuts
 * and panels all call these, so a new feature only needs to be written once.
 */
import {api, ApiError} from './api';
import {align, contains, distribute, shapeBounds, type AlignEdge} from './geometry';
import {live} from './live.svelte';
import {selection} from './selection.svelte';
import {SCALE_MAX, SCALE_MIN, type AddFixturesRequest, type FixtureUpdate, type ShapeKind, type ShapeUpdate} from './shared';
import {ui} from './ui.svelte';
import {view} from './view.svelte';

/** Run an API call; errors are already shown as a toast by the API client. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
        return await fn();
    } catch (err) {
        if (!(err instanceof ApiError)) ui.showToast((err as Error).message);
        return undefined;
    }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function addFixtures(req: AddFixturesRequest): Promise<void> {
    const res = await attempt(() => api.addFixtures(req));
    if (!res) return;
    selection.set(res.added);
    ui.showToast(`Added ${plural(res.added.length, 'fixture')}`, true);
}

export async function updateFixtures(updates: FixtureUpdate[]): Promise<void> {
    if (updates.length) await attempt(() => api.updateFixtures(updates));
}

export async function deleteFixtures(ids = selection.list): Promise<void> {
    if (!ids.length) return;
    if (await attempt(() => api.deleteFixtures(ids))) {
        selection.clear();
        ui.showToast(`Deleted ${plural(ids.length, 'fixture')}. Press ${modKey}Z to undo.`, true);
    }
}

/** Delete everything selected: fixtures and shapes (one undo step). */
export async function deleteSelection(): Promise<void> {
    const fixtures = selection.list;
    const shapes = selection.shapeList;
    if (!shapes.length) return deleteFixtures(fixtures);
    if (await attempt(() => api.deleteItems({fixtures, shapes}))) {
        selection.clear();
        ui.showToast(`Deleted ${plural(fixtures.length + shapes.length, 'item')}. Press ${modKey}Z to undo.`, true);
    }
}

export async function duplicate(ids = selection.list): Promise<void> {
    if (!ids.length) return;
    const res = await attempt(() => api.duplicate(ids));
    if (res) selection.set(res.added);
}

/** Duplicate everything selected: fixtures and shapes. The copies become the selection. */
export async function duplicateSelection(): Promise<void> {
    const fixtures = selection.list;
    const shapes = selection.shapeList;
    if (!shapes.length) return duplicate(fixtures);
    const res = await attempt(() => api.duplicateItems({fixtures, shapes}));
    if (res) selection.setItems(res.fixtures, res.shapes);
}

/** Save the current positions of the selected fixtures and shapes (after dragging or nudging). */
export async function savePositions(): Promise<void> {
    const fixtures = selection.fixtures.map((f) => ({id: f.id, x: f.x, y: f.y}));
    const shapes = selection.shapes.map((s) => ({id: s.id, x: s.x, y: s.y}));
    if (!shapes.length) return updateFixtures(fixtures);
    await attempt(() => api.updateItems({fixtures, shapes}));
}

export async function updateShapes(updates: ShapeUpdate[]): Promise<void> {
    if (updates.length) await attempt(() => api.updateItems({shapes: updates}));
}

/** Add a shape centred on `at` (world units; default the middle of the view). */
export async function addShape(kind: ShapeKind, at?: {x: number; y: number}): Promise<void> {
    const p = at ?? view.toWorld({x: view.size.width / 2, y: view.size.height / 2});
    const res = await attempt(() => api.addShape({kind, x: Math.round(p.x), y: Math.round(p.y)}));
    if (res) selection.onlyShape(res.added);
}

/** Select the fixtures standing on a shape (their centre is inside it). */
export function selectOnShape(id: string): void {
    const shape = live.shape(id);
    if (!shape) return;
    const box = shapeBounds(shape);
    selection.set(live.fixtures.filter((f) => contains(box, f.x, f.y)).map((f) => f.id));
}

export function openReaddress(ids = selection.list): void {
    if (ids.length) ui.readdressDialog = {open: true, ids};
}

export async function readdress(ids: string[], universe: number, address: number): Promise<boolean> {
    return !!(await attempt(() => api.readdress({ids, universe, address})));
}

export async function alignSelection(edge: AlignEdge): Promise<void> {
    await updateFixtures(align(selection.fixtures, edge));
}

export async function distributeSelection(axis: 'x' | 'y'): Promise<void> {
    await updateFixtures(distribute(selection.fixtures, axis));
}

export async function arrange(ids?: string[]): Promise<void> {
    await attempt(() => api.arrange(ids));
}

export async function rotate(degrees: number, ids = selection.list): Promise<void> {
    const linear = ids.filter((id) => ['bar', 'strip'].includes(live.fixture(id)?.shape ?? ''));
    await updateFixtures(linear.map((id) => ({id, rotation: degrees})));
}

/** Draw fixtures at `scale` × their normal size (1 = 100%). */
export async function resize(scale: number, ids = selection.list): Promise<void> {
    const s = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale)) * 100) / 100;
    await updateFixtures(ids.map((id) => ({id, scale: s === 1 ? null : s})));
}

/** Grow or shrink the selected fixtures by `factor`, each from its own size. */
export async function resizeBy(factor: number): Promise<void> {
    const fixtures = selection.fixtures;
    if (!fixtures.length) return;
    await updateFixtures(
        fixtures.map((f) => {
            const s = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, (f.scale ?? 1) * factor)) * 100) / 100;
            return {id: f.id, scale: s === 1 ? null : s};
        }),
    );
}

export async function setRdm(on: boolean, ids = selection.list): Promise<void> {
    await updateFixtures(ids.map((id) => ({id, rdm: on})));
}

/** Move the selection by (dx, dy) right away on screen; saved after a short pause. */
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
export function nudge(dx: number, dy: number): void {
    if (selection.empty) return;
    for (const item of [...selection.fixtures, ...selection.shapes]) {
        item.x += dx;
        item.y += dy;
    }
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => void savePositions(), 350);
}

export async function undo(): Promise<void> {
    if (live.state?.history.canUndo) await attempt(() => api.undo());
}

export async function redo(): Promise<void> {
    if (live.state?.history.canRedo) await attempt(() => api.redo());
}

export function selectWhere(predicate: (f: (typeof live.fixtures)[number]) => boolean): void {
    selection.set(live.fixtures.filter(predicate).map((f) => f.id));
}

export function showInUniverse(id: string): void {
    const f = live.fixture(id);
    if (!f) return;
    ui.universe = f.universe;
    ui.show('universe');
}

export function openAddDialog(at?: {x: number; y: number}): void {
    const last = live.fixtures.at(-1);
    ui.addDialog = {open: true, x: at?.x, y: at?.y, universe: selection.fixtures[0]?.universe ?? last?.universe ?? 1};
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl+';
