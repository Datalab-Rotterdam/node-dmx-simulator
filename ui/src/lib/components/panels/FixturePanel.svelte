<!-- Inspector: overview when nothing is selected, an editor for one fixture, bulk tools for several. -->
<script lang="ts">
    import * as act from '../../actions';
    import {live} from '../../live.svelte';
    import {selection} from '../../selection.svelte';
    import type {UiFixture} from '../../shared';
    import ConnectHint from '../ConnectHint.svelte';
    import LiveValues from '../LiveValues.svelte';
    import ShapePanel from './ShapePanel.svelte';

    const single = $derived(selection.single);
    const many = $derived(selection.size > 1 ? selection.fixtures : []);
    const types = $derived(live.state?.types ?? {});
    const ro = $derived(live.readonly);

    function edit(f: UiFixture, field: string, raw: string) {
        const numeric = ['universe', 'address', 'cells', 'rotation'].includes(field);
        const value = numeric ? Number(raw) : raw;
        const patch: Record<string, unknown> = {id: f.id, [field]: value};
        if (field === 'type') patch.cells = null; // a new type starts with its own default cell count
        void act.updateFixtures([patch as {id: string}]);
    }

    /** One value if every selected fixture shares it, else undefined ("mixed"). */
    function common<T>(list: UiFixture[], pick: (f: UiFixture) => T): T | undefined {
        const first = pick(list[0]!);
        return list.every((f) => pick(f) === first) ? first : undefined;
    }

    function editMany(field: 'type' | 'universe', raw: string) {
        if (!raw) return;
        const value = field === 'universe' ? Number(raw) : raw;
        void act.updateFixtures(many.map((f) => (field === 'type' ? {id: f.id, type: String(value), cells: null} : {id: f.id, universe: Number(value)})));
    }

    const range = (f: UiFixture) => (f.layout.footprint === 1 ? `${f.address}` : `${f.address}-${f.address + f.layout.footprint - 1}`);
</script>

