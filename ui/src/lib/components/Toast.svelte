<script lang="ts">
    import {ui} from '../ui.svelte';
</script>

{#if ui.toast}
    {#key ui.toast.id}
        <div class="toast" class:ok={ui.toast.ok} role="status">{ui.toast.message}</div>
    {/key}
{/if}

<style>
    .toast {
        position: fixed;
        left: 50%;
        bottom: 22px;
        transform: translateX(-50%);
        background: #3b1d1d;
        color: #fecaca;
        border: 1px solid #7f2d2d;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 13px;
        z-index: 200;
        max-width: 80vw;
    }
    .ok {
        background: #13301f;
        color: #bbf7d0;
        border-color: #1f6b3d;
    }
</style>
