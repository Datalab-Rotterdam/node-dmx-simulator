<!--
  Draws one fixture from its DMX values. Shapes: par (round lens), head
  (lens + beam from pan/tilt/zoom), bar and strip (one block per cell).
  To add a new look, add a shape to FixtureShape and a branch here.
-->
<script lang="ts">
    import {hue, lookOf, rgba, type Look} from '../color';
    import {decodeFixture, type UiFixture} from '../shared';

    type Props = {
        fixture: UiFixture;
        frame: Uint8Array;
        selected: boolean;
        identify: boolean;
        /** Animation clock (ms) for strobing; undefined when nothing strobes. */
        now?: number;
        /** Show corner handles to resize it. */
        resizable?: boolean;
        onpointerdown?: (e: PointerEvent) => void;
        oncontextmenu?: (e: MouseEvent) => void;
        onhandledown?: (e: PointerEvent) => void;
    };

    let {fixture: f, frame, selected, identify, now, resizable = false, onpointerdown, oncontextmenu, onhandledown}: Props = $props();

    // The drawing is made at the type's normal size and scaled as a whole, so lenses, borders and beams keep their proportions.
    const scale = $derived(f.scale ?? 1);
    const base = $derived({w: f.size.w / scale, h: f.size.h / scale});
    const CORNERS = [
        {x: 0, y: 0, cursor: 'nwse-resize'},
        {x: 100, y: 0, cursor: 'nesw-resize'},
        {x: 0, y: 100, cursor: 'nesw-resize'},
        {x: 100, y: 100, cursor: 'nwse-resize'},
    ];

    const decoded = $derived(decodeFixture(f.layout, frame, f.address));
    const look = $derived(lookOf(decoded.values, now));
    const cells = $derived(decoded.cells.map((cell) => lookOf({...decoded.values, ...cell}, now)));
    const linear = $derived(f.shape === 'bar' || f.shape === 'strip');
    const rotation = $derived(f.rotation ?? 0);
    const range = $derived(f.layout.footprint === 1 ? `${f.address}` : `${f.address}-${f.address + f.layout.footprint - 1}`);

    // Keep the label upright, below the (possibly rotated) body.
    const labelTop = $derived.by(() => {
        const rad = (rotation * Math.PI) / 180;
        return Math.abs(f.size.w * Math.sin(rad)) + Math.abs(f.size.h * Math.cos(rad));
    });

    function lens(c: Look): {background: string; shadow: string} {
        if (c.level <= 0.003) return {background: '#000', shadow: 'none'};
        const full = hue(c);
        return {
            background: `radial-gradient(circle, ${rgba(full)} 0%, ${rgba(c)} 55%, ${rgba(c, 0.6)} 100%)`,
            shadow: c.level > 0.02 ? `0 0 ${12 + c.level * 40}px ${4 + c.level * 14}px ${rgba(full, c.level * 0.55)}` : 'none',
        };
    }

    const lensStyle = $derived(lens(look));

    // Top-down view of a moving head: pan turns the beam, tilt away from centre makes it longer.
    const beam = $derived.by(() => {
        const pan = decoded.values.pan ?? 0.5;
        const tilt = decoded.values.tilt ?? 0.5;
        const zoom = decoded.values.zoom ?? 0.3;
        let angle = pan * 540 - 270;
        if (tilt < 0.5) angle += 180;
        return {
            angle,
            length: 30 + Math.abs(tilt - 0.5) * 2 * 190,
            width: 30 + zoom * 120,
            color: rgba(hue(look), 0.85),
            alpha: Math.min(1, look.level * 1.2),
        };
    });
</script>

<div
    class="fx {f.shape}"
    class:selected
    class:issue={f.issues.length > 0}
    class:identify
    data-id={f.id}
    role="button"
    tabindex="-1"
    aria-label="{f.name}, universe {f.universe}, channels {range}"
    style:left="{f.x - f.size.w / 2}px"
    style:top="{f.y - f.size.h / 2}px"
    style:width="{f.size.w}px"
    style:height="{f.size.h}px"
    {onpointerdown}
    {oncontextmenu}
