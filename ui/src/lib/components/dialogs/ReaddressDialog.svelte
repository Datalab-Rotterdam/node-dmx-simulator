<!-- Patch the selected fixtures one after another from a start address. -->
<script lang="ts">
    import * as act from '../../actions';
    import {stageOrder} from '../../geometry';
    import {live} from '../../live.svelte';
    import type {UiFixture} from '../../shared';
    import {ui} from '../../ui.svelte';
    import Dialog from '../Dialog.svelte';

    type Order = 'stage' | 'address' | 'name';

    let universe = $state(1);
    let address = $state(1);
    let order = $state<Order>('stage');

    const fixtures = $derived(ui.readdressDialog.ids.map((id) => live.fixture(id)).filter((f): f is UiFixture => !!f));

    $effect(() => {
        if (!ui.readdressDialog.open) return;
        const first = live.fixture(ui.readdressDialog.ids[0] ?? '');
        universe = first?.universe ?? 1;
        address = first ? Math.min(...ui.readdressDialog.ids.map((id) => live.fixture(id)).filter((f) => f?.universe === first.universe).map((f) => f!.address)) : 1;
    });

    const ordered = $derived.by(() => {
        if (order === 'stage') return stageOrder(fixtures);
        if (order === 'address') return [...fixtures].sort((a, b) => a.universe - b.universe || a.address - b.address);
        return [...fixtures].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    });

    /** Same rule as the server: a fixture that doesn't fit moves to channel 1 of the next universe. */
    const plan = $derived.by(() => {
        let u = universe || 1;
        let a = address || 1;
        return ordered.map((f) => {
            const n = f.layout.footprint;
            if (a - 1 + n > 512) {
                u++;
                a = 1;
            }
            const row = {f, universe: u, address: a, end: a + n - 1};
            a += n;
            return row;
        });
    });

    /** Fixtures not being readdressed that the new patch would overlap. */
    const clashes = $derived.by(() => {
        const moving = new Set(fixtures.map((f) => f.id));
        const others = live.fixtures.filter((f) => !moving.has(f.id));
        const hit = new Set<string>();
        for (const p of plan) {
            for (const o of others) {
                if (o.universe === p.universe && o.address <= p.end && p.address <= o.address + o.layout.footprint - 1) hit.add(o.name);
            }
        }
        return [...hit];
    });

    async function submit() {
        return act.readdress(ordered.map((f) => f.id), universe, address);
    }
</script>

<Dialog bind:open={ui.readdressDialog.open} title="Readdress {fixtures.length} fixture{fixtures.length === 1 ? '' : 's'}" onsubmit={submit}>
    <div class="grid2">
        <label>Universe <input type="number" min="1" max="63999" required bind:value={universe} /></label>
        <label>Start address <input type="number" min="1" max="512" required bind:value={address} /></label>
        <label class="full">Order
            <select bind:value={order}>
                <option value="stage">Stage position (left to right, top to bottom)</option>
                <option value="address">Current address</option>
                <option value="name">Name</option>
            </select>
        </label>
    </div>
    <div class="plan">
        <table>
            <tbody>
                {#each plan as p (p.f.id)}
                    {@const changed = p.universe !== p.f.universe || p.address !== p.f.address}
                    <tr class:same={!changed}>
                        <td>{p.f.name}</td>
                        <td class="mono muted">U{p.f.universe} · {p.f.address}</td>
                        <td class="arrow">→</td>
                        <td class="mono">U{p.universe} · {p.address}{p.end > p.address ? `-${p.end}` : ''}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
    {#if clashes.length}
        <p class="warn small">Overlaps {clashes.length > 3 ? `${clashes.slice(0, 3).join(', ')} and ${clashes.length - 3} more` : clashes.join(', ')}. You can still apply it; the overlap is marked on stage.</p>
    {/if}
    {#snippet actions()}
        <button type="button" onclick={() => (ui.readdressDialog.open = false)}>Cancel</button>
        <button type="submit" class="primary">Apply</button>
    {/snippet}
</Dialog>

<style>
    .plan {
        margin-top: 12px;
        max-height: 280px;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 6px;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
    }
    td {
        padding: 4px 8px;
        border-bottom: 1px solid var(--line);
        white-space: nowrap;
    }
    tr.same {
        opacity: 0.55;
    }
    .arrow {
        color: var(--muted);
        width: 14px;
    }
    .warn {
        color: var(--warn);
        margin: 10px 0 0;
    }
</style>
