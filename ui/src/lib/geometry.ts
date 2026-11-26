/**
 * Stage geometry: bounding boxes, alignment, distribution and hit testing.
 * Positions are fixture centres in stage units.
 */
import type {FixtureUpdate, ShapeConfig, UiFixture} from './shared';

export type Rect = {left: number; top: number; right: number; bottom: number};
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Axis-aligned bounding box of a fixture, including its rotation. */
export function boundsOf(f: Pick<UiFixture, 'x' | 'y' | 'size' | 'rotation'>): Rect {
    const rad = ((f.rotation ?? 0) * Math.PI) / 180;
    const w = Math.abs(f.size.w * Math.cos(rad)) + Math.abs(f.size.h * Math.sin(rad));
    const h = Math.abs(f.size.w * Math.sin(rad)) + Math.abs(f.size.h * Math.cos(rad));
    return {left: f.x - w / 2, right: f.x + w / 2, top: f.y - h / 2, bottom: f.y + h / 2};
}

/** Axis-aligned bounding box of a shape, including its rotation. */
export function shapeBounds(s: ShapeConfig): Rect {
    return boundsOf({x: s.x, y: s.y, size: {w: s.width, h: s.height}, rotation: s.rotation});
}

export function contains(outer: Rect, x: number, y: number): boolean {
    return x >= outer.left && x <= outer.right && y >= outer.top && y <= outer.bottom;
}

export function unionOf(rects: Rect[]): Rect {
    return {
        left: Math.min(...rects.map((r) => r.left)),
        top: Math.min(...rects.map((r) => r.top)),
        right: Math.max(...rects.map((r) => r.right)),
        bottom: Math.max(...rects.map((r) => r.bottom)),
    };
}

export function intersects(a: Rect, b: Rect): boolean {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Line fixtures up along one edge or centre line of their combined bounds. */
export function align(fixtures: UiFixture[], edge: AlignEdge): FixtureUpdate[] {
    if (fixtures.length < 2) return [];
    const all = unionOf(fixtures.map(boundsOf));
    return fixtures.map((f) => {
        const b = boundsOf(f);
        const halfW = (b.right - b.left) / 2;
        const halfH = (b.bottom - b.top) / 2;
        switch (edge) {
            case 'left': return {id: f.id, x: Math.round(all.left + halfW)};
            case 'right': return {id: f.id, x: Math.round(all.right - halfW)};
            case 'hcenter': return {id: f.id, x: Math.round((all.left + all.right) / 2)};
            case 'top': return {id: f.id, y: Math.round(all.top + halfH)};
            case 'bottom': return {id: f.id, y: Math.round(all.bottom - halfH)};
            case 'vcenter': return {id: f.id, y: Math.round((all.top + all.bottom) / 2)};
        }
    });
}

/** Space fixtures evenly between the first and last one along an axis. */
export function distribute(fixtures: UiFixture[], axis: 'x' | 'y'): FixtureUpdate[] {
    if (fixtures.length < 3) return [];
    const sorted = [...fixtures].sort((a, b) => a[axis] - b[axis]);
    const first = sorted[0]![axis];
    const step = (sorted[sorted.length - 1]![axis] - first) / (sorted.length - 1);
    return sorted.map((f, i) => ({id: f.id, [axis]: Math.round(first + step * i)}));
}

/** Fixtures in reading order on the stage: top to bottom, then left to right (rows within ~half a fixture). */
export function stageOrder(fixtures: UiFixture[]): UiFixture[] {
    return [...fixtures].sort((a, b) => {
        const rowTolerance = Math.min(a.size.h, b.size.h) / 2;
        return Math.abs(a.y - b.y) > rowTolerance ? a.y - b.y : a.x - b.x;
    });
}

export function rectFromPoints(x0: number, y0: number, x1: number, y1: number): Rect {
    return {left: Math.min(x0, x1), right: Math.max(x0, x1), top: Math.min(y0, y1), bottom: Math.max(y0, y1)};
}
