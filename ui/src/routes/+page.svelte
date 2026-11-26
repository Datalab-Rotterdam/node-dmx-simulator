<!--
  The main screen. Panels, dialogs and menus are components in src/lib/components;
  their state lives in src/lib/*.svelte.ts so any component can open or change them.
-->
<script lang="ts">
    import ContextMenu from '../lib/components/ContextMenu.svelte';
    import DetailsPanel from '../lib/components/DetailsPanel.svelte';
    import AddFixturesDialog from '../lib/components/dialogs/AddFixturesDialog.svelte';
    import HelpDialog from '../lib/components/dialogs/HelpDialog.svelte';
    import ReaddressDialog from '../lib/components/dialogs/ReaddressDialog.svelte';
    import Stage from '../lib/components/Stage.svelte';
    import Toast from '../lib/components/Toast.svelte';
    import TopBar from '../lib/components/TopBar.svelte';
    import ZoomControls from '../lib/components/ZoomControls.svelte';
    import {live} from '../lib/live.svelte';
    import {selection} from '../lib/selection.svelte';
    import {handleKeydown} from '../lib/shortcuts';

    // Forget selected fixtures that were deleted (here, by undo, or by loading a rig).
    $effect(() => {
        void live.state;
        selection.prune();
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- The canvas fills the page; everything else floats over it. -->
<div class="app" class:readonly={live.readonly}>
    {#if live.state}
        <Stage />
        <ZoomControls />
        <DetailsPanel />
    {:else}
        <p class="loading muted">{live.connected ? 'Loading…' : 'Connecting to the simulator…'}</p>
    {/if}
    {#if live.state && !live.connected}
        <div class="offline">Lost connection to the simulator. Reconnecting…</div>
    {/if}
    <TopBar />
</div>

<ContextMenu />
<AddFixturesDialog />
<ReaddressDialog />
<HelpDialog />
<Toast />

<style>
    .app {
        position: fixed;
        inset: 0;
        overflow: hidden;
    }
    .loading {
        text-align: center;
        margin-top: 30vh;
    }
    .offline {
        position: fixed;
        top: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: #3b2a0b;
        color: #fde68a;
        border: 1px solid #7c5a10;
        border-radius: 8px;
        padding: 6px 14px;
        font-size: 13px;
        z-index: 150;
    }
</style>
