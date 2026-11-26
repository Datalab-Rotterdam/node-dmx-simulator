<!-- Modal dialog built on <dialog>. Bind `open`; content goes in the default snippet, buttons in `actions`. -->
<script lang="ts">
    import type {Snippet} from 'svelte';

    type Props = {
        open: boolean;
        title: string;
        wide?: boolean;
        children: Snippet;
        actions?: Snippet;
        /** Called on submit (Enter or a submit button). Return false to keep the dialog open. */
        onsubmit?: () => boolean | void | Promise<boolean | void>;
    };

    let {open = $bindable(), title, wide = false, children, actions, onsubmit}: Props = $props();
    let el = $state<HTMLDialogElement>();

    $effect(() => {
        if (!el) return;
        if (open && !el.open) el.showModal();
        else if (!open && el.open) el.close();
    });

    async function submit(e: SubmitEvent) {
        e.preventDefault();
        if (!onsubmit || (await onsubmit()) !== false) open = false;
    }
</script>

<dialog bind:this={el} class:wide onclose={() => (open = false)}>
    <form onsubmit={submit}>
        <h2>{title}</h2>
        {@render children()}
        <menu>
            {#if actions}
                {@render actions()}
            {:else}
                <button type="submit" class="primary">Close</button>
            {/if}
        </menu>
    </form>
</dialog>

<style>
    dialog {
        background: var(--panel);
        color: var(--text);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 20px 22px;
        width: min(520px, 92vw);
    }
    dialog.wide {
        width: min(780px, 94vw);
    }
    dialog::backdrop {
        background: rgba(0, 0, 0, 0.6);
    }
    h2 {
        margin: 0 0 14px;
        font-size: 18px;
    }
    menu {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 0;
        margin: 18px 0 0;
    }
</style>
