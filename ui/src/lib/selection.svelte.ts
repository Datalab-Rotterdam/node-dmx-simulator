/**
 * What is selected: fixtures and shapes. Shared by the stage, the panels,
 * the context menus and the keyboard shortcuts.
 *
 * Most tools act on fixtures (`ids`, `list`, `fixtures`, `size`); moving,
 * duplicating and deleting act on both.
 */
import {SvelteSet} from 'svelte/reactivity';

import {live} from './live.svelte';
import type {ShapeConfig, UiFixture} from './shared';

class Selection {
    /** Selected fixture ids. */
    readonly ids = new SvelteSet<string>();
    /** Selected shape ids. */
    readonly shapeIds = new SvelteSet<string>();
    /** The fixture clicked last: used as the anchor for Shift-click ranges in lists. */
    anchor = $state<string | null>(null);

    has(id: string): boolean {
        return this.ids.has(id);
    }

    hasShape(id: string): boolean {
        return this.shapeIds.has(id);
    }

    /** Number of selected fixtures. */
    get size(): number {
        return this.ids.size;
    }

    get shapeCount(): number {
        return this.shapeIds.size;
    }

    get empty(): boolean {
        return this.ids.size === 0 && this.shapeIds.size === 0;
    }

    /** Selected fixtures, in rig order. */
    get fixtures(): UiFixture[] {
        return live.fixtures.filter((f) => this.ids.has(f.id));
    }

    /** Selected fixture ids, in rig order. */
    get list(): string[] {
        return this.fixtures.map((f) => f.id);
    }

    get shapes(): ShapeConfig[] {
        return live.shapes.filter((s) => this.shapeIds.has(s.id));
    }

    get shapeList(): string[] {
        return this.shapes.map((s) => s.id);
    }

    /** The single selected fixture, if exactly one fixture (and nothing else) is selected. */
    get single(): UiFixture | undefined {
        return this.ids.size === 1 && this.shapeIds.size === 0 ? live.fixture([...this.ids][0]!) : undefined;
    }

    /** Select just this fixture. */
    only(id: string): void {
        this.shapeIds.clear();
        this.ids.clear();
        this.ids.add(id);
        this.anchor = id;
    }

    /** Select just this shape. */
    onlyShape(id: string): void {
        this.ids.clear();
        this.shapeIds.clear();
        this.shapeIds.add(id);
    }

    toggle(id: string): void {
        if (this.ids.has(id)) this.ids.delete(id);
        else this.ids.add(id);
        this.anchor = id;
    }

    toggleShape(id: string): void {
        if (this.shapeIds.has(id)) this.shapeIds.delete(id);
        else this.shapeIds.add(id);
    }

    /** Select exactly these fixtures (and no shapes). */
    set(ids: Iterable<string>): void {
        this.shapeIds.clear();
        this.ids.clear();
        for (const id of ids) this.ids.add(id);
    }

    /** Replace both selections. */
    setItems(fixtures: Iterable<string>, shapes: Iterable<string>): void {
        this.ids.clear();
        this.shapeIds.clear();
        for (const id of fixtures) this.ids.add(id);
        for (const id of shapes) this.shapeIds.add(id);
    }

    add(ids: Iterable<string>): void {
        for (const id of ids) this.ids.add(id);
    }

    /** Select everything between the anchor and `id` in `order` (Shift-click in a list). */
    range(id: string, order: string[]): void {
        const from = this.anchor ? order.indexOf(this.anchor) : -1;
        const to = order.indexOf(id);
        if (from < 0 || to < 0) return this.only(id);
        const [a, b] = from < to ? [from, to] : [to, from];
        this.add(order.slice(a, b + 1));
    }

    clear(): void {
        this.ids.clear();
        this.shapeIds.clear();
        this.anchor = null;
    }

    /** Select every fixture. */
    selectAll(): void {
        this.set(live.fixtures.map((f) => f.id));
    }

    /** Drop ids of fixtures and shapes that no longer exist (after a delete or undo). */
    prune(): void {
        const fixtures = new Set(live.fixtures.map((f) => f.id));
        for (const id of [...this.ids]) if (!fixtures.has(id)) this.ids.delete(id);
        if (this.anchor && !fixtures.has(this.anchor)) this.anchor = null;
        const shapes = new Set(live.shapes.map((s) => s.id));
        for (const id of [...this.shapeIds]) if (!shapes.has(id)) this.shapeIds.delete(id);
    }
}

export const selection = new Selection();
