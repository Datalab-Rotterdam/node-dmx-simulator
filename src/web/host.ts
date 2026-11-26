/**
 * Connects a running Simulator to the web UI's server routes
 * (ui/src/routes/api). The routes run inside this process, so they reach the
 * simulator through this object, registered on `globalThis`.
 *
 * Everything HTTP lives in the SvelteKit app; this file only turns the
 * simulator into the state and events the UI needs.
 */
import {networkInterfaces} from 'os';

import {allTypes, listBundledRigs, loadBundledRig} from '../config';
import {fixtureSize, resolveLayout} from '../fixture-types';
import {
    BRIDGE_KEY,
    type AddFixturesRequest,
    type AddShapeRequest,
    type ItemIds,
    type ItemUpdates,
    type EventSender,
    type FixtureConfig,
    type FixtureUpdate,
    type FullState,
    type ReaddressRequest,
    type RigPatch,
    type SimulatorBridge,
    type UiState,
} from '../shared/types';
import type {Simulator, SimulatorEvents} from '../simulator';

/** Max DMX updates per second pushed to each browser. */
const UI_FPS = 30;
const SOURCES_INTERVAL_MS = 500;
/** A comment line keeps proxies and browsers from closing an idle event stream. */
const PING_INTERVAL_MS = 15_000;

type Client = {send: EventSender; ping: () => void};

export class SimulatorHost implements SimulatorBridge {
    private readonly clients = new Set<Client>();
    private readonly dirtyUniverses = new Set<number>();
    private readonly timers: NodeJS.Timeout[] = [];
    private readonly offs: Array<() => void> = [];

    constructor(private readonly sim: Simulator) {
        const on = <E extends keyof SimulatorEvents>(event: E, listener: (...args: SimulatorEvents[E]) => void) => {
            sim.on(event, listener as never);
            this.offs.push(() => sim.off(event, listener as never));
        };
        on('frame', (universe) => this.dirtyUniverses.add(universe));
        on('config', () => this.broadcast('state', this.uiState()));
        on('identify', (id, active) => this.broadcast('identify', {id, on: active}));
        on('log', (entry) => this.broadcast('log', entry));

        this.timers.push(setInterval(() => this.pushFrames(), 1000 / UI_FPS));
        this.timers.push(setInterval(() => this.broadcast('sources', {sources: sim.getSources(), status: sim.getStatus()}), SOURCES_INTERVAL_MS));
        this.timers.push(setInterval(() => this.clients.forEach((c) => c.ping()), PING_INTERVAL_MS));
    }

    /** Make this host available to the web UI's server routes. */
    public register(): this {
        (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] = this;
        return this;
    }

    public close(): void {
        this.timers.forEach(clearInterval);
        this.offs.forEach((off) => off());
        this.clients.clear();
        const g = globalThis as Record<symbol, unknown>;
        if (g[BRIDGE_KEY] === this) delete g[BRIDGE_KEY];
    }

    // ---- reading ----------------------------------------------------------

    public get readonly(): boolean {
        return this.sim.readonly;
    }

    public state(): FullState {
        return {...this.uiState(), sources: this.sim.getSources(), status: this.sim.getStatus(), log: this.sim.getLogs()};
    }

    public channels(universe: number): number[] {
        return [...this.sim.getFrame(universe)];
    }

    public subscribe(send: EventSender, ping: () => void): () => void {
        send('state', this.uiState());
        const frames: Record<string, string> = {};
        for (const u of this.sim.universes) frames[u] = encodeFrame(this.sim.getFrame(u));
        send('dmx', frames);
        send('sources', {sources: this.sim.getSources(), status: this.sim.getStatus()});
        send('history', this.sim.getLogs());
        const client = {send, ping};
        this.clients.add(client);
        return () => this.clients.delete(client);
    }

    // ---- editing (each is one undo step in the simulator) --------------------

    public addFixtures(req: AddFixturesRequest): string[] {
        return this.sim.addFixtures(req).map((f) => f.id);
    }

    public updateFixtures(updates: FixtureUpdate[]): FixtureConfig[] {
        return this.sim.updateFixtures(updates);
    }

    public removeFixtures(ids: string[]): void {
        this.sim.removeFixtures(ids);
    }

    public duplicateFixtures(ids: string[], offset: {dx: number; dy: number}): string[] {
        return this.sim.duplicateFixtures(ids, offset).map((f) => f.id);
    }

    public addShape(req: AddShapeRequest): string {
        return this.sim.addShape(req).id;
    }

    public updateItems(updates: ItemUpdates): void {
        this.sim.updateItems(updates);
    }

    public removeItems(ids: ItemIds): void {
        this.sim.removeItems(ids);
    }

    public duplicateItems(ids: ItemIds, offset: {dx: number; dy: number}): Required<ItemIds> {
        return this.sim.duplicateItems(ids, offset);
    }

    public readdress(req: ReaddressRequest): FixtureConfig[] {
        return this.sim.readdress(req);
    }

    public arrange(ids?: string[]): void {
        this.sim.arrange(ids);
    }

    public updateRig(patch: RigPatch): void {
        this.sim.updateRig(patch);
    }

    public loadBundledRig(name: string): void {
        this.sim.replaceConfig(loadBundledRig(name));
    }

    public undo(): boolean {
        return this.sim.undo();
    }

    public redo(): boolean {
        return this.sim.redo();
    }

    // ---- internals ------------------------------------------------------------

    /** Everything the UI needs to draw the rig. */
    private uiState(): UiState {
        const sim = this.sim;
        const config = sim.getConfig();
        const types = allTypes(config);
        const issues = sim.getPatchIssues();
        return {
            rig: {name: config.name, monitorUniverses: config.monitorUniverses},
            shapes: config.shapes,
            fixtures: config.fixtures.map((f) => {
                const type = types[f.type]!;
                const layout = resolveLayout(type, f.cells);
                return {
                    ...f,
                    typeName: type.name,
                    shape: type.shape ?? 'par',
                    layout,
                    size: fixtureSize(type, layout.cells, f.scale),
                    identify: sim.isIdentifying(f.id),
                    issues: issues.filter((i) => i.fixtureId === f.id).map((i) => i.message),
                };
            }),
            types: Object.fromEntries(Object.entries(types).map(([key, t]) => [key, {
                ...t,
                footprint: resolveLayout(t).footprint,
                custom: key in config.fixtureTypes,
            }])),
            universes: sim.universes,
            bundledRigs: listBundledRigs(),
            readonly: sim.readonly,
            configPath: sim.configPath ?? null,
            network: sim.network,
            addresses: localAddresses(),
            history: sim.history,
        };
    }

    private pushFrames(): void {
        if (this.dirtyUniverses.size === 0) return;
        if (this.clients.size > 0) {
            const frames: Record<string, string> = {};
            for (const u of this.dirtyUniverses) frames[u] = encodeFrame(this.sim.getFrame(u));
            this.broadcast('dmx', frames);
        }
        this.dirtyUniverses.clear();
    }

    private broadcast: EventSender = (event, data) => {
        for (const client of this.clients) client.send(event, data);
    };
}

const encodeFrame = (frame: Uint8Array) => Buffer.from(frame).toString('base64');

/** This computer's IPv4 addresses, for the "How to connect" help. */
function localAddresses(): Array<{name: string; address: string}> {
    const out: Array<{name: string; address: string}> = [];
    for (const [name, list] of Object.entries(networkInterfaces())) {
        for (const addr of list ?? []) {
            if (addr.family === 'IPv4' && !addr.internal) out.push({name, address: addr.address});
        }
    }
    return out;
}
