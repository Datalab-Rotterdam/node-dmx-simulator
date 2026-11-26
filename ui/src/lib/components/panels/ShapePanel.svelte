<!-- Editor for selected shapes (stage, truss, roof, area, label). -->
<script lang="ts">
    import * as act from '../../actions';
    import {live} from '../../live.svelte';
    import {selection} from '../../selection.svelte';
    import {SHAPE_KINDS, type ShapeConfig, type ShapeUpdate} from '../../shared';

    const shapes = $derived(selection.shapes);
    const single = $derived(shapes.length === 1 ? shapes[0] : undefined);
    const ro = $derived(live.readonly);
    const KIND_NAMES: Record<string, string> = {stage: 'Stage', truss: 'Truss', roof: 'Roof', area: 'Area', label: 'Text label'};

    function edit(s: ShapeConfig, field: keyof ShapeUpdate, raw: string) {
        const numeric = ['x', 'y', 'width', 'height', 'rotation'].includes(field);
        const value = numeric ? Number(raw) : raw;
        if (numeric && !Number.isFinite(value)) return;
        void act.updateShapes([{id: s.id, [field]: field === 'rotation' && !value ? null : value}]);
    }
</script>

{#if single}
    {@const s = single}
    <h3>{s.name}</h3>
    {#key s.id}
        <div class="grid2">
            <label class="full">{s.kind === 'label' ? 'Text' : 'Name'} <input value={s.name} disabled={ro} onchange={(e) => edit(s, 'name', e.currentTarget.value)} /></label>
            <label>Kind
                <select value={s.kind} disabled={ro} onchange={(e) => edit(s, 'kind', e.currentTarget.value)}>
                    {#each SHAPE_KINDS as kind (kind)}<option value={kind}>{KIND_NAMES[kind]}</option>{/each}
                </select>
            </label>
            <label>Rotation
                <input type="number" step="15" value={s.rotation ?? 0} disabled={ro} onchange={(e) => edit(s, 'rotation', e.currentTarget.value)} />
            </label>
            <label>X (centre) <input type="number" step="10" value={Math.round(s.x)} disabled={ro} onchange={(e) => edit(s, 'x', e.currentTarget.value)} /></label>
            <label>Y (centre) <input type="number" step="10" value={Math.round(s.y)} disabled={ro} onchange={(e) => edit(s, 'y', e.currentTarget.value)} /></label>
            <label>Width <input type="number" min="1" step="10" value={s.width} disabled={ro} onchange={(e) => edit(s, 'width', e.currentTarget.value)} /></label>
            <label>Height <input type="number" min="1" step="10" value={s.height} disabled={ro} onchange={(e) => edit(s, 'height', e.currentTarget.value)} /></label>
            {#if s.kind === 'area' || s.kind === 'label'}
                <label>Colour <input type="color" value={s.color ?? (s.kind === 'label' ? '#c9ced8' : '#3b82f6')} disabled={ro} onchange={(e) => edit(s, 'color', e.currentTarget.value)} /></label>
            {/if}
        </div>
    {/key}
    <p class="muted small">Drag the shape (or its name) to move it, and the handles to resize it. Shapes are only drawn; they don't affect DMX.</p>
    <div class="actions">
        <button onclick={() => act.selectOnShape(s.id)}>Select fixtures on it</button>
        {#if !ro}
            <span class="spacer"></span>
            <button onclick={() => act.duplicateSelection()}>Duplicate</button>
            <button class="danger" onclick={() => act.deleteSelection()}>Delete</button>
        {/if}
    </div>
{:else if shapes.length}
    <h3>{shapes.length} shapes selected</h3>
    <ul class="names">{#each shapes as s (s.id)}<li>{s.name} <span class="muted">({KIND_NAMES[s.kind]})</span></li>{/each}</ul>
    {#if !ro}
        <div class="actions">
            <span class="spacer"></span>
            <button onclick={() => act.duplicateSelection()}>Duplicate</button>
            <button class="danger" onclick={() => act.deleteSelection()}>Delete {shapes.length}</button>
        </div>
    {/if}
{/if}

<style>
    .names {
        margin: 0;
        padding-left: 18px;
        font-size: 13px;
    }
    input[type='color'] {
        padding: 2px;
        height: 32px;
    }
</style>
