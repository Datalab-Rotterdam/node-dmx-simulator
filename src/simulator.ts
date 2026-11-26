/**
 * The simulator core: listens for sACN and Art-Net, keeps one DMX frame per
 * universe, answers RDM for every fixture and keeps the rig file in sync.
 *
 * You can also use it from code, for example in a test:
 *
 * ```ts
 * const sim = new Simulator(loadBundledRig('examples'));
 * await sim.start();
 * // ... run your DMX code ...
 * expect(sim.getChannel(1, 1)).toBe(255);
 * await sim.stop();
 * ```
 */
import {EventEmitter} from 'events';

import {RdmResponder, uidFromString} from 'node-dmx';
import {
    allTypes,
    assignMissingUids,
    findPatchIssues,
    footprintOf,
    mainStageRect,
    defaultPosition,
    normalizeConfig,
    normalizeFixture,
    normalizeShape,
    saveConfigFile,
    slugify,
    type FixtureConfig,
    type PatchIssue,
    type RigConfig,
    type ShapeConfig,
} from './config';
import {decodeFixture, fixtureSize, resolveLayout, type DecodedFixture} from './fixture-types';
import {ArtNetInput, type RdmLogEntry} from './inputs/artnet-input';
import {SacnInput} from './inputs/sacn-input';
import {SourceTracker, type SourceSnapshot} from './inputs/source-tracker';
import {
    SHAPE_DEFAULTS,
    type AddFixturesRequest,
    type AddShapeRequest,
    type FixtureUpdate,
    type HistoryState,
    type InputStatus,
    type ItemIds,
    type ItemUpdates,
    type LogEntry,
    type ReaddressRequest,
    type RigPatch,
    type ShapeUpdate,
    type StatusSnapshot,
} from './shared/types';

export type SimulatorOptions = {
    /** Save rig changes (UI edits, RDM readdressing) to this file. */
    configPath?: string;
    /** Reject edits from the web UI / API. */
    readonly?: boolean;
    /**
     * Network settings that override the rig file for this run only (for
     * command-line flags). They are never written back to the rig file.
     */
    network?: {sacn?: Partial<RigConfig['sacn']>; artnet?: Partial<RigConfig['artnet']>};
};

export type {AddFixturesRequest, FixtureUpdate, HistoryState, InputStatus, LogEntry, ReaddressRequest, StatusSnapshot};

export interface SimulatorEvents {
    /** A universe's output changed. */
    frame: [universe: number, data: Uint8Array];
    /** The rig (fixtures, names, patch) changed. */
    config: [RigConfig];
    identify: [fixtureId: string, on: boolean];
    log: [LogEntry];
    rdm: [RdmLogEntry];
}

type ResponderEntry = {responder: RdmResponder; signature: string};

/** The parts of a rig that undo/redo restore (not the network settings). */
type RigContent = Pick<RigConfig, 'name' | 'shapes' | 'monitorUniverses' | 'fixtureTypes' | 'fixtures'>;
type HistoryEntry = {label: string; rig: RigContent};

const pickRig = (c: RigConfig): RigContent => ({
    name: c.name,
    shapes: c.shapes,
    monitorUniverses: c.monitorUniverses,
    fixtureTypes: c.fixtureTypes,
    fixtures: c.fixtures,
});

/** True when updates only move/rotate/resize things (not logged; labelled "Move"). */
const isPositional = (updates: Array<object>) =>
    updates.every((u) => Object.keys(u).every((k) => ['id', 'x', 'y', 'rotation', 'scale'].includes(k)));
const isResize = (updates: Array<object>) => updates.some((u) => 'scale' in u);

const MAX_LOG = 200;
const MAX_HISTORY = 100;

export class Simulator extends EventEmitter<SimulatorEvents> {
    private config: RigConfig;
    private readonly sources = new SourceTracker();
    private sacn?: SacnInput;
    private artnet?: ArtNetInput;
    private readonly output = new Map<number, Uint8Array>();
    private readonly inputFrames = {sacn: new Map<number, Uint8Array>(), artnet: new Map<number, Uint8Array>()};
    private readonly responders = new Map<string, ResponderEntry>();
    private readonly identifying = new Set<string>();
    private readonly logs: LogEntry[] = [];
    private readonly undoStack: HistoryEntry[] = [];
    private readonly redoStack: HistoryEntry[] = [];
    private saveTimer?: NodeJS.Timeout;
    private readonly status: {sacn: InputStatus; artnet: InputStatus};

