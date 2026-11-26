/**
 * Fixture type library for the simulator.
 *
 * A fixture type describes which DMX channel does what. The simulator uses
 * this to turn raw channel bytes into something it can draw (colour, beam
 * direction, strobe), and to tell you which fixture owns which channel.
 *
 * You can add your own types in the rig file under `fixtureTypes`, using the
 * same shape as the built-ins below.
 */

/**
 * What a channel controls. Unknown names are allowed (for example `"macro"`
 * or `"speed"`): they take up a channel and show their raw value, but do not
 * change how the fixture is drawn.
 */
export const KNOWN_ROLES = [
    'dimmer', 'dimmerFine',
    'red', 'green', 'blue', 'white', 'warmWhite', 'coolWhite', 'amber', 'uv', 'lime',
    'cyan', 'magenta', 'yellow',
    'pan', 'panFine', 'tilt', 'tiltFine',
    'strobe', 'zoom',
] as const;

export type KnownRole = (typeof KNOWN_ROLES)[number];

/** How a fixture is drawn on the stage. */
export type FixtureShape = 'par' | 'bar' | 'strip' | 'head';

export type FixtureTypeDef = {
    /** Display name, e.g. "RGBWW Par (5ch)". */
    name: string;
    /** How the fixture is drawn. Default `par`. */
    shape?: FixtureShape;
    /** Channels that apply to the whole fixture, in DMX order. */
    channels?: string[];
    /**
     * Channels repeated once per cell (pixel / segment), placed after
     * `channels`. Use this for LED bars and pixel strips.
     */
    cell?: string[];
    /** Default number of cells. A fixture can override it with `cells`. Default 1 when `cell` is set. */
    cells?: number;
    /** Optional note shown in the UI, e.g. which library plugin it matches. */
    description?: string;
};

export const BUILT_IN_TYPES: Record<string, FixtureTypeDef> = {
    dimmer: {
        name: 'Dimmer (1ch)',
        shape: 'par',
        channels: ['dimmer'],
        description: 'A single warm-white dimmer channel.',
    },
    rgb: {
        name: 'RGB Par (3ch)',
        shape: 'par',
        channels: ['red', 'green', 'blue'],
    },
    rgbw: {
        name: 'RGBW Par (4ch)',
        shape: 'par',
        channels: ['red', 'green', 'blue', 'white'],
    },
    drgb: {
        name: 'Dimmer + RGB Par (4ch)',
        shape: 'par',
        channels: ['dimmer', 'red', 'green', 'blue'],
        description: 'Same layout as the library\'s RGBDimmerFixture ("4ch").',
    },
    rgbww: {
        name: 'RGBWW Par (5ch)',
        shape: 'par',
        channels: ['red', 'green', 'blue', 'warmWhite', 'coolWhite'],
        description: 'Same layout as the library\'s RGBWW5Fixture ("5ch") and the sACN examples.',
    },
    drgbs: {
        name: 'Dimmer + RGB + Strobe Par (5ch)',
        shape: 'par',
        channels: ['dimmer', 'red', 'green', 'blue', 'strobe'],
    },
    rgbawuv: {
        name: 'RGBAW+UV Par (6ch)',
        shape: 'par',
        channels: ['red', 'green', 'blue', 'amber', 'white', 'uv'],
    },
    'moving-head': {
        name: 'Moving Head (11ch)',
        shape: 'head',
        channels: ['pan', 'panFine', 'tilt', 'tiltFine', 'dimmer', 'strobe', 'red', 'green', 'blue', 'white', 'zoom'],
        description: '16-bit pan/tilt, dimmer, strobe, RGBW and zoom.',
    },
    'led-bar': {
        name: 'LED Bar, 8 RGB cells (24ch)',
        shape: 'bar',
        cell: ['red', 'green', 'blue'],
        cells: 8,
    },
    'pixel-strip': {
        name: 'RGB Pixel Strip (3ch per pixel)',
        shape: 'strip',
        cell: ['red', 'green', 'blue'],
        cells: 50,
        description: 'Set "cells" on the fixture to change the pixel count (max 170 per universe).',
    },
};

/** Resolved, ready-to-use fixture layout. */
export type ResolvedLayout = {
    channels: string[];
    cell: string[];
    cells: number;
    footprint: number;
};

/** Work out the channel layout and footprint for a type (plus optional per-fixture cell count). */
export function resolveLayout(type: FixtureTypeDef, cellsOverride?: number): ResolvedLayout {
    const channels = type.channels ?? [];
    const cell = type.cell ?? [];
    const cells = cell.length > 0 ? (cellsOverride ?? type.cells ?? 1) : 0;
    return {channels, cell, cells, footprint: channels.length + cell.length * cells};
}

/** Name of the channel at a 0-based offset inside the fixture's footprint. */
export function channelRoleAt(layout: ResolvedLayout, offset: number): {role: string; cell?: number} | undefined {
    if (offset < 0 || offset >= layout.footprint) return undefined;
    if (offset < layout.channels.length) return {role: layout.channels[offset]!};
    const rest = offset - layout.channels.length;
    const cellIndex = Math.floor(rest / layout.cell.length);
    return {role: layout.cell[rest % layout.cell.length]!, cell: cellIndex + 1};
}

/**
 * Decoded fixture values, normalised to 0..1. Each cell of a bar/strip has
 * its own entry in `cells`; global channels are in `values`.
 */
export type DecodedFixture = {
    values: Record<string, number>;
    cells: Array<Record<string, number>>;
};

/**
 * Read a fixture's channels out of a universe frame. 16-bit pairs
 * (`pan` + `panFine`, `dimmer` + `dimmerFine`, ...) are combined.
 */
export function decodeFixture(layout: ResolvedLayout, frame: Uint8Array, address: number): DecodedFixture {
    const base = address - 1;
    const read = (roles: string[], offset: number): Record<string, number> => {
        const raw: Record<string, number> = {};
        roles.forEach((role, i) => {
            raw[role] = frame[base + offset + i] ?? 0;
        });
        const out: Record<string, number> = {};
        for (const [role, value] of Object.entries(raw)) {
            if (role.endsWith('Fine')) continue;
            const fine = raw[`${role}Fine`];
            out[role] = fine === undefined ? value / 255 : ((value << 8) | fine) / 65535;
        }
        return out;
    };

    const values = read(layout.channels, 0);
    const cells: Array<Record<string, number>> = [];
    for (let c = 0; c < layout.cells; c++) {
        cells.push(read(layout.cell, layout.channels.length + c * layout.cell.length));
    }
    return {values, cells};
}

/** Size of a fixture on the stage, in stage units. Shared by the server (auto-arrange) and the UI. */
export function fixtureSize(type: FixtureTypeDef, cells: number, scale = 1): {w: number; h: number} {
    const base = baseSize(type, cells);
    return scale === 1 ? base : {w: base.w * scale, h: base.h * scale};
}

/** Smallest and largest fixture scale. */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 8;

function baseSize(type: FixtureTypeDef, cells: number): {w: number; h: number} {
    switch (type.shape ?? 'par') {
        case 'head':
            return {w: 76, h: 76};
        case 'bar':
            return {w: Math.min(cells * 26, 600) + 12, h: 34};
        case 'strip':
            return {w: Math.min(cells * 10, 1000) + 12, h: 22};
        default:
            return {w: 60, h: 60};
    }
}
