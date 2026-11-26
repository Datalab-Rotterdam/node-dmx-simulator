<!-- Programs sending DMX to the simulator. -->
<script lang="ts">
    import {live} from '../../live.svelte';
    import ConnectHint from '../ConnectHint.svelte';

    const ago = (ms: number) => (ms < 1500 ? 'now' : ms < 60_000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60_000)} min ago`);
</script>

<h3>Sources</h3>
{#each live.sources as s (s.key)}
    <div class="source" class:lost={s.status === 'lost'}>
        <div class="title">
            <span class="dot"></span>
            <b>{s.name}</b>
            <span class="muted small">{s.protocol === 'sacn' ? 'sACN' : 'Art-Net'}</span>
        </div>
        <dl class="kv small">
            {#if s.address}<dt>From</dt><dd class="mono">{s.address}</dd>{/if}
            {#if s.protocol === 'sacn'}<dt>CID</dt><dd class="mono cid">{s.id}</dd>{/if}
            <dt>Universes</dt><dd>{s.universes.join(', ') || '-'}{s.announced?.length ? ` (announces ${s.announced.join(', ')})` : ''}</dd>
            {#if s.priority !== undefined}<dt>Priority</dt><dd>{s.priority}</dd>{/if}
            {#if s.syncUniverse}<dt>Sync</dt><dd>universe {s.syncUniverse}</dd>{/if}
            {#if s.preview}<dt>Preview</dt><dd>yes (ignored)</dd>{/if}
            <dt>Rate</dt><dd>{s.packetsPerSecond.toFixed(1)} packets/s · {s.totalPackets} total</dd>
            <dt>Last seen</dt><dd>{ago(s.lastSeenMs)}{s.status === 'lost' ? ` · lost: ${s.lostReason ?? 'timeout'}` : ''}</dd>
        </dl>
    </div>
{:else}
    <p class="muted">Nothing is sending DMX yet.</p>
    <ConnectHint />
{/each}

<style>
    .source {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 8px;
        background: var(--panel-2);
    }
    .title {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 6px var(--ok);
    }
    .lost {
        opacity: 0.6;
    }
    .lost .dot {
        background: var(--muted);
        box-shadow: none;
    }
    .cid {
        word-break: break-all;
    }
</style>