    constructor(config: RigConfig, private readonly options: SimulatorOptions = {}) {
        super();
        this.config = config;
        const net = this.network;
        this.status = {
            sacn: {enabled: net.sacn.enabled, listening: false, detail: 'off'},
            artnet: {enabled: net.artnet.enabled, listening: false, detail: 'off'},
        };
        this.sources.onChange = (source, change) => {
            const what = source.protocol === 'sacn' ? `sACN source "${source.name}" (${source.address ?? '?'})` : `Art-Net sender ${source.address}`;
            if (change === 'new') this.log('info', `${what} started sending to universe ${source.universes.join(', ')}`);
            else if (change === 'back') this.log('info', `${what} is back`);
            else this.log('warn', `${what} stopped (${source.lostReason})`);
        };
    }

    public get readonly(): boolean {
        return this.options.readonly ?? false;
    }

    public get configPath(): string | undefined {
        return this.options.configPath;
    }

    /** Network settings in effect: the rig file's, with command-line overrides applied. */
    public get network(): Pick<RigConfig, 'sacn' | 'artnet'> {
        return {
            sacn: {...this.config.sacn, ...this.options.network?.sacn},
            artnet: {...this.config.artnet, ...this.options.network?.artnet},
        };
    }

    /** Open the network sockets. */
    public async start(): Promise<void> {
        const {sacn, artnet} = this.network;
        if (sacn.enabled) {
            this.sacn = new SacnInput({port: sacn.port, iface: sacn.iface}, this.sources);
            this.sacn.on('frame', (u, data) => this.onInputFrame('sacn', u, data));
            this.sacn.on('log', (level, msg) => this.log(level, msg));
            this.sacn.on('error', (err) => this.inputError('sacn', err));
            this.status.sacn = {
                enabled: true,
                listening: true,
                detail: `UDP ${sacn.port}, multicast on ${sacn.iface ?? 'default interface'}`,
            };
        }
        if (artnet.enabled) {
            this.artnet = new ArtNetInput({
                port: artnet.port,
                bindAddress: artnet.bindAddress,
                shortName: artnet.shortName,
                longName: `node-dmx simulator: ${this.config.name}`,
                sourceTimeoutMs: artnet.sourceTimeoutMs,
            }, this.sources);
            this.artnet.on('frame', (u, data) => this.onInputFrame('artnet', u, data));
            this.artnet.on('log', (level, msg) => this.log(level, msg));
            this.artnet.on('rdm', (entry) => this.onRdm(entry));
            this.artnet.on('error', (err) => this.inputError('artnet', err));
            this.artnet.on('listening', (address, port) => {
                this.status.artnet = {enabled: true, listening: true, detail: `UDP ${address}:${port}`};
            });
            this.status.artnet = {enabled: true, listening: false, detail: `binding UDP ${artnet.port}...`};
        }
        this.rebuild();
        // Give the sockets a moment to bind so start() callers can send right away.
        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    public async stop(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
            this.save();
        }
        await Promise.all([this.sacn?.close(), this.artnet?.close()]);
        this.sacn = undefined;
        this.artnet = undefined;
    }

    // ---- reading DMX ------------------------------------------------------

    /** Current 512-channel frame of a universe (index 0 = channel 1). */
    public getFrame(universe: number): Uint8Array {
        return this.output.get(universe) ?? new Uint8Array(512);
    }

    /** Current value (0-255) of one channel. */
    public getChannel(universe: number, channel: number): number {
        return this.getFrame(universe)[channel - 1] ?? 0;
    }

    /** Current values of a fixture, by channel name, normalised 0..1. */
    public getFixtureValues(id: string): DecodedFixture | undefined {
        const fixture = this.config.fixtures.find((f) => f.id === id);
        if (!fixture) return undefined;
        const type = allTypes(this.config)[fixture.type]!;
        return decodeFixture(resolveLayout(type, fixture.cells), this.getFrame(fixture.universe), fixture.address);
    }

