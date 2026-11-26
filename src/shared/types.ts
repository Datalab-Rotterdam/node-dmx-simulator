/**
 * Types shared by the simulator server and the web UI.
 *
 * Keep this file free of Node.js imports: the browser build imports it too.
 */
import type {FixtureShape, FixtureTypeDef, ResolvedLayout} from '../fixture-types';

export type {FixtureShape, FixtureTypeDef, ResolvedLayout};

export type FixtureConfig = {
    /** Unique id, used by the API and the UI. Generated from the name when omitted. */
    id: string;
    /** Label shown on the stage. Also the RDM device label. */
    name: string;
    /** Key of a built-in type or one from `fixtureTypes`. */
    type: string;
    /** 1-based universe (same numbering as `DMXController`). */
    universe: number;
    /** DMX start address, 1-512. */
    address: number;
    /** Position on the stage (centre of the fixture). */
    x: number;
    y: number;
    /** Rotation in degrees (bars and strips). */
    rotation?: number;
    /** Drawing size relative to the type's normal size (1 = 100%). Only affects the drawing, not DMX. */
    scale?: number;
    /** Cell/pixel count override for bars and strips. */
    cells?: number;
    /** Answer RDM over Art-Net. Default true. */
    rdm?: boolean;
    /** RDM UID as "mmmm:dddddddd". Assigned automatically when omitted. */
    uid?: string;
};

// ---- shapes: the stage, trusses, roofs... drawn on the canvas -----------------

