<script lang="ts">
    import * as act from '../actions';
    import {api} from '../api';
    import {live} from '../live.svelte';
    import {addShapeItems} from '../menus';
    import {ui} from '../ui.svelte';

    const history = $derived(live.state?.history);
    const saveNote = $derived.by(() => {
        const s = live.state;
        if (!s) return '';
        if (s.readonly) return 'read-only';
        return s.configPath ? `auto-saves to ${s.configPath.split(/[\\/]/).pop()}` : 'changes are not saved';
    });

    function pill(protocol: 'sacn' | 'artnet') {
        const st = live.status?.[protocol];
        const label = protocol === 'sacn' ? 'sACN' : 'Art-Net';
        if (!st?.enabled) return {cls: '', title: `${label}: off`};
        if (st.error) return {cls: 'err', title: `${label}: ${st.error}`};
        const active = live.sources.some((s) => s.status === 'active' && s.protocol === protocol && s.lastSeenMs < 3000);
        return {cls: active ? 'live' : 'on', title: `${label}: ${st.detail}${active ? ' (receiving)' : ' (waiting for data)'}`};
    }
    const sacn = $derived(pill('sacn'));
    const artnet = $derived(pill('artnet'));

    function openShapeMenu(e: MouseEvent) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        ui.openMenu(r.left, r.bottom + 6, addShapeItems());
    }

    function rename(e: Event) {
        const name = (e.currentTarget as HTMLInputElement).value.trim();
        if (name && name !== live.state?.rig.name) void api.updateRig({name}).catch(() => undefined);
    }
</script>

<header class="topbar">
    <div class="brand"><span class="logo"></span>node-dmx simulator</div>
    <input
        class="rig-name"
        aria-label="Rig name"
        spellcheck="false"
        value={live.state?.rig.name ?? ''}
        readonly={live.readonly}
        onchange={rename}
        onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
    <div class="pills">
        <span class="pill {sacn.cls}" title={sacn.title}>sACN</span>
        <span class="pill {artnet.cls}" title={artnet.title}>{live.status?.artnet.syncMode ? 'Art-Net · sync' : 'Art-Net'}</span>
    </div>
    <div class="spacer"></div>
    <span class="save-note muted small" title={live.state?.configPath ?? ''}>{saveNote}</span>
    {#if !live.readonly}
        <div class="group">
            <button class="ghost icon" title="Undo {history?.undoLabel ?? ''} ({act.modKey}Z)" disabled={!history?.canUndo} onclick={() => act.undo()}>↶</button>
            <button class="ghost icon" title="Redo {history?.redoLabel ?? ''}" disabled={!history?.canRedo} onclick={() => act.redo()}>↷</button>
        </div>
    {/if}
    <button class="ghost" onclick={() => (ui.helpOpen = true)}>How to connect</button>
    <button
        class="ghost"
        class:pressed={ui.panelOpen}
        aria-pressed={ui.panelOpen}
        title="Show or hide the details panel (I)"
        onclick={() => ui.togglePanel()}
    >
        Details{#if live.unseenWarnings && !ui.panelOpen}<span class="warn-dot" title="New warnings in the log"></span>{/if}
    </button>
    {#if !live.readonly}
        <button class="ghost" title="Lay fixtures out in rows, one row per universe" onclick={() => act.arrange()}>Auto-arrange</button>
        <button class="ghost" title="Add a stage, truss, roof, area or label" onclick={openShapeMenu}>+ Shape</button>
        <button class="primary" onclick={() => act.openAddDialog()}>+ Add fixtures</button>
    {/if}
</header>

<style>
    /* Floats over the canvas. */
    .topbar {
        position: absolute;
        top: 10px;
        left: 10px;
        right: 10px;
        z-index: 30;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px 6px 14px;
        background: rgba(22, 26, 33, 0.9);
        backdrop-filter: blur(10px);
        border: 1px solid var(--line);
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    }
    .brand {
        font-weight: 650;
        display: flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
    }
    .logo {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--accent);
        box-shadow: 0 0 10px var(--accent);
    }
    .rig-name {
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 4px 8px;
        font-weight: 500;
        min-width: 120px;
        max-width: 280px;
    }
    .rig-name:hover:not([readonly]),
    .rig-name:focus {
        border-color: var(--line);
        background: var(--bg);
    }
    .pills {
        display: flex;
        gap: 6px;
    }
    .pill {
        font-size: 12px;
        padding: 2px 9px;
        border-radius: 999px;
        background: var(--panel-2);
        border: 1px solid var(--line);
        color: var(--muted);
        white-space: nowrap;
    }
    .pill::before {
        content: '';
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--muted);
        margin-right: 6px;
        vertical-align: 1px;
    }
    .pill.on::before {
        background: var(--ok);
    }
    .pill.live::before {
        background: var(--ok);
        box-shadow: 0 0 6px var(--ok);
    }
    .pill.err {
        color: var(--err);
    }
    .pill.err::before {
        background: var(--err);
    }
    .spacer {
        flex: 1;
    }
    .group {
        display: flex;
        gap: 2px;
    }
    .pressed {
        background: var(--panel-2);
        border-color: var(--line);
    }
    .warn-dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        margin-left: 6px;
        border-radius: 50%;
        background: var(--warn);
        vertical-align: 1px;
    }
    .icon {
        font-size: 16px;
        line-height: 1;
        padding: 4px 9px;
    }
    .save-note {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }
    @media (max-width: 1150px) {
        .save-note {
            display: none;
        }
    }
    @media (max-width: 900px) {
        .brand {
            display: none;
        }
    }
</style>
