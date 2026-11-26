<!--
  The endless canvas. Fills the page; the top bar, details panel and zoom
  controls float over it. Shapes (stage, trusses, roofs...) are drawn under
  the fixtures, and both can be placed anywhere.

  Mouse:
  - click selects; Shift/⌘/Ctrl-click adds or removes from the selection
  - drag a fixture (or a selected shape, or a shape's name) moves the selection;
    snaps to 10, hold Alt to move freely. Near the window edge the view follows.
  - drag on empty space, or on a shape that isn't selected, draws a selection box
  - a selected shape has handles to resize it
  - right-click opens the fixture, shape or canvas menu
  - scroll / two-finger swipe pans, ⌘/Ctrl + scroll or pinch zooms,
    Space + drag or middle-button drag pans
-->
<script lang="ts">
    import * as act from '../actions';
    import {boundsOf, intersects, rectFromPoints, type Rect} from '../geometry';
    import {live} from '../live.svelte';
    import {canvasMenu, fixtureMenu, shapeMenu} from '../menus';
    import {selection} from '../selection.svelte';
    import {SCALE_MAX, SCALE_MIN, type ShapeConfig, type ShapeKind, type UiFixture} from '../shared';
    import {ui} from '../ui.svelte';
    import {view} from '../view.svelte';
    import FixtureView from './FixtureView.svelte';
    import ShapeView from './ShapeView.svelte';

    const SNAP = 10;
    const MIN_SHAPE = 10;
    /** Distance from the window edge (px) where dragging starts moving the view. */
    const EDGE = 56;
    /** Drawing order: areas at the bottom, labels on top. Fixtures are above all shapes. */
    const LAYER: Record<ShapeKind, number> = {area: 0, stage: 1, truss: 2, roof: 3, label: 4};

    let viewport = $state<HTMLElement>();
    const cam = $derived(view.current);
    const shapes = $derived([...live.shapes].sort((a, b) => LAYER[a.kind] - LAYER[b.kind]));

    $effect(() => {
        if (!viewport) return;
        const el = viewport;
        const observer = new ResizeObserver(() => (view.size = {width: el.clientWidth, height: el.clientHeight}));
        observer.observe(el);
        return () => observer.disconnect();
    });

    /** Mouse position relative to the stage (px). */
    function local(e: {clientX: number; clientY: number}): {x: number; y: number} {
        const r = viewport!.getBoundingClientRect();
        return {x: e.clientX - r.left, y: e.clientY - r.top};
    }
    const toWorld = (e: {clientX: number; clientY: number}) => view.toWorld(local(e));

    // Scroll pans, ⌘/Ctrl + scroll (and trackpad pinch, which arrives as ctrl + wheel) zooms.
    $effect(() => {
        if (!viewport) return;
        const el = viewport;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const unit = e.deltaMode === 1 ? 16 : 1;
            if (e.ctrlKey || e.metaKey) {
                view.zoomTo(view.scale * Math.exp(-e.deltaY * unit * 0.0025), local(e));
            } else if (e.shiftKey && !e.deltaX) {
                view.panBy(-e.deltaY * unit, 0);
            } else {
                view.panBy(-e.deltaX * unit, -e.deltaY * unit);
            }
        };
        el.addEventListener('wheel', onWheel, {passive: false});
        return () => el.removeEventListener('wheel', onWheel);
    });

    // Animation clock, only running while some fixture can strobe.
    let now = $state<number | undefined>(undefined);
    const strobing = $derived(live.fixtures.some((f) => f.layout.channels.includes('strobe') || f.layout.cell.includes('strobe')));
    $effect(() => {
        if (!strobing) {
            now = undefined;
            return;
        }
        let raf = requestAnimationFrame(function tick(t) {
            now = t;
            raf = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(raf);
    });

    type Pointer = {clientX: number; clientY: number; altKey?: boolean};
    let lastPointer: Pointer | null = null;

    // ---- panning ----------------------------------------------------------------
    let spaceHeld = $state(false);
    let pan = $state<{x: number; y: number} | null>(null);

    function onKey(e: KeyboardEvent, down: boolean) {
        if (e.key !== ' ' || (e.target as HTMLElement | null)?.closest('input, select, textarea, button, [contenteditable]') || ui.modal) return;
        e.preventDefault();
        spaceHeld = down;
    }

    /** Pan instead of select/drag: middle button, or Space held. */
    const wantsPan = (e: PointerEvent) => e.button === 1 || (e.button === 0 && spaceHeld);

    function startPan(e: PointerEvent) {
        e.preventDefault();
        e.stopPropagation();
        viewport!.setPointerCapture(e.pointerId);
        pan = {x: e.clientX, y: e.clientY};
    }

    // ---- moving fixtures and shapes ------------------------------------------------
    type Item = {kind: 'fixture' | 'shape'; id: string};
    type Drag = {
        start: {x: number; y: number};
        lead: {x: number; y: number};
        fixtures: Map<string, {x: number; y: number}>;
        shapes: Map<string, {x: number; y: number}>;
        moved: boolean;
        clicked: Item;
        additive: boolean;
    };
    let drag = $state<Drag | null>(null);

    function startDrag(e: PointerEvent, clicked: Item, lead: {x: number; y: number}, additive: boolean) {
        viewport!.setPointerCapture(e.pointerId);
        drag = {
            start: toWorld(e),
            lead: {x: lead.x, y: lead.y},
            fixtures: new Map(selection.fixtures.map((f) => [f.id, {x: f.x, y: f.y}])),
            shapes: new Map(selection.shapes.map((s) => [s.id, {x: s.x, y: s.y}])),
            moved: false,
            clicked,
            additive,
        };
    }

    function onFixtureDown(e: PointerEvent, f: UiFixture) {
        if (wantsPan(e)) return startPan(e);
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        ui.closeMenu();
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (additive) return selection.toggle(f.id);
        if (!selection.has(f.id)) selection.only(f.id);
        if (!live.readonly) startDrag(e, {kind: 'fixture', id: f.id}, f, false);
    }

    /** On a shape's body: a selected shape is dragged; otherwise this starts a selection box (a click selects it). */
    function onShapeBodyDown(e: PointerEvent, s: ShapeConfig) {
        if (wantsPan(e)) return startPan(e);
        if (e.button !== 0) return;
        e.stopPropagation();
        ui.closeMenu();
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (selection.hasShape(s.id) && !additive && !live.readonly) {
            e.preventDefault();
            return startDrag(e, {kind: 'shape', id: s.id}, s, false);
        }
        startMarquee(e, s.id);
    }

    /** On a shape's name: select it and drag it straight away. */
    function onShapeTagDown(e: PointerEvent, s: ShapeConfig) {
        if (wantsPan(e)) return startPan(e);
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        ui.closeMenu();
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (additive) return selection.toggleShape(s.id);
        if (!selection.hasShape(s.id)) selection.onlyShape(s.id);
        if (!live.readonly) startDrag(e, {kind: 'shape', id: s.id}, s, false);
    }

    function moveDrag(e: Pointer) {
        if (!drag) return;
        const p = toWorld(e);
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        if (!drag.moved) {
            if (Math.hypot(dx, dy) * view.scale < 3) return;
            drag.moved = true;
            view.freeze();
        }
        // Snap the item under the mouse to the grid; move the rest by the same amount.
        const snap = e.altKey ? 1 : SNAP;
        const sx = Math.round((drag.lead.x + dx) / snap) * snap - drag.lead.x;
        const sy = Math.round((drag.lead.y + dy) / snap) * snap - drag.lead.y;
        for (const f of selection.fixtures) {
            const o = drag.fixtures.get(f.id);
            if (o) {
                f.x = o.x + sx;
                f.y = o.y + sy;
            }
        }
        for (const s of selection.shapes) {
            const o = drag.shapes.get(s.id);
            if (o) {
                s.x = o.x + sx;
                s.y = o.y + sy;
            }
        }
    }

    // ---- resizing shapes -----------------------------------------------------------
    type Resize = {shape: ShapeConfig; start: {x: number; y: number}; from: {x: number; y: number; width: number; height: number}; hx: number; hy: number; moved: boolean};
    let resize = $state<Resize | null>(null);

    function onHandleDown(e: PointerEvent, s: ShapeConfig, hx: number, hy: number) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        viewport!.setPointerCapture(e.pointerId);
        resize = {shape: s, start: toWorld(e), from: {x: s.x, y: s.y, width: s.width, height: s.height}, hx, hy, moved: false};
    }

    function moveResize(e: Pointer) {
        if (!resize) return;
        const r = resize;
        if (!r.moved) {
            r.moved = true;
            view.freeze();
        }
        const p = toWorld(e);
        // Work in the shape's own (unrotated) axes.
        const rad = ((r.shape.rotation ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const wx = p.x - r.start.x;
        const wy = p.y - r.start.y;
        const lx = wx * cos + wy * sin;
        const ly = -wx * sin + wy * cos;
        const snap = e.altKey ? 1 : SNAP;
        const width = r.hx ? Math.max(MIN_SHAPE, Math.round((r.from.width + r.hx * lx) / snap) * snap) : r.from.width;
        const height = r.hy ? Math.max(MIN_SHAPE, Math.round((r.from.height + r.hy * ly) / snap) * snap) : r.from.height;
        // The opposite edge stays put: move the centre by half the change, along the shape's axes.
        const cx = (r.hx * (width - r.from.width)) / 2;
        const cy = (r.hy * (height - r.from.height)) / 2;
        const target = live.shape(r.shape.id);
        if (!target) return;
        target.width = width;
        target.height = height;
        target.x = r.from.x + cx * cos - cy * sin;
        target.y = r.from.y + cx * sin + cy * cos;
    }

    // ---- resizing a fixture ---------------------------------------------------------
    // Scales around the fixture's centre by how far the handle moves from it.
    type Scaling = {id: string; centre: {x: number; y: number}; d0: number; from: number; base: {w: number; h: number}; moved: boolean};
    let scaling = $state<Scaling | null>(null);

    function onFixtureHandleDown(e: PointerEvent, f: UiFixture) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        viewport!.setPointerCapture(e.pointerId);
        const p = toWorld(e);
        const from = f.scale ?? 1;
        scaling = {
            id: f.id,
            centre: {x: f.x, y: f.y},
            d0: Math.max(1, Math.hypot(p.x - f.x, p.y - f.y)),
            from,
            base: {w: f.size.w / from, h: f.size.h / from},
            moved: false,
        };
    }

    function moveScaling(e: Pointer) {
        const sc = scaling;
        if (!sc) return;
        if (!sc.moved) {
            sc.moved = true;
            view.freeze();
        }
        const p = toWorld(e);
        const raw = (sc.from * Math.hypot(p.x - sc.centre.x, p.y - sc.centre.y)) / sc.d0;
        const step = e.altKey ? 0.01 : 0.05;
        const s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(raw / step) * step));
        const f = live.fixture(sc.id);
        if (!f) return;
        f.scale = s;
        f.size = {w: sc.base.w * s, h: sc.base.h * s};
    }

    // ---- selection box ------------------------------------------------------
    type Marquee = {x0: number; y0: number; x1: number; y1: number; base: string[]; shape?: string; additive: boolean};
    let marquee = $state<Marquee | null>(null);
    const marqueeRect = $derived<Rect | null>(marquee ? rectFromPoints(marquee.x0, marquee.y0, marquee.x1, marquee.y1) : null);

    function startMarquee(e: PointerEvent, shape?: string) {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (!additive) selection.clear();
        const p = toWorld(e);
        viewport!.setPointerCapture(e.pointerId);
        marquee = {x0: p.x, y0: p.y, x1: p.x, y1: p.y, base: additive ? selection.list : [], shape, additive};
    }

    function moveMarquee(e: Pointer) {
        if (!marquee) return;
        const p = toWorld(e);
        marquee.x1 = p.x;
        marquee.y1 = p.y;
        const box = rectFromPoints(marquee.x0, marquee.y0, p.x, p.y);
        const hits = live.fixtures.filter((f) => intersects(box, boundsOf(f))).map((f) => f.id);
        const shapes = marquee.additive ? selection.shapeList : [];
        selection.setItems([...marquee.base, ...hits], shapes);
    }

    function onCanvasDown(e: PointerEvent) {
        ui.closeMenu();
        if (wantsPan(e)) return startPan(e);
        if (e.button === 0) startMarquee(e);
    }

    function onMove(e: PointerEvent) {
        lastPointer = {clientX: e.clientX, clientY: e.clientY, altKey: e.altKey};
        if (pan) {
            view.panBy(e.clientX - pan.x, e.clientY - pan.y);
            pan = {x: e.clientX, y: e.clientY};
        } else if (scaling) {
            moveScaling(e);
        } else if (resize) {
            moveResize(e);
        } else if (drag) {
            moveDrag(e);
        } else if (marquee) {
            moveMarquee(e);
        }
    }

    function onUp() {
        if (drag) {
            if (drag.moved) {
                void act.savePositions();
                view.unfreeze();
            } else if (!drag.additive && selection.size + selection.shapeCount > 1) {
                // A plain click on part of a multi-selection selects just that item.
                if (drag.clicked.kind === 'fixture') selection.only(drag.clicked.id);
                else selection.onlyShape(drag.clicked.id);
            }
            drag = null;
        }
        if (scaling) {
            const f = live.fixture(scaling.id);
            if (scaling.moved && f) {
                void act.resize(f.scale ?? 1, [f.id]);
                view.unfreeze();
            }
            scaling = null;
        }
        if (resize) {
            const s = live.shape(resize.shape.id);
            if (resize.moved && s) {
                void act.updateShapes([{id: s.id, x: Math.round(s.x), y: Math.round(s.y), width: s.width, height: s.height}]);
                view.unfreeze();
            }
            resize = null;
        }
        if (marquee) {
            // A click (no box) on a shape selects the shape.
            const tiny = Math.hypot(marquee.x1 - marquee.x0, marquee.y1 - marquee.y0) * view.scale < 3;
            if (tiny && marquee.shape) {
                if (marquee.additive) selection.toggleShape(marquee.shape);
                else selection.onlyShape(marquee.shape);
            }
            marquee = null;
        }
        pan = null;
        lastPointer = null;
    }

    // Near the window edge while dragging, resizing or selecting: move the view, and keep up with the mouse.
    $effect(() => {
        if (!(drag || marquee || resize) || !viewport) return;
        const el = viewport;
        let raf = requestAnimationFrame(function step() {
            const p = lastPointer;
            const active = marquee || resize?.moved || drag?.moved;
            if (p && active) {
                const r = el.getBoundingClientRect();
                const speed = (inside: number) => (inside < EDGE ? Math.ceil(((EDGE - Math.max(0, inside)) / EDGE) * 16) : 0);
                const dx = speed(p.clientX - r.left) - speed(r.right - p.clientX);
                const dy = speed(p.clientY - r.top) - speed(r.bottom - p.clientY);
                if (dx || dy) {
                    view.panBy(dx, dy);
                    if (resize) moveResize(p);
                    else if (drag) moveDrag(p);
                    else moveMarquee(p);
                }
            }
            raf = requestAnimationFrame(step);
        });
        return () => cancelAnimationFrame(raf);
    });

    // ---- context menus ------------------------------------------------------
    function onFixtureMenu(e: MouseEvent, f: UiFixture) {
        e.preventDefault();
        e.stopPropagation();
        if (!selection.has(f.id)) selection.only(f.id);
        ui.openMenu(e.clientX, e.clientY, fixtureMenu(f.id));
    }

    function onShapeMenu(e: MouseEvent, s: ShapeConfig) {
        e.preventDefault();
        e.stopPropagation();
        if (!selection.hasShape(s.id)) selection.onlyShape(s.id);
        ui.openMenu(e.clientX, e.clientY, shapeMenu(s.id));
    }

    function onCanvasMenu(e: MouseEvent) {
        e.preventDefault();
        const p = toWorld(e);
        ui.openMenu(e.clientX, e.clientY, canvasMenu({x: Math.round(p.x), y: Math.round(p.y)}));
    }