{#if selection.shapeCount > 0 && selection.size === 0}
    <ShapePanel />
{:else if single}
    {@const f = single}
    {@const linear = f.shape === 'bar' || f.shape === 'strip'}
    <h3>{f.name}</h3>
    {#if f.issues.length}
        <div class="issues"><b>Patch problem</b><ul>{#each f.issues as issue (issue)}<li>{issue}</li>{/each}</ul></div>
    {/if}
    {#key f.id}
        <div class="grid2">
            <label class="full">Name <input value={f.name} disabled={ro} onchange={(e) => edit(f, 'name', e.currentTarget.value)} /></label>
            <label class="full">Type
                <select value={f.type} disabled={ro} onchange={(e) => edit(f, 'type', e.currentTarget.value)}>
                    {#each Object.entries(types) as [key, t] (key)}<option value={key}>{t.name}</option>{/each}
                </select>
            </label>
            <label>Universe <input type="number" min="1" max="63999" value={f.universe} disabled={ro} onchange={(e) => edit(f, 'universe', e.currentTarget.value)} /></label>
            <label>Start address <input type="number" min="1" max="512" value={f.address} disabled={ro} onchange={(e) => edit(f, 'address', e.currentTarget.value)} /></label>
            {#if f.layout.cell.length}
                <label>Cells / pixels <input type="number" min="1" max="512" value={f.layout.cells} disabled={ro} onchange={(e) => edit(f, 'cells', e.currentTarget.value)} /></label>
            {/if}
            <label>Size (%)
                <input type="number" min="25" max="800" step="25" value={Math.round((f.scale ?? 1) * 100)} disabled={ro}
                    onchange={(e) => Number(e.currentTarget.value) > 0 && act.resize(Number(e.currentTarget.value) / 100, [f.id])} />
            </label>
            {#if linear}
                <label>Rotation
                    <select value={f.rotation ?? 0} disabled={ro} onchange={(e) => edit(f, 'rotation', e.currentTarget.value)}>
                        {#each [0, 45, 90, 135, 180, 270] as deg (deg)}<option value={deg}>{deg}°</option>{/each}
                    </select>
                </label>
            {/if}
        </div>
    {/key}
    <dl class="kv">
        <dt>Channels</dt><dd class="mono">{range(f)} ({f.layout.footprint} ch)</dd>
        <dt>RDM UID</dt><dd class="mono">{f.rdm === false ? 'RDM off' : (f.uid ?? '-')}</dd>
        <dt>Art-Net</dt><dd class="mono">Port-Address {f.universe - 1}{f.universe > 32768 ? ' (out of range)' : ''}</dd>
    </dl>
    {#if types[f.type]?.description}<p class="muted small">{types[f.type]?.description}</p>{/if}

    <h4>Live values</h4>
    <LiveValues fixture={f} />

    {#if !ro}
        <div class="actions">
            <label class="check"><input type="checkbox" checked={f.rdm !== false} onchange={(e) => act.setRdm(e.currentTarget.checked, [f.id])} /> Answer RDM</label>
            <span class="spacer"></span>
            <button onclick={() => act.duplicate([f.id])}>Duplicate</button>
            <button class="danger" onclick={() => act.deleteFixtures([f.id])}>Delete</button>
        </div>
    {/if}
{:else if many.length}
    {@const universe = common(many, (f) => f.universe)}
    {@const type = common(many, (f) => f.type)}
    {@const rdm = common(many, (f) => f.rdm !== false)}
    {@const size = common(many, (f) => Math.round((f.scale ?? 1) * 100))}
    <h3>{many.length} fixtures selected{selection.shapeCount ? ` (and ${selection.shapeCount} shape${selection.shapeCount === 1 ? '' : 's'})` : ''}</h3>
    <ul class="chips">
        {#each many as f (f.id)}
            <li><button class="chip" title="Select only this one" onclick={() => selection.only(f.id)}>{f.name} <span class="mono muted">U{f.universe}·{range(f)}</span></button></li>
        {/each}
    </ul>

    {#if !ro}
        <h4>Patch</h4>
        <div class="grid2">
            <label>Universe
                <input type="number" min="1" max="63999" placeholder="mixed" value={universe ?? ''} onchange={(e) => editMany('universe', e.currentTarget.value)} />
            </label>
            <label>Type
                <select value={type ?? ''} onchange={(e) => editMany('type', e.currentTarget.value)}>
                    {#if type === undefined}<option value="" disabled>mixed</option>{/if}
                    {#each Object.entries(types) as [key, t] (key)}<option value={key}>{t.name}</option>{/each}
                </select>
            </label>
        </div>
        <div class="actions">
            <button class="primary" onclick={() => act.openReaddress()}>Readdress in sequence…</button>
            <label class="check">
                <input type="checkbox" checked={rdm ?? false} indeterminate={rdm === undefined} onchange={(e) => act.setRdm(e.currentTarget.checked)} /> Answer RDM
            </label>
        </div>

        <h4>Arrange</h4>
        <div class="toolbar" role="group" aria-label="Align">
            <button title="Align left edges" onclick={() => act.alignSelection('left')}>⇤</button>
            <button title="Align horizontal centres" onclick={() => act.alignSelection('hcenter')}>↔</button>
            <button title="Align right edges" onclick={() => act.alignSelection('right')}>⇥</button>
            <button title="Align top edges" onclick={() => act.alignSelection('top')}>⤒</button>
            <button title="Align vertical centres" onclick={() => act.alignSelection('vcenter')}>↕</button>
            <button title="Align bottom edges" onclick={() => act.alignSelection('bottom')}>⤓</button>
        </div>
        <div class="toolbar">
            <button disabled={many.length < 3} onclick={() => act.distributeSelection('x')}>Distribute horizontally</button>
            <button disabled={many.length < 3} onclick={() => act.distributeSelection('y')}>Distribute vertically</button>
        </div>
        <div class="toolbar">
            <button onclick={() => act.arrange(selection.list)}>Arrange in rows</button>
            <label class="size">Size (%)
                <input type="number" min="25" max="800" step="25" placeholder="mixed" value={size ?? ''}
                    onchange={(e) => Number(e.currentTarget.value) > 0 && act.resize(Number(e.currentTarget.value) / 100)} />
            </label>
        </div>

        <div class="actions">
            <span class="spacer"></span>
            <button onclick={() => act.duplicateSelection()}>Duplicate all</button>
            <button class="danger" onclick={() => act.deleteSelection()}>Delete {many.length + selection.shapeCount}</button>
        </div>
    {/if}
{:else if live.state}
    {@const n = live.fixtures.length}
    <h3>{live.state.rig.name}</h3>
    <p class="muted">
        {n} fixture{n === 1 ? '' : 's'} on universe {live.state.universes.join(', ') || '-'}.
        Click a fixture to see its channels{ro ? '' : ' and change its patch'}.
        {#if !ro}Drag on empty stage to select several, then right-click for align, readdress and more.{/if}
    </p>
    {#if !live.hasActiveSources}<ConnectHint />{/if}
    {#if !ro}
        <h4>Shortcuts</h4>
        <dl class="kv small">
            <dt>{act.modKey}A</dt><dd>Select all</dd>
            <dt>{act.modKey}D</dt><dd>Duplicate</dd>
            <dt>⌫ / Del</dt><dd>Delete selection</dd>
            <dt>Arrows</dt><dd>Nudge (Shift: further)</dd>
            <dt>{act.modKey}Z</dt><dd>Undo ({act.isMac ? '⇧⌘Z' : 'Ctrl+Y'} redo)</dd>
            <dt>Alt + drag</dt><dd>Move without snapping</dd>
            <dt>I</dt><dd>Show or hide this panel</dd>
            <dt>[ / ]</dt><dd>Make the selected fixtures smaller / bigger</dd>
            <dt>Scroll</dt><dd>Pan ({act.modKey.replace('+', '')} + scroll or pinch: zoom)</dd>
            <dt>Space + drag</dt><dd>Pan</dd>
            <dt>+ / − / 0 / 1</dt><dd>Zoom in / out / fit / 100%</dd>
            <dt>Esc</dt><dd>Clear selection, then close this panel</dd>
        </dl>
    {/if}
{/if}

<style>
    .size {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
        font-size: 12px;
        color: var(--muted);
    }
    .size input {
        width: 72px;
    }
    .chips {
        list-style: none;
        padding: 0;
        margin: 0 0 6px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        max-height: 150px;
        overflow: auto;
    }
    .chip {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 999px;
    }
    .toolbar {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-bottom: 6px;
    }
    .toolbar button {
        min-width: 34px;
    }
</style>
