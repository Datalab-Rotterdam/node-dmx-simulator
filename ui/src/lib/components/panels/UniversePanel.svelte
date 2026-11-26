<!-- All 512 channels of one universe, coloured by the fixture that uses them. Click a channel to select its fixture. -->
<script lang="ts">
    import * as act from '../../actions';
    import {fixtureHue} from '../../color';
    import {live} from '../../live.svelte';
    import {fixtureMenu} from '../../menus';
    import {selection} from '../../selection.svelte';
    import {channelRoleAt, type UiFixture} from '../../shared';
    import {ui} from '../../ui.svelte';

    const universes = $derived(live.knownUniverses.length ? live.knownUniverses : [1]);
    const frame = $derived(live.frame(ui.universe));

    /** Fixture (with its colour) using each channel; later fixtures win on overlaps. */
    const owners = $derived.by(() => {
        const out: Array<{fixture: UiFixture; hue: string; overlap: boolean} | undefined> = new Array(512);
        live.fixtures.forEach((f, i) => {
            if (f.universe !== ui.universe) return;
            for (let c = f.address - 1; c < Math.min(512, f.address - 1 + f.layout.footprint); c++) {
                out[c] = {fixture: f, hue: fixtureHue(i), overlap: !!out[c]};
            }
        });
        return out;
    });

    const used = $derived(owners.filter(Boolean).length);

    function title(c: number): string {
        const o = owners[c];
        if (!o) return `Channel ${c + 1}: ${frame[c]} (unpatched)`;
        const role = channelRoleAt(o.fixture.layout, c - (o.fixture.address - 1));
        const name = role ? (role.cell ? `${role.role} [${role.cell}]` : role.role) : '';
        return `Channel ${c + 1}: ${frame[c]}\n${o.fixture.name} · ${name}${o.overlap ? '\n⚠ overlaps another fixture' : ''}`;
    }

    function onClick(e: MouseEvent, c: number) {
        const f = owners[c]?.fixture;
        if (!f) return;
        if (e.shiftKey || (act.isMac ? e.metaKey : e.ctrlKey)) selection.toggle(f.id);
        else selection.only(f.id);
    }

    function onMenu(e: MouseEvent, c: number) {
        const f = owners[c]?.fixture;
        if (!f) return;
        e.preventDefault();
        if (!selection.has(f.id)) selection.only(f.id);
        ui.openMenu(e.clientX, e.clientY, fixtureMenu(f.id));
    }
</script>

<div class="head">
    <h3>Universe</h3>
    <select bind:value={ui.universe} aria-label="Universe">
        {#each universes as u (u)}<option value={u}>{u}</option>{/each}
        {#if !universes.includes(ui.universe)}<option value={ui.universe}>{ui.universe}</option>{/if}
    </select>
    <span class="muted small">{used} / 512 patched</span>
</div>
<p class="muted small ids">
    Art-Net Port-Address <span class="mono">{ui.universe - 1}</span>{ui.universe > 32768 ? ' (out of range)' : ''} ·
    sACN multicast <span class="mono">239.255.{ui.universe >> 8}.{ui.universe & 255}</span>
</p>

<div class="grid" role="grid" aria-label="Channels of universe {ui.universe}">
    {#each frame as value, c (c)}
        {@const o = owners[c]}
        <div
            class="ch"
            class:patched={!!o}
            class:selected={o && selection.has(o.fixture.id)}
            class:overlap={o?.overlap}
            style:--owner={o?.hue}
            style:--v={value / 255}
            title={title(c)}
            role="gridcell"
            tabindex="-1"
            onclick={(e) => onClick(e, c)}
            oncontextmenu={(e) => onMenu(e, c)}
            onkeydown={() => {}}
        >
            <span class="n">{c + 1}</span><span class="v">{value}</span>
        </div>
    {/each}
</div>

<style>
    .head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
    }
    .head h3 {
        margin: 0;
    }
    .ids {
        margin: -4px 0 10px;
    }
    .grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 2px;
        user-select: none;
    }
    .ch {
        position: relative;
        padding: 2px 3px;
        border-radius: 3px;
        background: var(--panel-2);
        font-family: var(--mono);
        font-size: 10.5px;
        line-height: 1.2;
        display: flex;
        justify-content: space-between;
        overflow: hidden;
        cursor: default;
        border-left: 3px solid transparent;
    }
    .ch::before {
        content: '';
        position: absolute;
        inset: 0;
        background: var(--accent);
        opacity: calc(var(--v) * 0.45);
        pointer-events: none;
    }
    .ch.patched {
        border-left-color: var(--owner);
        cursor: pointer;
    }
    .ch.selected {
        outline: 1px solid var(--sel);
        background: rgba(96, 165, 250, 0.16);
    }
    .ch.overlap {
        border-left-color: var(--err);
    }
    .n {
        color: var(--muted);
        position: relative;
    }
    .v {
        position: relative;
    }
</style>