export const SHAPE_KINDS = ['stage', 'truss', 'roof', 'area', 'label'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** A shape on the canvas. Position is the centre, like fixtures. */
export type ShapeConfig = {
    id: string;
    kind: ShapeKind;
    /** Shown on the shape (the text itself for labels). */
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Degrees. */
    rotation?: number;
    /** CSS colour, e.g. "#3b82f6". Areas and labels use it. */
    color?: string;
};

/** Default size and name per kind, used when adding shapes. */
export const SHAPE_DEFAULTS: Record<ShapeKind, {name: string; width: number; height: number; color?: string}> = {
    stage: {name: 'Stage', width: 1200, height: 700},
    truss: {name: 'Truss', width: 600, height: 24},
    roof: {name: 'Roof', width: 1300, height: 800},
    area: {name: 'Audience', width: 500, height: 300, color: '#3b82f6'},
    label: {name: 'Label', width: 240, height: 48},
};

export type ShapeUpdate = {id: string} & Partial<Omit<ShapeConfig, 'id' | 'rotation' | 'color'>> & {rotation?: number | null; color?: string | null};

export type AddShapeRequest = {kind: ShapeKind} & Partial<Omit<ShapeConfig, 'id' | 'kind'>>;

/** Fixtures and shapes, for edits that act on both at once (one undo step). */
export type ItemIds = {fixtures?: string[]; shapes?: string[]};
export type ItemUpdates = {fixtures?: FixtureUpdate[]; shapes?: ShapeUpdate[]};

export type RigConfig = {
    name: string;
    /** The stage, trusses, roofs and other shapes drawn under the fixtures. */
    shapes: ShapeConfig[];
    sacn: {
        enabled: boolean;
        /** IPv4 address of the network card used to join multicast groups. */
        iface?: string;
        port: number;
    };
    artnet: {
        enabled: boolean;
        /** Local address to bind. Default all interfaces. */
        bindAddress?: string;
        port: number;
        /** Name shown to Art-Net discovery (max 17 chars). */
        shortName: string;
        /** Drop a silent Art-Net source after this long. Default 10 s (Art-Net 4 merge timeout). */
        sourceTimeoutMs: number;
    };
    /** Extra universes to listen to even if no fixture is patched there. */
    monitorUniverses: number[];
    /** Your own fixture types, same shape as the built-ins. */
    fixtureTypes: Record<string, FixtureTypeDef>;
    fixtures: FixtureConfig[];
};

export type LogEntry = {time: number; level: 'info' | 'warn' | 'error'; message: string};

export type InputStatus = {enabled: boolean; listening: boolean; detail: string; error?: string};

export type StatusSnapshot = {sacn: InputStatus; artnet: InputStatus & {syncMode: boolean}};

export type SourceSnapshot = {
    key: string;
    protocol: 'sacn' | 'artnet';
    /** sACN source name, or "Art-Net" for Art-Net senders. */
    name: string;
    /** Sender IP (and port for Art-Net). */
    address?: string;
    /** sACN CID (hex) or Art-Net "ip:port". */
    id: string;
    universes: number[];
    /** Universes announced via sACN Universe Discovery. */
    announced?: number[];
    priority?: number;
    syncUniverse?: number;
    preview?: boolean;
    /** Data packets per second over the last few seconds. */
    packetsPerSecond: number;
    totalPackets: number;
    lastSeenMs: number;
    status: 'active' | 'lost';
    lostReason?: string;
};

// ---- API requests -----------------------------------------------------------

export type AddFixturesRequest = {
    type: string;
    count?: number;
    universe?: number;
    /** First address. Default: the first free address after the last fixture in that universe. */
    address?: number;
    name?: string;
    cells?: number;
    /** Top-left of the group. Default: below the existing fixtures. */
    x?: number;
    y?: number;
    layout?: 'row' | 'column' | 'grid';
    columns?: number;
};

/** A change to one fixture; only the given fields change. `cells: null` resets to the type's default, `scale: null` to 100%. */
export type FixtureUpdate = {id: string} & Partial<Omit<FixtureConfig, 'id' | 'cells' | 'scale'>> & {cells?: number | null; scale?: number | null};

export type ReaddressRequest = {
    /** Fixtures in the order they should be patched. */
    ids: string[];
    universe: number;
    address: number;
};

// ---- what the UI receives ---------------------------------------------------

export type UiFixture = FixtureConfig & {
    typeName: string;
    shape: FixtureShape;
    layout: ResolvedLayout;
    size: {w: number; h: number};
    identify: boolean;
    issues: string[];
};

export type UiFixtureType = FixtureTypeDef & {footprint: number; custom: boolean};

export type HistoryState = {canUndo: boolean; canRedo: boolean; undoLabel?: string; redoLabel?: string};

export type UiState = {
    rig: {name: string; monitorUniverses: number[]};
    shapes: ShapeConfig[];
    fixtures: UiFixture[];
    types: Record<string, UiFixtureType>;
    universes: number[];
    bundledRigs: string[];
    readonly: boolean;
    configPath: string | null;
    network: Pick<RigConfig, 'sacn' | 'artnet'>;
    addresses: Array<{name: string; address: string}>;
    history: HistoryState;
};

/** Server-Sent Events sent on /api/events. */
export type ServerEvents = {
    state: UiState;
    /** Changed universes: base64-encoded 512-byte frames. */
    dmx: Record<string, string>;
    sources: {sources: SourceSnapshot[]; status: StatusSnapshot};
    history: LogEntry[];
    log: LogEntry;
    identify: {id: string; on: boolean};
};

// ---- the bridge between the web UI's server routes and the simulator ---------

/** `/api/state`: the rig plus everything else the UI shows. */
export type FullState = UiState & {sources: SourceSnapshot[]; status: StatusSnapshot; log: LogEntry[]};

export type EventSender = <E extends keyof ServerEvents>(event: E, data: ServerEvents[E]) => void;

export type RigPatch = {name?: string; monitorUniverses?: number[]};

/**
 * What the SvelteKit server routes (ui/src/routes/api) can do with the
 * running simulator. Implemented by SimulatorHost (web/host.ts), which the
 * simulator registers on `globalThis` before it starts the web server.
 */
export interface SimulatorBridge {
    readonly readonly: boolean;
    state(): FullState;
    /** One universe's 512 channel values. */
    channels(universe: number): number[];
    /** Send the current state, then live events, to `send`. Returns an unsubscribe function. */
    subscribe(send: EventSender, ping: () => void): () => void;

    addFixtures(req: AddFixturesRequest): string[];
    updateFixtures(updates: FixtureUpdate[]): FixtureConfig[];
    removeFixtures(ids: string[]): void;
    duplicateFixtures(ids: string[], offset: {dx: number; dy: number}): string[];

    addShape(req: AddShapeRequest): string;
    /** Change fixtures and shapes together (e.g. moving a mixed selection). */
    updateItems(updates: ItemUpdates): void;
    removeItems(ids: ItemIds): void;
    duplicateItems(ids: ItemIds, offset: {dx: number; dy: number}): Required<ItemIds>;
    readdress(req: ReaddressRequest): FixtureConfig[];
    arrange(ids?: string[]): void;
    updateRig(patch: RigPatch): void;
    /** Replace the rig with a bundled one (undoable). */
    loadBundledRig(name: string): void;
    undo(): boolean;
    redo(): boolean;
}

/** Key under which the simulator registers its SimulatorBridge on `globalThis`. */
export const BRIDGE_KEY = Symbol.for('node-dmx.simulator.bridge');