</script>

<svelte:window onkeydown={(e) => onKey(e, true)} onkeyup={(e) => onKey(e, false)} onblur={() => (spaceHeld = false)} />

<section
    class="viewport"
    class:dragging={drag?.moved}
    class:panning={spaceHeld || pan}
    bind:this={viewport}
    role="application"
    aria-label="Stage"
    style:background-size="{50 * cam.scale}px {50 * cam.scale}px"
    style:background-position="{cam.x}px {cam.y}px"
    onpointerdown={onCanvasDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    oncontextmenu={onCanvasMenu}
>
    <div class="world" style:transform="translate({cam.x}px, {cam.y}px) scale({cam.scale})" style:--s={cam.scale}>
        {#each shapes as s (s.id)}
            <ShapeView
                shape={s}
                selected={selection.hasShape(s.id)}
                resizable={!live.readonly && selection.shapeCount === 1 && selection.size === 0 && selection.hasShape(s.id)}
                onbodydown={(e) => onShapeBodyDown(e, s)}
                ontagdown={(e) => onShapeTagDown(e, s)}
                onhandledown={(e, hx, hy) => onHandleDown(e, s, hx, hy)}
                oncontextmenu={(e) => onShapeMenu(e, s)}
            />
        {/each}

        {#each live.fixtures as f (f.id)}
            <FixtureView
                fixture={f}
                frame={live.frame(f.universe)}
                selected={selection.has(f.id)}
                identify={live.identify.has(f.id)}
                {now}
                onpointerdown={(e) => onFixtureDown(e, f)}
                oncontextmenu={(e) => onFixtureMenu(e, f)}
                resizable={!live.readonly && selection.size === 1 && selection.shapeCount === 0 && selection.has(f.id)}
                onhandledown={(e) => onFixtureHandleDown(e, f)}
            />
        {/each}

        {#if marqueeRect}
            <div
                class="marquee"
                style:left="{marqueeRect.left}px"
                style:top="{marqueeRect.top}px"
                style:width="{marqueeRect.right - marqueeRect.left}px"
                style:height="{marqueeRect.bottom - marqueeRect.top}px"
            ></div>
        {/if}
    </div>
</section>

{#if live.state && live.fixtures.length === 0}
    <div class="empty">
        <p>No fixtures yet.</p>
        {#if !live.readonly}
            <button class="primary" onclick={() => act.openAddDialog()}>+ Add fixtures</button>
            <p class="muted small">or right-click the canvas</p>
        {/if}
    </div>
{/if}

<p class="hint small">
    {#if live.readonly}
        Read-only view · click fixtures to inspect them · scroll to pan · ⌘/Ctrl + scroll to zoom
    {:else if selection.size + selection.shapeCount > 1}
        {selection.size + selection.shapeCount} selected · drag to move them together · right-click for more
    {:else}
        Drag to move · drag on empty space to select · right-click to add shapes · scroll to pan, ⌘/Ctrl + scroll to zoom
    {/if}
</p>

<style>
    .viewport {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-color: #0a0c10;
        background-image: linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
        user-select: none;
        touch-action: none;
    }
    .viewport.panning {
        cursor: grab;
    }
    .viewport.panning:active {
        cursor: grabbing;
    }
    .viewport.panning :global(.fx),
    .viewport.panning :global(.shape),
    .viewport.panning :global(.tag) {
        cursor: inherit;
    }
    .world {
        position: absolute;
        left: 0;
        top: 0;
        transform-origin: 0 0;
    }
    .marquee {
        position: absolute;
        border: calc(1px / var(--s, 1)) solid var(--sel);
        background: rgba(96, 165, 250, 0.12);
        pointer-events: none;
        z-index: 10;
    }
    .empty {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--muted);
        pointer-events: none;
    }
    .empty > * {
        pointer-events: auto;
    }
    .empty p {
        margin: 0;
    }
    /* Floats over the bottom of the canvas. */
    .hint {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        margin: 0;
        padding: 4px 12px;
        border-radius: 999px;
        background: rgba(13, 15, 19, 0.75);
        color: var(--muted);
        white-space: nowrap;
        pointer-events: none;
    }
    @media (max-width: 1000px) {
        .hint {
            display: none;
        }
    }
</style>
