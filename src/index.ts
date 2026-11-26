#!/usr/bin/env -S npx tsx
/**
 * node-dmx network DMX simulator.
 *
 *   npx node-dmx-simulator                     # from npm: demo rig, web UI on http://localhost:8080
 *   npx node-dmx-simulator --rig classroom     # start from another bundled rig
 *
 *   npm start -- --rig classroom               # from a checkout of the repo
 *   npm start -- --help
 *
 * The npm package is this file bundled by scripts/build.ts.
 */
import {exec} from 'child_process';
import {existsSync, readFileSync} from 'fs';
import {join, resolve} from 'path';

import {ConfigError, listBundledRigs, loadBundledRig, loadConfigFile, saveConfigFile, type RigConfig} from './config';
import {Simulator} from './simulator';
import {HAS_UI_SOURCES, ROOT_DIR} from './paths';
import {SimulatorHost} from './web/host';
import {startWebUi, type WebUi} from './web/ui';

const HELP = `
node-dmx DMX simulator: pretends to be DMX fixtures on your network, so you can
test sACN / Art-Net / RDM code without real lights.

Usage: ${HAS_UI_SOURCES ? 'npm start -- [options]' : 'npx node-dmx-simulator [options]'}

Rig
  --config <file>     Rig file to use. Created from --rig if it does not exist.
                      Edits made in the web UI are saved here.
                      Default: dmx-rig.json in the current folder.
  --rig <name>        Bundled rig to start from: ${listBundledRigs().join(', ')}
                      (default: examples)
  --no-save           Do not write the rig file; edits last until you quit.

Network
  --iface <ip>        IPv4 address of the network card to listen on for sACN
                      multicast, e.g. 192.168.1.50
  --artnet-bind <ip>  Only listen for Art-Net on this address.
  --artnet-port <n>   Art-Net UDP port (default 6454).
  --sacn-port <n>     sACN UDP port (default 5568).
  --no-sacn           Do not listen for sACN.
  --no-artnet         Do not listen for Art-Net.

Web UI
  --port <n>          Web UI port (default 8080).
  --host <ip>         Web UI address (default 127.0.0.1). Use 0.0.0.0 to let
                      others on your network open it, e.g. on a projector.
  --readonly          Disable editing in the web UI (for shared screens).
  --open              Open the web UI in your browser.
  --headless          No web UI; only log to the terminal.
  --dev               Work on the web UI: serve it with Vite and hot reload
                      (in a checkout of the node-dmx-simulator repository only)

  --version           Print the version.
  --help              Show this help.
`;

type Args = {
    config?: string;
    rig: string;
    save: boolean;
    iface?: string;
    artnetBind?: string;
    artnetPort?: number;
    sacnPort?: number;
    sacn: boolean;
    artnet: boolean;
    port: number;
    host: string;
    readonly: boolean;
    open: boolean;
    headless: boolean;
    dev: boolean;
};

/** Version from package.json (the repo's, or the installed package's). */
function version(): string {
    try {
        return (JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8')) as {version: string}).version;
    } catch {
        return 'unknown';
    }
}

function parseArgs(argv: string[]): Args {
    const args: Args = {rig: 'examples', save: true, sacn: true, artnet: true, port: 8080, host: '127.0.0.1', readonly: false, open: false, headless: false, dev: false};
    const takeValue = (i: number, name: string): string => {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) fail(`${name} needs a value`);
        return value;
    };
    const takePort = (i: number, name: string): number => {
        const n = Number(takeValue(i, name));
        if (!Number.isInteger(n) || n < 0 || n > 65535) fail(`${name} must be a port number`);
        return n;
    };

    for (let i = 0; i < argv.length; i++) {
        let arg = argv[i]!;
        // Accept --name=value as well as --name value.
        const eq = arg.indexOf('=');
        if (arg.startsWith('--') && eq > 0) {
            argv.splice(i + 1, 0, arg.substring(eq + 1));
            arg = arg.substring(0, eq);
        }
        switch (arg) {
            case '-h':
            case '--help':
                console.log(HELP);
                process.exit(0);
            case '-v':
            case '--version':
                console.log(version());
                process.exit(0);
            case '--config': args.config = takeValue(i++, arg); break;
            case '--rig': args.rig = takeValue(i++, arg); break;
            case '--no-save': args.save = false; break;
            case '--iface': args.iface = takeValue(i++, arg); break;
            case '--artnet-bind': args.artnetBind = takeValue(i++, arg); break;
            case '--artnet-port': args.artnetPort = takePort(i++, arg); break;
            case '--sacn-port': args.sacnPort = takePort(i++, arg); break;
            case '--no-sacn': args.sacn = false; break;
            case '--no-artnet': args.artnet = false; break;
            case '--port': args.port = takePort(i++, arg); break;
            case '--host': args.host = takeValue(i++, arg); break;
            case '--readonly': args.readonly = true; break;
            case '--open': args.open = true; break;
            case '--headless': args.headless = true; break;
            case '--dev': args.dev = true; break;
            default: fail(`Unknown option ${arg}. Run with --help to see all options.`);
        }
    }
    return args;
}

