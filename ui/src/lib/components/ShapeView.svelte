<!--
  One shape on the canvas: stage, truss, roof, area or text label.
  Drawn in world units inside the zoomed layer; `--s` (the zoom) keeps
  outlines and handles the same size on screen.
  To add a kind: add it to SHAPE_KINDS / SHAPE_DEFAULTS in shared/types.ts
  and give it a style here.
-->
<script lang="ts">
    import type {ShapeConfig} from '../shared';

    type Props = {
        shape: ShapeConfig;
        selected: boolean;
        /** Show resize handles. */
        resizable: boolean;
        onbodydown?: (e: PointerEvent) => void;
        ontagdown?: (e: PointerEvent) => void;
        onhandledown?: (e: PointerEvent, hx: number, hy: number) => void;
        oncontextmenu?: (e: MouseEvent) => void;
    };

    let {shape: s, selected, resizable, onbodydown, ontagdown, onhandledown, oncontextmenu}: Props = $props();

    const HANDLES = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1],
    ] as const;
    const CURSORS: Record<string, string> = {
        '-1,-1': 'nwse-resize', '1,1': 'nwse-resize', '1,-1': 'nesw-resize', '-1,1': 'nesw-resize',
        '0,-1': 'ns-resize', '0,1': 'ns-resize', '-1,0': 'ew-resize', '1,0': 'ew-resize',
    };
</script>

<div
    class="shape {s.kind}"
    class:selected
    data-shape={s.id}
    role="presentation"
    style:left="{s.x - s.width / 2}px"
    style:top="{s.y - s.height / 2}px"
    style:width="{s.width}px"
    style:height="{s.height}px"
    style:transform={s.rotation ? `rotate(${s.rotation}deg)` : undefined}
    style:--c={s.color ?? (s.kind === 'label' ? '#c9ced8' : '#3b82f6')}
    onpointerdown={onbodydown}
    {oncontextmenu}
>
    {#if s.kind === 'label'}
        <span class="text" style:font-size="{Math.max(8, s.height * 0.6)}px">{s.name}</span>
    {:else}
        <span class="tag" role="presentation" onpointerdown={ontagdown} {oncontextmenu}>{s.name}</span>
    {/if}
    {#if resizable}
        {#each HANDLES as [hx, hy] (`${hx},${hy}`)}
            <span
                class="handle"
                role="presentation"
                style:left="{(hx + 1) * 50}%"
                style:top="{(hy + 1) * 50}%"
                style:cursor={CURSORS[`${hx},${hy}`]}
                onpointerdown={(e) => onhandledown?.(e, hx, hy)}
            ></span>
        {/each}
    {/if}
</div>

<style>
    .shape {
        position: absolute;
        box-sizing: border-box;
        transform-origin: 50% 50%;
    }
    .selected {
        outline: calc(2px / var(--s, 1)) solid var(--sel);
        outline-offset: calc(2px / var(--s, 1));
    }
    .tag {
        position: absolute;
        left: 8px;
        top: 6px;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        white-space: nowrap;
        color: #6b7585;
        cursor: move;
        user-select: none;
    }

    .stage {
        background: #141922;
        border: 1px solid #2a3240;
        border-radius: 6px;
    }

    .truss {
        border: 2px solid #5b6575;
        background:
            repeating-linear-gradient(45deg, transparent 0 7px, #5b6575 7px 9px),
            repeating-linear-gradient(-45deg, transparent 0 7px, #3f4753 7px 9px),
            #1b2029;
        background-size: 16px 100%;
        border-radius: 2px;
    }
    /* Fixtures hang on trusses, so the name goes beside it, not on it. */
    .truss .tag {
        top: 50%;
        left: auto;
        right: calc(100% + 8px);
        transform: translateY(-50%);
        font-size: 11px;
    }

    /* Roofs are outlines over the stage: only the name and the edge pick them up. */
    .roof {
        border: 2px dashed #4b5563;
        border-radius: 4px;
        pointer-events: none;
    }
    .roof .tag,
    .roof .handle {
        pointer-events: auto;
    }
    .roof .tag {
        top: auto;
        bottom: calc(100% + 4px);
        left: 0;
    }

    .area {
        background: color-mix(in srgb, var(--c) 10%, transparent);
        border: 1px dashed color-mix(in srgb, var(--c) 60%, transparent);
        border-radius: 8px;
    }
    .area .tag {
        color: color-mix(in srgb, var(--c) 75%, white);
    }

    .label {
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: move;
    }
    .label .text {
        color: var(--c);
        font-weight: 600;
        white-space: nowrap;
        user-select: none;
    }

    .handle {
        position: absolute;
        width: calc(10px / var(--s, 1));
        height: calc(10px / var(--s, 1));
        transform: translate(-50%, -50%);
        background: #fff;
        border: calc(1.5px / var(--s, 1)) solid var(--sel);
        border-radius: calc(2px / var(--s, 1));
        z-index: 2;
    }
</style>
