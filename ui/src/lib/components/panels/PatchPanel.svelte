<!-- Patch list (multi-select like a file list), rig settings and bundled rigs. -->
<script lang="ts">
    import * as act from '../../actions';
    import {api} from '../../api';
    import {fixtureHue} from '../../color';
    import {live} from '../../live.svelte';
    import {fixtureMenu} from '../../menus';
    import {selection} from '../../selection.svelte';
    import type {UiFixture} from '../../shared';
    import {ui} from '../../ui.svelte';

    const sorted = $derived([...live.fixtures].sort((a, b) => a.universe - b.universe || a.address - b.address));
    const order = $derived(sorted.map((f) => f.id));
    /** Colour per fixture, by rig order (same as the Universe tab). */
    const hues = $derived(new Map(live.fixtures.map((f, i) => [f.id, fixtureHue(i)])));
    const ro = $derived(live.readonly);
    let rigToLoad = $state('');

    function onRowClick(e: MouseEvent, f: UiFixture) {
        if (e.shiftKey) selection.range(f.id, order);
        else if (act.isMac ? e.metaKey : e.ctrlKey) selection.toggle(f.id);
        else selection.only(f.id);
    }

    function onRowMenu(e: MouseEvent, f: UiFixture) {
        e.preventDefault();
        if (!selection.has(f.id)) selection.only(f.id);
        ui.openMenu(e.clientX, e.clientY, fixtureMenu(f.id));
    }

    function setMonitor(raw: string) {
        const universes = raw.split(/[\s,]+/).filter(Boolean).map(Number);
        if (universes.every((u) => Number.isInteger(u) && u >= 1)) void api.updateRig({monitorUniverses: universes}).catch(() => undefined);
        else ui.showToast('Monitor universes: a list of universe numbers, e.g. "1, 2, 5"');
    }

    async function loadRig() {
        if (!rigToLoad) return;
        await api.loadRig(rigToLoad).catch(() => undefined);
        selection.clear();
        ui.showToast(`Loaded "${rigToLoad}". ${act.modKey}Z brings your rig back.`, true);
        rigToLoad = '';
    }

    const end = (f: UiFixture) => f.address + f.layout.footprint - 1;
</script>

<h3>Patch</h3>
<p class="muted small">Click to select, Shift-click for a range, {act.modKey.replace('+', '')}-click to add. Right-click for more.</p>
<table class="patch">
    <thead><tr><th>Name</th><th>Type</th><th>U</th><th>Ch</th></tr></thead>
    <tbody>
        {#each sorted as f (f.id)}
            <tr
                class:selected={selection.has(f.id)}
                class:issue={f.issues.length > 0}
                title={f.issues.join('\n')}
                onclick={(e) => onRowClick(e, f)}
                oncontextmenu={(e) => onRowMenu(e, f)}
            >
                <td><span class="swatch" style:background={hues.get(f.id)}></span>{f.name}</td>
                <td class="muted">{f.typeName}</td>
                <td class="mono">{f.universe}</td>
                <td class="mono">{f.address}{f.layout.footprint > 1 ? `-${end(f)}` : ''}</td>
            </tr>
        {:else}
            <tr><td colspan="4" class="muted">No fixtures.</td></tr>
        {/each}
    </tbody>
</table>

{#if live.state && !ro}
    {@const rig = live.state.rig}
    <h4>Listening</h4>
    <div class="grid2">
        <label class="full">Also listen to universes
            <input placeholder="e.g. 3, 4" value={rig.monitorUniverses.join(', ')} onchange={(e) => setMonitor(e.currentTarget.value)} />
        </label>
    </div>

    <h4>Start from a bundled rig</h4>
    <div class="actions">
        <select bind:value={rigToLoad} aria-label="Bundled rig">
            <option value="" disabled>Choose a rig…</option>
            {#each live.state.bundledRigs as name (name)}<option value={name}>{name}</option>{/each}
        </select>
        <button disabled={!rigToLoad} onclick={loadRig}>Load</button>
    </div>
    <p class="muted small">Replaces the fixtures on stage. You can undo it.</p>
{/if}

<style>
    .patch {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
        user-select: none;
    }
    th {
        text-align: left;
        color: var(--muted);
        font-weight: 500;
        padding: 4px;
        border-bottom: 1px solid var(--line);
    }
    td {
        padding: 4px;
        border-bottom: 1px solid var(--line);
        white-space: nowrap;
    }
    tbody tr {
        cursor: default;
    }
    tbody tr:hover {
        background: var(--panel-2);
    }
    tr.selected,
    tr.selected:hover {
        background: rgba(96, 165, 250, 0.18);
    }
    tr.issue td:first-child {
        color: var(--err);
    }
    .swatch {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 2px;
        margin-right: 6px;
    }
</style>