    /** Resolve when `predicate` holds for a universe's frame, or reject after `timeoutMs`. Handy in tests. */
    public waitFor(universe: number, predicate: (frame: Uint8Array) => boolean, timeoutMs = 2000): Promise<Uint8Array> {
        if (predicate(this.getFrame(universe))) return Promise.resolve(this.getFrame(universe));
        return new Promise((resolve, reject) => {
            const onFrame = (u: number, data: Uint8Array) => {
                if (u !== universe || !predicate(data)) return;
                cleanup();
                resolve(data);
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Universe ${universe} did not reach the expected state within ${timeoutMs} ms`));
            }, timeoutMs);
            const cleanup = () => {
                clearTimeout(timer);
                this.off('frame', onFrame);
            };
            this.on('frame', onFrame);
        });
    }

    public getConfig(): RigConfig {
        return this.config;
    }

    public getSources(): SourceSnapshot[] {
        return this.sources.list();
    }

    public getLogs(): LogEntry[] {
        return [...this.logs];
    }

    public getStatus(): StatusSnapshot {
        return {sacn: this.status.sacn, artnet: {...this.status.artnet, syncMode: this.artnet?.syncMode ?? false}};
    }

    public getPatchIssues(): PatchIssue[] {
        return findPatchIssues(this.config);
    }

    public isIdentifying(id: string): boolean {
        return this.identifying.has(id);
    }

    /** Universes the simulator listens to: every patched universe plus `monitorUniverses`. */
    public get universes(): number[] {
        const set = new Set<number>(this.config.monitorUniverses);
        for (const f of this.config.fixtures) set.add(f.universe);
        return [...set].sort((a, b) => a - b);
    }

    // ---- editing the rig --------------------------------------------------
    //
    // Every edit goes through edit(): it records an undo step, rolls back if
    // the edit throws halfway, then rebuilds sockets/RDM and saves the file.

    /** Add one or more fixtures, auto-addressing and placing them when not specified. */
    public addFixtures(req: AddFixturesRequest): FixtureConfig[] {
        const types = allTypes(this.config);
        const type = types[req.type];
        if (!type) throw new Error(`Unknown fixture type "${req.type}"`);
        const count = Math.max(1, Math.min(Math.floor(req.count ?? 1), 512));
        const footprint = resolveLayout(type, req.cells).footprint;
        if (footprint > 512) throw new Error(`One fixture would use ${footprint} channels; a universe has 512`);

        return this.edit(`Add ${count} × ${type.name}`, () => {
            let universe = req.universe ?? 1;
            let address = req.address ?? this.nextFreeAddress(universe);
            const size = fixtureSize(type, resolveLayout(type, req.cells).cells);
            const gap = 24;
            const layout = req.layout ?? 'row';
            const stage = mainStageRect(this.config);
            const originX = req.x ?? stage.left + 40;
            const right = Math.max(stage.left + stage.width, originX + size.w + gap);
            const columns = layout === 'column' ? 1 : layout === 'row'
                ? Math.max(1, Math.floor((right - originX - 20) / (size.w + gap)))
                : Math.max(1, req.columns ?? Math.ceil(Math.sqrt(count)));
            const originY = req.y ?? this.nextFreeY();
            const baseName = req.name?.trim() || type.name.replace(/\s*\(.*\)$/, '');

            const ids = new Set(this.config.fixtures.map((f) => f.id));
            const added: FixtureConfig[] = [];
            for (let i = 0; i < count; i++) {
                if (address - 1 + footprint > 512) {
                    universe++;
                    address = this.nextFreeAddress(universe);
                }
                const raw = {
                    name: count === 1 && req.name ? req.name : this.nextName(baseName),
                    type: req.type,
                    universe,
                    address,
                    cells: req.cells,
                    x: originX + (i % columns) * (size.w + gap) + size.w / 2,
                    y: originY + Math.floor(i / columns) * (size.h + gap) + size.h / 2,
                };
                const fixture = this.validated(raw, ids);
                ids.add(fixture.id);
                added.push(fixture);
                this.config.fixtures.push(fixture);
                address += footprint;
            }
            assignMissingUids(this.config);
            return added;
        });
    }

    /** Change one fixture (name, type, universe, address, position, ...). */
    public updateFixture(id: string, patch: Omit<FixtureUpdate, 'id'>): FixtureConfig {
        return this.updateFixtures([{...patch, id}])[0]!;
    }

    /**
     * Change several fixtures in one step (one undo step, one save). Either
     * every update is valid and applied, or nothing changes.
     */
    public updateFixtures(updates: FixtureUpdate[]): FixtureConfig[] {
        if (updates.length === 0) return [];
        let results: FixtureConfig[] = [];
        this.edit(this.updateLabel(updates, []), () => {
            results = this.applyFixtureUpdates(updates);
        }, {log: !isPositional(updates)});
        return results;
    }

    /** Change fixtures and shapes together, e.g. when moving a mixed selection. One undo step; all or nothing. */
    public updateItems({fixtures = [], shapes = []}: ItemUpdates): void {
        if (fixtures.length + shapes.length === 0) return;
        this.edit(this.updateLabel(fixtures, shapes), () => {
            this.applyFixtureUpdates(fixtures);
            this.applyShapeUpdates(shapes);
        }, {log: !(isPositional(fixtures) && isPositional(shapes))});
    }

    public updateShapes(updates: ShapeUpdate[]): void {
        this.updateItems({shapes: updates});
    }

    /** Add a shape (stage, truss, roof, area or label). Returns it. */
    public addShape(req: AddShapeRequest): ShapeConfig {
        const kind = SHAPE_DEFAULTS[req.kind] ? req.kind : undefined;
        if (!kind) throw new Error(`Unknown shape kind ${JSON.stringify(req.kind)}`);
        const name = req.name?.trim() || SHAPE_DEFAULTS[kind].name;
        return this.edit(`Add ${name}`, () => {
            const shape = this.validatedShape({color: SHAPE_DEFAULTS[kind].color, ...req, name}, new Set(this.config.shapes.map((s) => s.id)));
            this.config.shapes.push(shape);
            return shape;
        });
    }

    public removeFixture(id: string): void {
        this.removeFixtures([id]);
    }

    /** Remove fixtures (one undo step). */
    public removeFixtures(ids: string[]): void {
        this.removeItems({fixtures: ids});
    }

    /** Remove fixtures and shapes (one undo step). */
    public removeItems({fixtures = [], shapes = []}: ItemIds): void {
        const fixtureIds = new Set(fixtures);
        const shapeIds = new Set(shapes);
        const victims = [
            ...this.config.fixtures.filter((f) => fixtureIds.has(f.id)),
            ...this.config.shapes.filter((sh) => shapeIds.has(sh.id)),
        ];
        if (victims.length === 0) throw new Error(shapes.length ? 'None of those fixtures or shapes exist' : 'None of those fixtures exist');
        const label = victims.length === 1 ? `Delete "${victims[0]!.name}"` : `Delete ${victims.length} ${shapes.length ? 'items' : 'fixtures'}`;
        this.edit(label, () => {
            this.config.fixtures = this.config.fixtures.filter((f) => !fixtureIds.has(f.id));
            this.config.shapes = this.config.shapes.filter((sh) => !shapeIds.has(sh.id));
            for (const id of fixtureIds) this.identifying.delete(id);
        });
    }

    /**
     * Copy fixtures. Copies get the next free addresses in the same universe
     * (moving on to the next universe when full), a new name, a new RDM UID,
     * and sit `offset` stage units from the original.
     */
    public duplicateFixtures(ids: string[], offset = {dx: 30, dy: 30}): FixtureConfig[] {
        const sources = ids.map((id) => this.find(id));
        const label = sources.length === 1 ? `Duplicate "${sources[0]!.name}"` : `Duplicate ${sources.length} fixtures`;
        return this.edit(label, () => this.copyFixtures(sources, offset));
    }

    /** Copy fixtures and shapes (one undo step). Returns the new ids. */
    public duplicateItems({fixtures = [], shapes = []}: ItemIds, offset = {dx: 30, dy: 30}): Required<ItemIds> {
        const fixtureSources = fixtures.map((id) => this.find(id));
        const shapeSources = shapes.map((id) => this.findShape(id));
        const n = fixtureSources.length + shapeSources.length;
        if (n === 0) return {fixtures: [], shapes: []};
        const first = fixtureSources[0] ?? shapeSources[0]!;
        return this.edit(n === 1 ? `Duplicate "${first.name}"` : `Duplicate ${n} items`, () => {
            const taken = new Set(this.config.shapes.map((sh) => sh.id));
            const shapeCopies = shapeSources.map((src) => {
                const {id: _id, ...rest} = src;
                const copy = this.validatedShape({...rest, x: src.x + offset.dx, y: src.y + offset.dy}, taken);
                taken.add(copy.id);
                this.config.shapes.push(copy);
                return copy.id;
            });
            return {fixtures: this.copyFixtures(fixtureSources, offset).map((f) => f.id), shapes: shapeCopies};
        });
    }

    private copyFixtures(sources: FixtureConfig[], offset: {dx: number; dy: number}): FixtureConfig[] {
        const taken = new Set(this.config.fixtures.map((f) => f.id));
        const copies: FixtureConfig[] = [];
        for (const src of sources) {
            const footprint = footprintOf(this.config, src);
            let universe = src.universe;
            let address = this.nextFreeAddress(universe);
            if (address - 1 + footprint > 512) address = this.nextFreeAddress(++universe);
            const {id: _id, uid: _uid, ...rest} = src;
            const copy = this.validated({
                ...rest,
                name: this.nextName(src.name.replace(/\s*\d+$/, '') || src.name),
                universe,
                address,
                x: src.x + offset.dx,
                y: src.y + offset.dy,
            }, taken);
            taken.add(copy.id);
            this.config.fixtures.push(copy);
            copies.push(copy);
        }
        assignMissingUids(this.config);
        return copies;
    }

    /**
     * Patch fixtures one after another from `universe`/`address`, in the
     * order given, moving on to the next universe when one does not fit.
     */
    public readdress(req: ReaddressRequest): FixtureConfig[] {
        const list = req.ids.map((id) => this.find(id));
        const label = list.length === 1 ? `Readdress "${list[0]!.name}"` : `Readdress ${list.length} fixtures`;
        return this.edit(label, () => {
            let universe = req.universe;
            let address = req.address;
            for (const f of list) {
                const footprint = footprintOf(this.config, f);
                if (address - 1 + footprint > 512) {
                    universe++;
                    address = 1;
                }
                f.universe = universe;
                f.address = address;
                this.validated(f, new Set());
                address += footprint;
            }
            return list;
        });
    }

    /**
     * Lay fixtures out neatly: one row per universe, in address order. With
     * `ids`, only those fixtures are arranged, starting at their top-left corner.
     */
    public arrange(ids?: string[]): void {
        const only = ids?.length ? new Set(ids) : undefined;
        const fixtures = this.config.fixtures.filter((f) => !only || only.has(f.id));
        if (fixtures.length === 0) return;
        const sizeOf = (f: FixtureConfig) => {
            const type = allTypes(this.config)[f.type]!;
            return fixtureSize(type, resolveLayout(type, f.cells).cells, f.scale);
        };
        const stage = mainStageRect(this.config);
        const left = only ? Math.min(...fixtures.map((f) => f.x - sizeOf(f).w / 2)) : stage.left + 40;
        const top = only ? Math.min(...fixtures.map((f) => f.y - sizeOf(f).h / 2)) : stage.top + 40;
        const right = Math.max(stage.left + stage.width, left + 400);

        this.edit(only ? `Arrange ${fixtures.length} fixtures` : 'Auto-arrange', () => {
            const gap = 24;
            let y = top;
            const universes = [...new Set(fixtures.map((f) => f.universe))].sort((a, b) => a - b);
            for (const universe of universes) {
                const row = fixtures.filter((f) => f.universe === universe).sort((a, b) => a.address - b.address);
                let x = left;
                let rowHeight = 0;
                for (const f of row) {
                    const size = sizeOf(f);
                    if (x + size.w > right - 20 && x > left) {
                        x = left;
                        y += rowHeight + gap;
                        rowHeight = 0;
                    }
                    f.x = Math.round(x + size.w / 2);
                    f.y = Math.round(y + size.h / 2);
                    delete f.rotation;
                    x += size.w + gap;
                    rowHeight = Math.max(rowHeight, size.h);
                }
                y += rowHeight + gap + 20;
            }
        });
    }

    /** Change rig-level settings (name, monitored universes). */
    public updateRig(patch: RigPatch): void {
        const next = normalizeConfig({
            ...this.config,
            name: patch.name ?? this.config.name,
            monitorUniverses: patch.monitorUniverses ?? this.config.monitorUniverses,
        });
        this.edit('Rig settings', () => {
            this.config.name = next.name;
            this.config.monitorUniverses = next.monitorUniverses;
        });
    }

    /** Replace the whole rig (e.g. a bundled rig). Undoable. */
    public replaceConfig(config: RigConfig): void {
        this.edit(`Load rig "${config.name}"`, () => {
            Object.assign(this.config, pickRig(config));
            this.identifying.clear();
        });
    }

    // ---- undo / redo ------------------------------------------------------

    public get history(): HistoryState {
        return {
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0,
            undoLabel: this.undoStack.at(-1)?.label,
            redoLabel: this.redoStack.at(-1)?.label,
        };
    }

    /** Undo the last edit. RDM changes made by controllers are not undo steps. */
    public undo(): boolean {
        return this.travel(this.undoStack, this.redoStack, 'Undo');
    }

    public redo(): boolean {
        return this.travel(this.redoStack, this.undoStack, 'Redo');
    }

    private travel(from: HistoryEntry[], to: HistoryEntry[], verb: string): boolean {
        const entry = from.pop();
        if (!entry) return false;
        to.push({label: entry.label, rig: structuredClone(pickRig(this.config))});
        Object.assign(this.config, structuredClone(entry.rig));
        this.identifying.clear();
        this.changed(`${verb}: ${entry.label}`);
        return true;
    }

    private edit<T>(label: string, apply: () => T, options: {log?: boolean} = {}): T {
        const before = structuredClone(pickRig(this.config));
        let result: T;
        try {
            result = apply();
        } catch (err) {
            Object.assign(this.config, before);
            throw err;
        }
        this.undoStack.push({label, rig: before});
        if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
        this.redoStack.length = 0;
        this.changed(options.log === false ? undefined : label);
        return result;
    }

    private find(id: string): FixtureConfig {
        const fixture = this.config.fixtures.find((f) => f.id === id);
        if (!fixture) throw new Error(`No fixture with id "${id}"`);
        return fixture;
    }

    private findShape(id: string): ShapeConfig {
        const shape = this.config.shapes.find((sh) => sh.id === id);
        if (!shape) throw new Error(`No shape with id "${id}"`);
        return shape;
    }

    private validatedShape(raw: unknown, takenIds: Set<string>): ShapeConfig {
        const result = normalizeShape(raw, takenIds);
        if (typeof result === 'string') throw new Error(result);
        return result;
    }

    private applyFixtureUpdates(updates: FixtureUpdate[]): FixtureConfig[] {
        const results: FixtureConfig[] = [];
        for (const {id, ...patch} of updates) {
            const index = this.config.fixtures.findIndex((f) => f.id === id);
            if (index < 0) throw new Error(`No fixture with id "${id}"`);
            const merged: Record<string, unknown> = {...this.config.fixtures[index], ...patch, id};
            if ('cells' in patch && (patch.cells === null || patch.cells === undefined)) delete merged.cells;
            if ('rotation' in patch && !patch.rotation) delete merged.rotation;
            if ('scale' in patch && (patch.scale === null || patch.scale === 1)) delete merged.scale;
            const others = new Set(this.config.fixtures.filter((f) => f.id !== id).map((f) => f.id));
            const next = this.validated(merged, others);
            this.config.fixtures[index] = next;
            results.push(next);
        }
        return results;
    }

    private applyShapeUpdates(updates: ShapeUpdate[]): void {
        for (const {id, ...patch} of updates) {
            const index = this.config.shapes.findIndex((sh) => sh.id === id);
            if (index < 0) throw new Error(`No shape with id "${id}"`);
            const merged: Record<string, unknown> = {...this.config.shapes[index], ...patch, id};
            for (const key of ['rotation', 'color'] as const) if (key in patch && !patch[key]) delete merged[key];
            const others = new Set(this.config.shapes.filter((sh) => sh.id !== id).map((sh) => sh.id));
            this.config.shapes[index] = this.validatedShape(merged, others);
        }
    }

    private updateLabel(fixtures: Array<{id: string}>, shapes: Array<{id: string}>): string {
        const verb = !(isPositional(fixtures) && isPositional(shapes)) ? 'Edit' : isResize(fixtures) ? 'Resize' : 'Move';
        const n = fixtures.length + shapes.length;
        if (n === 1) {
            const name = fixtures.length ? this.find(fixtures[0]!.id).name : this.findShape(shapes[0]!.id).name;
            return `${verb} "${name}"`;
        }
        return `${verb} ${n} ${shapes.length ? 'items' : 'fixtures'}`;
    }

    private validated(raw: unknown, takenIds: Set<string>): FixtureConfig {
        const result = normalizeFixture(raw, allTypes(this.config), takenIds, defaultPosition(this.config));
        if (typeof result === 'string') {
            const name = (raw as {name?: string}).name;
            throw new Error(name ? `"${name}": ${result}` : result);
        }
        return result;
    }

    /** "Front" -> "Front 9" when "Front 1".."Front 8" exist. */
    private nextName(base: string): string {
        const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
        let max = 0;
        for (const f of this.config.fixtures) {
            const m = pattern.exec(f.name);
            if (m) max = Math.max(max, Number(m[1]));
        }
        return `${base} ${max + 1}`;
    }

    /** Write the rig file now (also happens automatically shortly after each change). */
    public save(): boolean {
        if (!this.options.configPath) return false;
        try {
            saveConfigFile(this.options.configPath, this.config);
            return true;
        } catch (err) {
            this.log('error', `Could not save ${this.options.configPath}: ${(err as Error).message}`);
            return false;
        }
    }

    // ---- internals --------------------------------------------------------

    private nextFreeAddress(universe: number): number {
        let end = 0;
        for (const f of this.config.fixtures) {
            if (f.universe === universe) end = Math.max(end, f.address - 1 + footprintOf(this.config, f));
        }
        return end + 1;
    }

    private nextFreeY(): number {
        const types = allTypes(this.config);
        let bottom = 0;
        for (const f of this.config.fixtures) {
            const type = types[f.type]!;
            bottom = Math.max(bottom, f.y + fixtureSize(type, resolveLayout(type, f.cells).cells, f.scale).h / 2);
        }
        return bottom === 0 ? mainStageRect(this.config).top + 40 : bottom + 40;
    }

    private changed(message?: string): void {
        this.rebuild();
        if (message) this.log('info', message);
        this.emit('config', this.config);
        if (this.options.configPath) {
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => {
                this.saveTimer = undefined;
                this.save();
            }, 400);
        }
    }

    /** Sync sockets and RDM responders with the current rig. */
    private rebuild(): void {
        const universes = this.universes;
        this.sacn?.setUniverses(universes);
        this.artnet?.setUniverses(universes);

        const types = allTypes(this.config);
        const keep = new Set<string>();
        for (const fixture of this.config.fixtures) {
            if (fixture.rdm === false || !fixture.uid) continue;
            keep.add(fixture.id);
            const signature = responderSignature(fixture);
            const existing = this.responders.get(fixture.id);
            if (existing?.signature === signature) continue;
            const type = types[fixture.type]!;
            const responder = new RdmResponder({
                uid: uidFromString(fixture.uid),
                manufacturerLabel: 'node-dmx simulator',
                deviceModelDescription: type.name.substring(0, 32),
                deviceModelId: modelIdOf(fixture.type),
                softwareVersionLabel: 'simulator',
                deviceLabel: fixture.name.substring(0, 32),
                dmxStartAddress: fixture.address,
                personalities: [{footprint: resolveLayout(type, fixture.cells).footprint, description: type.name.substring(0, 32)}],
                onIdentifyChange: (on) => this.setIdentify(fixture.id, on),
                onDmxStartAddressChange: (address) => this.onRdmAddress(fixture.id, address),
                onDeviceLabelChange: (label) => this.onRdmLabel(fixture.id, label),
            });
            this.responders.set(fixture.id, {responder, signature});
        }
        for (const id of this.responders.keys()) if (!keep.has(id)) this.responders.delete(id);

        this.artnet?.setDevices(this.config.fixtures
            .filter((f) => this.responders.has(f.id))
            .map((f) => ({universe: f.universe, name: f.name, responder: this.responders.get(f.id)!.responder})));
    }

    private setIdentify(id: string, on: boolean): void {
        if (on) this.identifying.add(id);
        else this.identifying.delete(id);
        const f = this.config.fixtures.find((x) => x.id === id);
        this.log('info', `RDM: identify ${on ? 'ON' : 'off'} for "${f?.name ?? id}"`);
        this.emit('identify', id, on);
    }

    private onRdmAddress(id: string, address: number): void {
        const fixture = this.config.fixtures.find((f) => f.id === id);
        if (!fixture) return;
        const footprint = footprintOf(this.config, fixture);
        if (address - 1 + footprint > 512) {
            this.log('warn', `RDM: "${fixture.name}" set to address ${address}, but its ${footprint} channels run past 512`);
        }
        this.log('info', `RDM: "${fixture.name}" readdressed from ${fixture.address} to ${address}`);
        fixture.address = address;
        // Keep the live responder (and its identify/mute state) instead of rebuilding it.
        const entry = this.responders.get(id);
        if (entry) entry.signature = responderSignature(fixture);
        this.changed();
    }

    private onRdmLabel(id: string, label: string): void {
        const fixture = this.config.fixtures.find((f) => f.id === id);
        if (!fixture) return;
        this.log('info', `RDM: "${fixture.name}" renamed to "${label}"`);
        fixture.name = label || fixture.name;
        const entry = this.responders.get(id);
        if (entry) entry.signature = responderSignature(fixture);
        this.changed();
    }

    private onRdm(entry: RdmLogEntry): void {
        this.emit('rdm', entry);
        if (entry.command === 'SET' || entry.pid === 'DISC_UNIQUE_BRANCH') return; // SETs are logged by their effect
        if (entry.pid === 'DISC_MUTE' || entry.pid === 'DISC_UN_MUTE') return;
        const who = entry.answeredBy ? `answered by "${entry.answeredBy}"` : 'no fixture answered';
        this.log('info', `RDM ${entry.command} ${entry.pid} on U${entry.universe} from ${entry.from} (${who})`);
    }

    private onInputFrame(protocol: 'sacn' | 'artnet', universe: number, data: Uint8Array | null): void {
        const frames = this.inputFrames[protocol];
        if (data) frames.set(universe, data);
        else frames.delete(universe);

        const a = this.inputFrames.sacn.get(universe);
        const b = this.inputFrames.artnet.get(universe);
        let out: Uint8Array;
        if (a && b) {
            out = new Uint8Array(512);
            for (let i = 0; i < 512; i++) out[i] = Math.max(a[i]!, b[i]!);
        } else {
            const only = a ?? b;
            out = only ? new Uint8Array(only) : new Uint8Array(512);
        }
        this.output.set(universe, out);
        this.emit('frame', universe, out);
    }

    private inputError(protocol: 'sacn' | 'artnet', err: Error): void {
        const code = (err as NodeJS.ErrnoException).code;
        const port = this.network[protocol].port;
        let hint = '';
        if (code === 'EADDRINUSE') hint = ` Port ${port} is in use by another program. Close it, or start the simulator with --${protocol === 'sacn' ? 'no-sacn' : 'no-artnet'}.`;
        else if (code === 'EADDRNOTAVAIL') hint = ' That IP address is not on this computer. Run "npm run example/list-network-interfaces" to see yours.';
        this.status[protocol] = {...this.status[protocol], listening: false, error: err.message};
        this.log('error', `${protocol === 'sacn' ? 'sACN' : 'Art-Net'}: ${err.message}.${hint}`);
    }

    private log(level: LogEntry['level'], message: string): void {
        const entry = {time: Date.now(), level, message};
        this.logs.push(entry);
        if (this.logs.length > MAX_LOG) this.logs.splice(0, this.logs.length - MAX_LOG);
        this.emit('log', entry);
    }
}

function responderSignature(f: FixtureConfig): string {
    return [f.uid, f.type, f.cells, f.universe, f.address, f.name].join('|');
}

/** Stable 16-bit model id per fixture type, so RDM DEVICE_INFO distinguishes types. */
function modelIdOf(typeKey: string): number {
    let hash = 0;
    for (const ch of slugify(typeKey)) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
    return hash || 1;
}