function fail(message: string): never {
    console.error(`\n  ${message}\n`);
    process.exit(1);
}

function loadRig(args: Args): {config: RigConfig; path?: string} {
    const path = resolve(args.config ?? 'dmx-rig.json');
    if (existsSync(path)) {
        console.log(`Rig file: ${path}`);
        return {config: loadConfigFile(path), path: args.save ? path : undefined};
    }
    if (args.config && !args.save) fail(`${path} does not exist`);
    const config = loadBundledRig(args.rig);
    if (args.save) {
        saveConfigFile(path, config);
        console.log(`Created rig file ${path} from the "${args.rig}" rig. Edit it in the web UI or by hand.`);
        return {config, path};
    }
    console.log(`Using the bundled "${args.rig}" rig (not saved).`);
    return {config};
}

function openBrowser(url: string): void {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} "${url}"`, () => undefined);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    let rig: {config: RigConfig; path?: string};
    try {
        rig = loadRig(args);
    } catch (err) {
        if (err instanceof ConfigError) fail(err.message);
        throw err;
    }

    const {config} = rig;
    // Command-line network flags apply to this run only; they are not saved in the rig file.
    const network = {
        sacn: {
            ...(args.sacn ? {} : {enabled: false}),
            ...(args.sacnPort !== undefined ? {port: args.sacnPort} : {}),
            ...(args.iface ? {iface: args.iface} : {}),
        },
        artnet: {
            ...(args.artnet ? {} : {enabled: false}),
            ...(args.artnetPort !== undefined ? {port: args.artnetPort} : {}),
            ...(args.artnetBind ? {bindAddress: args.artnetBind} : {}),
        },
    };

    const sim = new Simulator(config, {configPath: rig.path, readonly: args.readonly, network});
    sim.on('log', (entry) => {
        const time = new Date(entry.time).toLocaleTimeString();
        const prefix = entry.level === 'error' ? '\x1b[31m✖' : entry.level === 'warn' ? '\x1b[33m!' : '\x1b[2m·';
        console.log(`${prefix} ${time}\x1b[0m ${entry.message}`);
    });
    await sim.start();

    const status = sim.getStatus();
    const net = sim.network;
    console.log(`\n\x1b[1mnode-dmx simulator\x1b[0m: "${config.name}", ${config.fixtures.length} fixture(s) on universe(s) ${sim.universes.join(', ') || '-'}`);
    console.log(`  sACN     ${status.sacn.enabled ? status.sacn.detail : 'off'}`);
    console.log(`  Art-Net  ${status.artnet.enabled ? `UDP ${net.artnet.port}, answers ArtPoll and RDM` : 'off'}`);

    let web: WebUi | undefined;
    const host = new SimulatorHost(sim).register();
    if (!args.headless) {
        try {
            web = await startWebUi({port: args.port, host: args.host, dev: args.dev});
            const note = args.dev ? ' (Vite dev server: edits in ui/ reload live)' : args.readonly ? ' (read-only)' : '';
            console.log(`  Web UI   \x1b[36m${web.url}\x1b[0m${note}`);
            if (args.open) openBrowser(web.url);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            fail(code === 'EADDRINUSE'
                ? `Web UI port ${args.port} is in use. Try --port ${args.port + 1}.`
                : `Could not start the web UI: ${(err as Error).message}`);
        }
    }
    console.log('\nPress Ctrl+C to stop.\n');

    let stopping = false;
    const shutdown = async () => {
        if (stopping) process.exit(1);
        stopping = true;
        host.close();
        await Promise.all([web?.close(), sim.stop()]);
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
