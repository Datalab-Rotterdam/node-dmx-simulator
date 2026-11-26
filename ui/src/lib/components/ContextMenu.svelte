<!-- The open context menu (from ui.menu). Closes on outside click, Escape, scroll or resize. -->
<script lang="ts">
    import {ui} from '../ui.svelte';
    import MenuList from './MenuList.svelte';

    function onPointerDown(e: PointerEvent) {
        if (ui.menu && !(e.target as HTMLElement).closest('.menu')) ui.closeMenu();
    }
</script>

<svelte:window
    onpointerdowncapture={onPointerDown}
    onresize={() => ui.closeMenu()}
    onblur={() => ui.closeMenu()}
/>
<svelte:document onwheel={() => ui.closeMenu()} />

{#if ui.menu}
    <MenuList items={ui.menu.items} x={ui.menu.x} y={ui.menu.y} onpick={() => ui.closeMenu()} />
{/if}
