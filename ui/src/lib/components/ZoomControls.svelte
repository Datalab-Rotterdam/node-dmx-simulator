<!-- Floating zoom controls (bottom left). Keys: + and - zoom, 0 fits everything, 1 is 100%. -->
<script lang="ts">
    import {view} from '../view.svelte';

    const percent = $derived(Math.round(view.scale * 100));
</script>

<div class="zoom" role="group" aria-label="Zoom">
    <button class="ghost" title="Zoom out (-)" aria-label="Zoom out" onclick={() => view.zoomOut()}>−</button>
    <button class="ghost pct" title="Zoom to 100% (1)" onclick={() => view.zoomTo(1)}>{percent}%</button>
    <button class="ghost" title="Zoom in (+)" aria-label="Zoom in" onclick={() => view.zoomIn()}>+</button>
    <span class="sep"></span>
    <button class="ghost fit" class:active={view.fitting} title="Fit everything on screen (0)" onclick={() => view.fit()}>Fit</button>
</div>

<style>
    .zoom {
        position: absolute;
        left: 18px;
        bottom: 16px;
        z-index: 25;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        background: rgba(22, 26, 33, 0.92);
        backdrop-filter: blur(10px);
        border: 1px solid var(--line);
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    button {
        padding: 3px 9px;
        font-size: 15px;
        line-height: 1.2;
    }
    .pct {
        font-size: 12px;
        min-width: 52px;
        font-variant-numeric: tabular-nums;
    }
    .fit {
        font-size: 12px;
    }
    .fit.active {
        color: var(--accent);
    }
    .sep {
        width: 1px;
        height: 18px;
        background: var(--line);
        margin: 0 2px;
    }
</style>
