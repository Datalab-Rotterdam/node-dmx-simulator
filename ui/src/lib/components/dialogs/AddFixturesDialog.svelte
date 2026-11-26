<script lang="ts">
    import * as act from '../../actions';
    import {live} from '../../live.svelte';
    import {resolveLayout} from '../../shared';
    import {ui} from '../../ui.svelte';
    import Dialog from '../Dialog.svelte';

    let type = $state('rgb');
    let count = $state(4);
    let universe = $state(1);
    let address = $state<number | null>(null);
    let name = $state('');
    let cells = $state<number | null>(null);
    let layout = $state<'row' | 'column' | 'grid'>('row');

    const types = $derived(live.state?.types ?? {});
    const def = $derived(types[type]);
    const hasCells = $derived(!!def?.cell?.length);

    // Fill in sensible defaults each time the dialog opens.
    $effect(() => {
        if (!ui.addDialog.open) return;
        universe = ui.addDialog.universe ?? 1;
        address = null;
        name = '';
        cells = null;
    });

    /** "RGB Par (3ch)" already says how many channels; add the count only for names that don't. */
    const typeLabel = (t: {name: string; footprint: number; custom: boolean}) =>
        (/\d+\s*ch\b/.test(t.name) ? t.name : `${t.name} (${t.footprint} ch)`) + (t.custom ? ' · custom' : '');

    function nextFree(u: number): number {
        const ends = live.fixtures.filter((f) => f.universe === u).map((f) => f.address + f.layout.footprint);
        return ends.length ? Math.max(...ends) : 1;
    }

    /** Where the new fixtures land, mirroring the server's rollover to the next universe. */
    const preview = $derived.by(() => {
        if (!def) return null;
        const footprint = resolveLayout(def, hasCells ? (cells ?? undefined) : undefined).footprint;
        if (footprint > 512) return {error: `One fixture would use ${footprint} channels; a universe has 512.`};
        let u = universe || 1;
        let a = address ?? nextFree(u);
        const first = {u, a};
        for (let i = 1; i < count; i++) {
            a += footprint;
            if (a - 1 + footprint > 512) {
                u++;
                a = nextFree(u);
            }
        }
        if (count === 1 && first.a - 1 + footprint > 512) return {error: `Doesn't fit: channels ${first.a}-${first.a + footprint - 1} go past 512.`};
        const span = first.u === u ? `universe ${u}, channels ${first.a}-${a + footprint - 1}` : `universe ${first.u} ch ${first.a} to universe ${u} ch ${a + footprint - 1}`;
        return {text: `${footprint} channel${footprint === 1 ? '' : 's'} each · ${span}`};
    });

    async function submit() {
        await act.addFixtures({
            type,
            count,
            universe,
            address: address ?? undefined,
            name: name.trim() || undefined,
            cells: hasCells ? (cells ?? undefined) : undefined,
            x: ui.addDialog.x,
            y: ui.addDialog.y,
            layout,
        });
    }
</script>

<Dialog bind:open={ui.addDialog.open} title="Add fixtures" onsubmit={submit}>
    <div class="grid2">
        <label class="full">Type
            <select bind:value={type}>
                {#each Object.entries(types) as [key, t] (key)}
                    <option value={key}>{typeLabel(t)}</option>
                {/each}
            </select>
        </label>
        {#if def?.description}<p class="full muted small desc">{def.description}</p>{/if}
        <label>How many <input type="number" min="1" max="512" required bind:value={count} /></label>
        <label>Name <input placeholder={def?.name.replace(/\s*\(.*\)$/, '')} bind:value={name} /></label>
        <label>Universe <input type="number" min="1" max="63999" required bind:value={universe} /></label>
        <label>Start address <input type="number" min="1" max="512" placeholder="next free" bind:value={address} /></label>
        {#if hasCells}
            <label>Cells / pixels <input type="number" min="1" max="512" placeholder={String(def?.cells ?? '')} bind:value={cells} /></label>
        {/if}
        <label>Layout
            <select bind:value={layout}>
                <option value="row">Row</option>
                <option value="column">Column</option>
                <option value="grid">Grid</option>
            </select>
        </label>
    </div>
    {#if preview}
        <p class="preview" class:err={'error' in preview}>{'error' in preview ? preview.error : preview.text}</p>
    {/if}
    {#if ui.addDialog.x !== undefined}<p class="muted small">Placed where you right-clicked.</p>{/if}
    {#snippet actions()}
        <button type="button" onclick={() => (ui.addDialog.open = false)}>Cancel</button>
        <button type="submit" class="primary" disabled={!preview || 'error' in preview}>Add {count > 1 ? count : ''}</button>
    {/snippet}
</Dialog>

<style>
    .desc {
        margin: -4px 0 0;
    }
    .preview {
        margin: 12px 0 0;
        font-size: 13px;
        padding: 8px 10px;
        background: var(--panel-2);
        border-radius: 6px;
    }
    .preview.err {
        color: var(--err);
    }
</style>
