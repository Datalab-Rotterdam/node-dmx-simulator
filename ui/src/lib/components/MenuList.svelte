<!--
  One level of a context menu. Items with `children` open a submenu on hover
  or ArrowRight; the component renders itself for that submenu.
-->
<script lang="ts">
    import type {MenuItem} from '../menus';
    import MenuList from './MenuList.svelte';

    type Props = {
        items: MenuItem[];
        x: number;
        y: number;
        /** Called after an item runs, to close the whole menu. */
        onpick: () => void;
        /** Submenus: called on ArrowLeft to return to the parent. */
        onback?: () => void;
    };

    let {items, x, y, onpick, onback}: Props = $props();

    let el = $state<HTMLDivElement>();
    let open = $state<number | null>(null);
    let pos = $state({left: 0, top: 0});
    let subPos = $state({x: 0, y: 0});

    // Keep the menu inside the window.
    $effect(() => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        pos = {
            left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
            top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
        };
    });

    function openSub(i: number, row: HTMLElement) {
        const r = row.getBoundingClientRect();
        subPos = {x: r.right - 4, y: r.top - 5};
        open = i;
    }

    function run(item: MenuItem) {
        if ('separator' in item || 'heading' in item || item.disabled || item.children) return;
        onpick();
        item.action?.();
    }

    function onkeydown(e: KeyboardEvent, i: number, item: MenuItem) {
        const rows = [...(el?.querySelectorAll<HTMLElement>(':scope > [role=menuitem]') ?? [])];
        const index = rows.indexOf(e.currentTarget as HTMLElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = rows[(index + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length];
            next?.focus();
        } else if ((e.key === 'ArrowRight' || e.key === 'Enter') && 'children' in item && item.children && !item.disabled) {
            e.preventDefault();
            openSub(i, e.currentTarget as HTMLElement);
        } else if (e.key === 'ArrowLeft' && onback) {
            e.preventDefault();
            onback();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            run(item);
        }
    }

    $effect(() => {
        // Focus the first item so the menu works from the keyboard.
        el?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus();
    });
</script>

<div class="menu" role="menu" tabindex="-1" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px">
    {#each items as item, i (i)}
        {#if 'separator' in item}
            <div class="menu-sep" role="separator"></div>
        {:else if 'heading' in item}
            <div class="menu-heading">{item.heading}</div>
        {:else}
            <div
                class="menu-item"
                class:danger={item.danger}
                class:active={open === i}
                role="menuitem"
                tabindex="-1"
                aria-disabled={item.disabled}
                aria-haspopup={item.children ? 'menu' : undefined}
                onpointerenter={(e) => (item.children && !item.disabled ? openSub(i, e.currentTarget) : (open = null))}
                onclick={() => run(item)}
                onkeydown={(e) => onkeydown(e, i, item)}
            >
                <span class="check">{item.checked ? '✓' : ''}</span>
                <span class="label">{item.label}</span>
                {#if item.shortcut}<span class="shortcut">{item.shortcut}</span>{/if}
                {#if item.children}<span class="arrow">›</span>{/if}
            </div>
            {#if open === i && item.children && !item.disabled}
                <MenuList
                    items={item.children}
                    x={subPos.x}
                    y={subPos.y}
                    {onpick}
                    onback={() => {
                        open = null;
                        (el?.querySelectorAll<HTMLElement>(':scope > [role=menuitem]')[0])?.focus();
                    }}
                />
            {/if}
        {/if}
    {/each}
</div>

<style>
    .menu {
        position: fixed;
        z-index: 100;
        min-width: 210px;
        padding: 5px;
        background: #1b2029;
        border: 1px solid var(--line);
        border-radius: 9px;
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55);
        font-size: 13px;
        outline: none;
    }
    .menu-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 9px 5px 4px;
        border-radius: 5px;
        cursor: default;
        white-space: nowrap;
        outline: none;
    }
    .menu-item:hover:not([aria-disabled='true']),
    .menu-item:focus-visible,
    .menu-item.active {
        background: var(--sel);
        color: #08111f;
    }
    .menu-item[aria-disabled='true'] {
        opacity: 0.4;
    }
    .menu-item.danger:not(:hover):not(:focus-visible) {
        color: var(--err);
    }
    .check {
        width: 16px;
        text-align: center;
        font-size: 12px;
    }
    .label {
        flex: 1;
    }
    .shortcut {
        color: var(--muted);
        font-size: 11.5px;
        margin-left: 18px;
    }
    .menu-item:hover .shortcut,
    .menu-item:focus-visible .shortcut {
        color: inherit;
        opacity: 0.7;
    }
    .arrow {
        margin-left: 12px;
    }
    .menu-sep {
        height: 1px;
        margin: 5px 6px;
        background: var(--line);
    }
    .menu-heading {
        padding: 4px 9px 6px 26px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
        white-space: nowrap;
    }
</style>
