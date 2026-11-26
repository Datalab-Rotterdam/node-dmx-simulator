<script lang="ts">
    import '../app.css';
    import {live} from '../lib/live.svelte';

    let {children} = $props();
    live.connect();
</script>

<svelte:head><title>{live.state ? `${live.state.rig.name} · ` : ''}node-dmx simulator</title></svelte:head>

{@render children()}
