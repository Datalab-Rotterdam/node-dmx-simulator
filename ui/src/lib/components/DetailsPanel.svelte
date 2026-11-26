<!--
  Floating details panel over the stage. It follows the selection:
  - selecting fixtures opens it on the Fixture tab
  - clearing the selection closes it again (if it was showing the Fixture tab)
  - Patch and Universe stay open while you select, since they highlight the selection
  It can also be opened by hand: the Details button, the I key, or a context menu.

  To add a tab: add its id to Tab in ui.svelte.ts, an entry in TABS, and render it below.
-->
<script lang="ts">
    import {untrack} from 'svelte';
    import {fly} from 'svelte/transition';

    import {live} from '../live.svelte';
    import {selection} from '../selection.svelte';
    import {ui, type Tab} from '../ui.svelte';
    import FixturePanel from './panels/FixturePanel.svelte';
    import LogPanel from './panels/LogPanel.svelte';
    import PatchPanel from './panels/PatchPanel.svelte';
    import SourcesPanel from './panels/SourcesPanel.svelte';
    import UniversePanel from './panels/UniversePanel.svelte';

    const activeSources = $derived(live.sources.filter((s) => s.status === 'active').length);

    const TABS: Array<{id: Tab; label: string; badge?: () => string}> = [
        {id: 'fixture', label: 'Selection', badge: () => (selection.size + selection.shapeCount > 1 ? String(selection.size + selection.shapeCount) : '')},
        {id: 'patch', label: 'Patch'},
        {id: 'universe', label: 'Universe'},
        {id: 'sources', label: 'Sources', badge: () => (activeSources ? String(activeSources) : '')},
        {id: 'log', label: 'Log', badge: () => (live.unseenWarnings ? `(${live.unseenWarnings})` : '')},
    ];

    /** Tabs that show the selection themselves; selecting fixtures doesn't switch away from them. */
    const SHOWS_SELECTION: Tab[] = ['fixture', 'patch', 'universe'];

    // Follow the selection.
    let before = new Set<string>();
    $effect(() => {
        const now = new Set([...selection.ids, ...[...selection.shapeIds].map((id) => `shape:${id}`)]);
        untrack(() => {
            const changed = now.size !== before.size || [...now].some((id) => !before.has(id));
            if (changed && now.size > 0) {
                if (!ui.panelOpen || !SHOWS_SELECTION.includes(ui.tab)) ui.show('fixture');
            } else if (changed && now.size === 0 && ui.tab === 'fixture') {
                ui.panelOpen = false;
            }
            before = now;
        });
    });

    $effect(() => {
        live.logOpen = ui.panelOpen && ui.tab === 'log';
        if (live.logOpen) live.unseenWarnings = 0;
    });
</script>

{#if ui.panelOpen}
    <aside class="details" aria-label="Details" transition:fly={{x: 24, duration: 160}}>
        <header>
            <div class="tabs" role="tablist">
                {#each TABS as tab (tab.id)}
                    <button role="tab" aria-selected={ui.tab === tab.id} class:active={ui.tab === tab.id} onclick={() => (ui.tab = tab.id)}>
                        {tab.label}
                        {#if tab.badge?.()}<span class="count">{tab.badge()}</span>{/if}
                    </button>
                {/each}
            </div>
            <button class="close ghost" title="Close (Esc)" aria-label="Close details" onclick={() => (ui.panelOpen = false)}>×</button>
        </header>
        <div class="body">
            {#if ui.tab === 'fixture'}
                <FixturePanel />
            {:else if ui.tab === 'patch'}
                <PatchPanel />
            {:else if ui.tab === 'universe'}
                <UniversePanel />
            {:else if ui.tab === 'sources'}
                <SourcesPanel />
            {:else}
                <LogPanel />
            {/if}
        </div>
    </aside>
{/if}

<style>
    .details {
        position: absolute;
        top: 68px;
        right: 10px;
        width: 370px;
        max-height: calc(100% - 78px);
        display: flex;
        flex-direction: column;
        background: rgba(22, 26, 33, 0.94);
        backdrop-filter: blur(10px);
        border: 1px solid var(--line);
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
        z-index: 20;
    }
    header {
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--line);
        padding: 0 4px 0 6px;
    }
    .tabs {
        display: flex;
        flex: 1;
        min-width: 0;
    }
    .tabs button {
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        padding: 10px 8px 8px;
        color: var(--muted);
    }
    .tabs button.active {
        color: var(--text);
        border-bottom-color: var(--accent);
    }
    .count {
        font-size: 11px;
        color: var(--muted);
    }
    .close {
        font-size: 18px;
        line-height: 1;
        padding: 3px 8px;
        color: var(--muted);
    }
    .body {
        padding: 14px;
        overflow: auto;
        min-height: 0;
    }
    @media (max-width: 700px) {
        .details {
            top: auto;
            left: 12px;
            right: 12px;
            bottom: 12px;
            width: auto;
            max-height: 60%;
        }
    }
</style>