>
    <div class="draw" style:width="{base.w}px" style:height="{base.h}px" style:transform={scale !== 1 ? `scale(${scale})` : undefined}>
        {#if f.shape === 'head'}
            <div
                class="beam"
                style:transform="rotate({beam.angle}deg)"
                style:--len="{beam.length}px"
                style:--w="{beam.width}px"
                style:--c={beam.color}
                style:--a={beam.alpha}
            ></div>
        {/if}
        <div class="body" style:transform={rotation ? `rotate(${rotation}deg)` : undefined}>
            {#if linear}
                {#each cells as c, i (i)}
                    <div
                        class="cell"
                        style:background={rgba(c)}
                        style:box-shadow={c.level > 0.05 ? `0 0 ${4 + c.level * 10}px ${rgba(c, c.level * 0.8)}` : 'none'}
                    ></div>
                {/each}
            {/if}
        </div>
        {#if !linear}
            <div class="lens" style:background={lensStyle.background} style:box-shadow={lensStyle.shadow}></div>
        {/if}
    </div>
    {#if resizable}
        <div class="handles" style:transform={rotation ? `rotate(${rotation}deg)` : undefined}>
            {#each CORNERS as c (`${c.x},${c.y}`)}
                <span
                    class="handle"
                    role="presentation"
                    title="Drag to resize"
                    style:left="{c.x}%"
                    style:top="{c.y}%"
                    style:cursor={c.cursor}
                    onpointerdown={onhandledown}
                ></span>
            {/each}
        </div>
    {/if}
    <div class="label" style:top="calc(50% + {labelTop / 2}px)">
        {f.name}<br /><span class="addr">U{f.universe} · {range}</span>
    </div>
    {#if f.issues.length}<span class="badge" title={f.issues.join('\n')}>!</span>{/if}
    {#if identify}<span class="id-tag">IDENTIFY</span>{/if}
</div>

<style>
    .fx {
        position: absolute;
        cursor: grab;
        outline: none;
    }
    :global(.readonly) .fx {
        cursor: pointer;
    }
    :global(.dragging) .fx.selected {
        cursor: grabbing;
    }
    .draw {
        position: absolute;
        left: 0;
        top: 0;
        transform-origin: 0 0;
    }
    .handles {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 3;
    }
    .handle {
        position: absolute;
        width: calc(10px / var(--s, 1));
        height: calc(10px / var(--s, 1));
        transform: translate(-50%, -50%);
        background: #fff;
        border: calc(1.5px / var(--s, 1)) solid var(--sel);
        border-radius: calc(2px / var(--s, 1));
        pointer-events: auto;
    }
    .body {
        position: absolute;
        inset: 0;
        border: 2px solid #3a414e;
        background: #15181e;
        transition: border-color 0.12s, box-shadow 0.12s;
    }
    .selected .body {
        border-color: var(--sel);
        box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.35);
    }
    .issue .body {
        border-color: var(--err);
    }
    .selected.issue .body {
        box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.35);
    }
    .par .body {
        border-radius: 50%;
    }
    .par .lens {
        position: absolute;
        inset: 7px;
        border-radius: 50%;
        pointer-events: none;
    }
    .head .body {
        border-radius: 14px;
    }
    .head .lens {
        position: absolute;
        inset: 14px;
        border-radius: 50%;
        pointer-events: none;
    }
    .beam {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 0;
        height: 0;
        pointer-events: none;
    }
    .beam::before {
        content: '';
        position: absolute;
        left: calc(var(--w) / -2);
        bottom: 0;
        width: var(--w);
        height: var(--len);
        clip-path: polygon(42% 100%, 58% 100%, 100% 0, 0 0);
        background: linear-gradient(to top, var(--c), transparent);
        opacity: var(--a);
    }
    .bar .body,
    .strip .body {
        border-radius: 5px;
        display: flex;
        gap: 2px;
        padding: 4px;
    }
    .strip .body {
        gap: 0;
        padding: 3px 4px;
        border-width: 1px;
    }
    .cell {
        flex: 1;
        border-radius: 2px;
        background: #000;
    }
    .strip .cell {
        border-radius: 0;
    }
    .label {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        margin-top: 5px;
        font-size: 11px;
        line-height: 1.25;
        white-space: nowrap;
        text-align: center;
        pointer-events: none;
        color: #c9ced8;
        text-shadow: 0 1px 2px #000;
    }
    .selected .label {
        color: #fff;
    }
    .addr {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 10.5px;
    }
    .badge {
        position: absolute;
        top: -9px;
        right: -9px;
        font-size: 10px;
        font-weight: 700;
        border-radius: 999px;
        padding: 1px 6px;
        background: var(--err);
        color: #1b0b0b;
    }
    .identify .body {
        animation: identify 0.5s steps(1) infinite;
    }
    @keyframes identify {
        50% {
            border-color: #fff;
            box-shadow: 0 0 0 4px #fff, 0 0 24px #fff;
        }
    }
    .id-tag {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 6px;
        background: #fff;
        color: #000;
        font-size: 10px;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 4px;
        white-space: nowrap;
        pointer-events: none;
    }
</style>
