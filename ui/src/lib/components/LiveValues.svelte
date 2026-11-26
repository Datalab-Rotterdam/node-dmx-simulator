<!-- Table of a fixture's channels with their current values. -->
<script lang="ts">
    import {live} from '../live.svelte';
    import {channelRoleAt, type UiFixture} from '../shared';

    let {fixture: f, maxCells = 16}: {fixture: UiFixture; maxCells?: number} = $props();

    const frame = $derived(live.frame(f.universe));
    const shownCells = $derived(Math.min(f.layout.cells, maxCells));
    const rows = $derived.by(() => {
        const count = f.layout.channels.length + shownCells * f.layout.cell.length;
        return Array.from({length: count}, (_, offset) => {
            const role = channelRoleAt(f.layout, offset)!;
            return {
                channel: f.address + offset,
                name: role.cell ? `${role.role} [${role.cell}]` : role.role,
                value: frame[f.address - 1 + offset] ?? 0,
            };
        });
    });
</script>

<table class="values">
    <tbody>
        {#each rows as row (row.channel)}
            <tr>
                <td class="ch">{row.channel}</td>
                <td>{row.name}</td>
                <td class="v">{row.value}</td>
                <td class="bar"><div class="meter"><i style:width="{(row.value / 255) * 100}%"></i></div></td>
            </tr>
        {/each}
        {#if f.layout.cells > shownCells}
            <tr><td></td><td colspan="3" class="muted">… {f.layout.cells - shownCells} more cells (see the Universe tab)</td></tr>
        {/if}
    </tbody>
</table>

<style>
    .values {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
    }
    td {
        padding: 3px 4px;
        border-bottom: 1px solid var(--line);
    }
    .ch {
        color: var(--muted);
        width: 44px;
        font-family: var(--mono);
    }
    .v {
        width: 40px;
        text-align: right;
        font-family: var(--mono);
    }
    .bar {
        width: 70px;
    }
    .meter {
        height: 6px;
        background: var(--bg);
        border-radius: 3px;
        overflow: hidden;
    }
    .meter i {
        display: block;
        height: 100%;
        background: var(--accent);
    }
</style>
