<!-- Code to paste into a program, with this computer's real addresses filled in. -->
<script lang="ts">
    import {live} from '../../live.svelte';
    import {ui} from '../../ui.svelte';
    import Dialog from '../Dialog.svelte';

    const net = $derived(live.state?.network);
    const first = $derived(live.fixtures.find((f) => f.universe === 1) ?? live.fixtures[0]);
    const lan = $derived(live.state?.addresses[0]?.address);
    const artnetPort = $derived(net && net.artnet.port !== 6454 ? `, port: ${net.artnet.port}` : '');
    const sacnPort = $derived(net && net.sacn.port !== 5568 ? `, port: ${net.sacn.port}` : '');

    const dmxCode = $derived(`import {DMXController} from 'node-dmx';

// sACN multicast: reaches the simulator on this computer and on your network
const controller = new DMXController({protocol: 'sacn'${sacnPort}});

// Art-Net: send straight to the simulator's computer
// const controller = new DMXController({protocol: 'artnet', unicastDestination: '127.0.0.1'${artnetPort}});
${lan ? `// from another computer: unicastDestination: '${lan}'\n` : ''}
controller.setChannel(${first?.universe ?? 1}, ${first?.address ?? 1}, 255); // ${first ? `first channel of "${first.name}"` : 'universe 1, channel 1'}
await controller.flush();`);

    const rdmCode = $derived(`import {ArtNetDiscovery, ArtNetRdmClient} from 'node-dmx';

const discovery = new ArtNetDiscovery();
console.log(await discovery.pollOnce());   // one reply per universe

const rdm = new ArtNetRdmClient({host: '127.0.0.1'});
console.log(await rdm.getTod(${first?.universe ?? 1}));        // UIDs of the fixtures`);

    let copied = $state('');
    async function copy(code: string, which: string) {
        await navigator.clipboard.writeText(code);
        copied = which;
        setTimeout(() => (copied = ''), 1500);
    }
</script>

<Dialog bind:open={ui.helpOpen} title="How to connect" wide>
    {#if net}
        <dl class="kv">
            <dt>sACN</dt><dd>{net.sacn.enabled ? `UDP ${net.sacn.port}, multicast${net.sacn.iface ? ` on ${net.sacn.iface}` : ''}` : 'off'}</dd>
            <dt>Art-Net</dt><dd>{net.artnet.enabled ? `UDP ${net.artnet.port}${net.artnet.bindAddress ? ` on ${net.artnet.bindAddress}` : ''}` : 'off'}</dd>
            <dt>This computer</dt>
            <dd class="mono">127.0.0.1{#each live.state?.addresses ?? [] as a (a.address)}, {a.address} <span class="muted">({a.name})</span>{/each}</dd>
        </dl>
    {/if}

    <div class="code-head"><h4>Send DMX</h4><button type="button" class="ghost small" onclick={() => copy(dmxCode, 'dmx')}>{copied === 'dmx' ? 'Copied' : 'Copy'}</button></div>
    <pre>{dmxCode}</pre>

    <div class="code-head"><h4>Discovery and RDM (Art-Net)</h4><button type="button" class="ghost small" onclick={() => copy(rdmCode, 'rdm')}>{copied === 'rdm' ? 'Copied' : 'Copy'}</button></div>
    <pre>{rdmCode}</pre>

    <p class="muted small">
        Or run an example from the repository in a second terminal: <code>npm run example/sacn-rainbow</code>.
        Universe numbers are the same as in <code>DMXController</code>; Art-Net Port-Address = universe − 1.
    </p>
</Dialog>

<style>
    pre {
        background: var(--bg);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 10px 12px;
        overflow-x: auto;
        font-size: 12.5px;
        margin: 0 0 12px;
    }
    .code-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 12px;
    }
    .code-head h4 {
        margin: 0 0 6px;
    }
</style>
