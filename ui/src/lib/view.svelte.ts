/**
 * The camera on the endless canvas: zoom and pan.
 *
 * Screen position = world position × scale + (x, y). World units are the rig
 * file's coordinates. In "fit" mode (camera = null) every shape and fixture is
 * scaled to fit the free area between the floating top bar and the controls,
 * and refits when the window or rig changes. Zooming or panning switches to a
 * fixed camera until you press Fit again.
 */
import {shapeBounds} from './geometry';
import {live} from './live.svelte';

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 4;
const STEPS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];

/** Screen space kept clear around the content for the floating top bar and controls (px). */
export const INSET = {top: 76, right: 28, bottom: 72, left: 28};
/** Room kept below a fixture for its name and address (world units). */
export const LABEL_SPACE = 32;

export type Camera = {scale: number; x: number; y: number};
type Point = {x: number; y: number};

const clamp = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

class View {
    /** Size of the visible area (px), set by the stage. */
    size = $state({width: 1200, height: 800});
    /** Chosen camera; null fits everything. */
    camera = $state<Camera | null>(null);
    /** While dragging things, fit mode stops refitting so nothing moves under the mouse. */
    frozen = $state<Camera | null>(null);

    /** Bounding box of every shape and fixture (world units). */
    readonly content = $derived.by(() => {
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const s of live.shapes) {
            const b = shapeBounds(s);
            left = Math.min(left, b.left);
            top = Math.min(top, b.top);
            right = Math.max(right, b.right);
            bottom = Math.max(bottom, b.bottom);
        }
        for (const f of live.fixtures) {
            left = Math.min(left, f.x - f.size.w / 2);
            top = Math.min(top, f.y - f.size.h / 2);
            right = Math.max(right, f.x + f.size.w / 2);
            bottom = Math.max(bottom, f.y + f.size.h / 2 + LABEL_SPACE);
        }
        if (left === Infinity) return {left: 0, top: 0, right: 1200, bottom: 700};
        return {left, top, right: Math.max(right, left + 100), bottom: Math.max(bottom, top + 100)};
    });

    readonly fitCamera = $derived.by<Camera>(() => {
        const freeW = Math.max(100, this.size.width - INSET.left - INSET.right);
        const freeH = Math.max(100, this.size.height - INSET.top - INSET.bottom);
        const c = this.content;
        const w = c.right - c.left;
        const h = c.bottom - c.top;
        const scale = clamp(Math.min(freeW / w, freeH / h));
        return {
            scale,
            x: INSET.left + (freeW - w * scale) / 2 - c.left * scale,
            y: INSET.top + (freeH - h * scale) / 2 - c.top * scale,
        };
    });

    readonly current = $derived<Camera>(this.frozen ?? this.camera ?? this.fitCamera);
    readonly scale = $derived(this.current.scale);

    get fitting(): boolean {
        return this.camera === null && this.frozen === null;
    }

    /** Screen (px, relative to the stage) to world units. */
    toWorld(p: Point): Point {
        const c = this.current;
        return {x: (p.x - c.x) / c.scale, y: (p.y - c.y) / c.scale};
    }

    /** Zoom to `scale`, keeping the world point under `at` (stage px; default the middle) in place. */
    zoomTo(scale: number, at?: Point): void {
        const p = at ?? {x: this.size.width / 2, y: this.size.height / 2};
        const s = clamp(scale);
        const w = this.toWorld(p);
        this.setCamera({scale: s, x: p.x - w.x * s, y: p.y - w.y * s});
    }

    zoomIn(at?: Point): void {
        this.zoomTo(STEPS.find((s) => s > this.scale * 1.001) ?? ZOOM_MAX, at);
    }

    zoomOut(at?: Point): void {
        this.zoomTo(STEPS.findLast((s) => s < this.scale * 0.999) ?? ZOOM_MIN, at);
    }

    panBy(dx: number, dy: number): void {
        const c = this.current;
        this.setCamera({scale: c.scale, x: c.x + dx, y: c.y + dy});
    }

    fit(): void {
        this.camera = null;
        this.frozen = null;
    }

    /** Hold the camera while dragging. */
    freeze(): void {
        this.frozen = {...this.current};
    }

    /** After a drag: keep the camera where it is if fitting would now move things. */
    unfreeze(): void {
        const f = this.frozen;
        if (!f) return;
        if (this.camera === null) {
            const fit = this.fitCamera;
            const moved = Math.abs(fit.scale - f.scale) > 1e-6 || Math.abs(fit.x - f.x) > 0.5 || Math.abs(fit.y - f.y) > 0.5;
            if (moved) this.camera = f;
        }
        this.frozen = null;
    }

    private setCamera(c: Camera): void {
        if (this.frozen) this.frozen = c;
        else this.camera = c;
    }
}

export const view = new View();
