/**
 * Serves the web UI: a SvelteKit app (ui/) whose API routes
 * talk to the simulator running in this process (see host.ts).
 *
 * - normally: serves ui/build/handler.js (adapter-node) from a node:http
 *   server. From a checkout it first rebuilds the app when its sources
 *   changed; the npm package ships the build and never rebuilds.
 * - with `dev: true` (checkout only): runs the Vite dev server in this
 *   process, with hot reload
 */
import {spawnSync} from 'child_process';
import {existsSync, readdirSync, statSync} from 'fs';
import {createServer, type IncomingMessage, type ServerResponse} from 'http';
import type {AddressInfo} from 'net';
import {join} from 'path';
import {pathToFileURL} from 'url';

import {HAS_UI_SOURCES, ROOT_DIR, UI_DIR} from '../paths';

export {UI_DIR};
const BUILD_HANDLER = join(UI_DIR, 'build', 'handler.js');
const isWindows = process.platform === 'win32';

/**
 * adapter-node assumes https unless a header says otherwise. The simulator
 * serves plain http, so it tells the handler through this private header,
 * which it sets on every request itself.
 */
const PROTOCOL_HEADER = 'x-node-dmx-protocol';

export type WebUiOptions = {
    port: number;
    host: string;
    /** Run the Vite dev server (hot reload) instead of the built app. */
    dev?: boolean;
};

export type WebUi = {url: string; close: () => Promise<void>};

/** Start the web UI. The simulator's host must be registered first (SimulatorHost.register()). */
export async function startWebUi(options: WebUiOptions): Promise<WebUi> {
    if (options.dev) {
        if (!HAS_UI_SOURCES) throw new Error('--dev only works in a checkout of the node-dmx-simulator repository (it needs the web UI sources).');
        if (!ensureDependencies()) throw new Error('The web UI\'s dependencies are missing. Run "npm install" in ui/.');
        return startDev(options);
    }
    return startBuilt(options);
}

async function startBuilt({port, host}: WebUiOptions): Promise<WebUi> {
    if (!ensureUiBuilt()) throw new Error('The web UI could not be built (see above).');
    process.env.PROTOCOL_HEADER = PROTOCOL_HEADER;
    type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
    const {handler} = (await import(pathToFileURL(BUILD_HANDLER).href)) as {handler: Handler};

    const server = createServer((req, res) => {
        req.headers[PROTOCOL_HEADER] = 'http';
        handler(req, res, () => {
            res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}).end('Not found');
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolve();
        });
    });
    const actualPort = (server.address() as AddressInfo).port;
    return {
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`,
        close: () => new Promise((resolve) => {
            server.closeAllConnections(); // event streams never end by themselves
            server.close(() => resolve());
        }),
    };
}

async function startDev({port, host}: WebUiOptions): Promise<WebUi> {
    // Vite comes from the UI's own node_modules (the library uses an older one).
    const vite = (await import(pathToFileURL(join(UI_DIR, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href)) as typeof import('vite');
    const server = await vite.createServer({
        root: UI_DIR,
        configFile: join(UI_DIR, 'vite.config.ts'),
        server: {port, host, strictPort: true},
    });
    await server.listen();
    const url = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? `http://${host}:${port}`;
    return {url, close: () => server.close()};
}

// ---- building ----------------------------------------------------------------

/** Newest modification time of the UI sources (and the simulator code the UI imports). */
function newestSourceTime(): number {
    let newest = 0;
    const visit = (path: string) => {
        if (!existsSync(path)) return;
        const stat = statSync(path);
        if (stat.isDirectory()) {
            for (const entry of readdirSync(path)) visit(join(path, entry));
        } else {
            newest = Math.max(newest, stat.mtimeMs);
        }
    };
    for (const p of ['src', 'static', 'vite.config.ts', 'package.json']) visit(join(UI_DIR, p));
    visit(join(ROOT_DIR, 'src', 'shared'));
    visit(join(ROOT_DIR, 'src', 'fixture-types.ts'));
    return newest;
}

function npm(args: string[], quiet: boolean): boolean {
    const result = spawnSync('npm', args, {cwd: UI_DIR, stdio: quiet ? 'pipe' : 'inherit', shell: isWindows, encoding: 'utf8'});
    if (result.status !== 0 && quiet) process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    return result.status === 0;
}

function ensureDependencies(): boolean {
    if (existsSync(join(UI_DIR, 'node_modules', '@sveltejs', 'kit'))) return true;
    console.log('Installing the web UI\'s dependencies (first run only)...');
    const ok = npm([existsSync(join(UI_DIR, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], false);
    if (!ok) console.error('Could not install the web UI\'s dependencies. Try "npm install" in ui/.');
    return ok;
}

/** Make sure `ui/build` exists and is newer than the UI sources. */
export function ensureUiBuilt(): boolean {
    const built = existsSync(BUILD_HANDLER) ? statSync(BUILD_HANDLER).mtimeMs : 0;
    if (!HAS_UI_SOURCES) {
        if (!built) console.error(`The web UI is missing from this installation (${BUILD_HANDLER}). Reinstall node-dmx-simulator.`);
        return built > 0;
    }
    if (built && built >= newestSourceTime()) return true;
    if (!ensureDependencies()) return false;
    console.log(built ? 'Web UI sources changed, rebuilding...' : 'Building the web UI (first run only)...');
    return npm(['run', 'build'], true);
}
