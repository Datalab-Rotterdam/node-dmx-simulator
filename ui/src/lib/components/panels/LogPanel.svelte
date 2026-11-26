<script lang="ts">
    import {live} from '../../live.svelte';

    let onlyProblems = $state(false);
    const entries = $derived((onlyProblems ? live.log.filter((e) => e.level !== 'info') : live.log).toReversed());
    const time = (t: number) => new Date(t).toLocaleTimeString([], {hour12: false});
</script>

<div class="head">
    <h3>Log</h3>
    <label class="check small"><input type="checkbox" bind:checked={onlyProblems} /> Only warnings and errors</label>
</div>
<ol class="log">
    {#each entries as e, i (entries.length - i)}
        <li class={e.level}><span class="t mono">{time(e.time)}</span>{e.message}</li>
    {:else}
        <li class="muted">Nothing logged yet.</li>
    {/each}
</ol>

<style>
    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    .log {
        list-style: none;
        padding: 0;
        margin: 0;
        font-size: 12.5px;
    }
    li {
        padding: 4px 0;
        border-bottom: 1px solid var(--line);
        overflow-wrap: anywhere;
    }
    .t {
        color: var(--muted);
        margin-right: 8px;
        font-size: 11px;
    }
    .warn {
        color: var(--warn);
    }
    .error {
        color: var(--err);
    }
</style>
