<script lang="ts">
    import {ui} from '../ui.svelte';
</script>

<div class="hint">
    <b>Waiting for DMX?</b> Run one of the library examples in another terminal, e.g.
    <pre>npm run example/sacn-rainbow</pre>
    or open <button class="link" onclick={() => (ui.helpOpen = true)}>How to connect</button> for code you can paste into your own program.
</div>

<style>
    .hint {
        background: var(--panel-2);
        border: 1px dashed var(--line);
        border-radius: 8px;
        padding: 12px 14px;
        font-size: 13px;
    }
    pre {
        background: var(--bg);
        padding: 8px 10px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 8px 0;
    }
</style>
