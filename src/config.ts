/**
 * Rig file: which fixtures exist, where they are patched and where they sit
 * on the stage. Stored as plain JSON so it is easy to edit by hand, share
 * with classmates and keep in git.
 */
import {existsSync, readFileSync, renameSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';

import {uidFromString, uidToString} from 'node-dmx';
import {RIGS_DIR} from './paths';
import {BUILT_IN_TYPES, KNOWN_ROLES, SCALE_MAX, SCALE_MIN, resolveLayout, type FixtureShape, type FixtureTypeDef} from './fixture-types';
import {SHAPE_DEFAULTS, SHAPE_KINDS, type FixtureConfig, type RigConfig, type ShapeConfig, type ShapeKind} from './shared/types';

/** RDM manufacturer id used for automatically assigned fixture UIDs. */
export const SIM_MANUFACTURER_ID = 0x7a70;

export type {FixtureConfig, RigConfig, ShapeConfig} from './shared/types';

export class ConfigError extends Error {
    constructor(public readonly problems: string[]) {
        super(`Rig file has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
        this.name = 'ConfigError';
    }
}

const SHAPES: FixtureShape[] = ['par', 'bar', 'strip', 'head'];
const MAX_UNIVERSE = 63999;

export {RIGS_DIR};

export function listBundledRigs(): string[] {
    return ['examples', 'classroom', 'pixels', 'empty'];
}

/** All fixture types available to a rig (built-ins plus the rig's own). */
export function allTypes(config: Pick<RigConfig, 'fixtureTypes'>): Record<string, FixtureTypeDef> {
    return {...BUILT_IN_TYPES, ...config.fixtureTypes};
}

export function footprintOf(config: Pick<RigConfig, 'fixtureTypes'>, fixture: Pick<FixtureConfig, 'type' | 'cells'>): number {
    const type = allTypes(config)[fixture.type];
    return type ? resolveLayout(type, fixture.cells).footprint : 0;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fixture';
}

/**
 * Validate and fill in defaults for a parsed rig file. Throws a
 * {@link ConfigError} listing every problem (not just the first), so
 * students can fix their file in one go.
 */
export function normalizeConfig(input: unknown): RigConfig {
    const problems: string[] = [];
    const raw = isObject(input) ? input : {};
    if (!isObject(input)) problems.push('the rig file must contain a JSON object');

    const stageRaw = isObject(raw.stage) ? raw.stage : {};
    const sacnRaw = isObject(raw.sacn) ? raw.sacn : {};
    const artRaw = isObject(raw.artnet) ? raw.artnet : {};

    const config: RigConfig = {
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'My rig',
        shapes: [],
        sacn: {
            enabled: sacnRaw.enabled !== false,
            iface: typeof sacnRaw.iface === 'string' && sacnRaw.iface ? sacnRaw.iface : undefined,
            port: isInt(sacnRaw.port, 1, 65535) ? sacnRaw.port : 5568,
        },
        artnet: {
            enabled: artRaw.enabled !== false,
            bindAddress: typeof artRaw.bindAddress === 'string' && artRaw.bindAddress ? artRaw.bindAddress : undefined,
            port: isInt(artRaw.port, 1, 65535) ? artRaw.port : 6454,
            shortName: typeof artRaw.shortName === 'string' && artRaw.shortName ? artRaw.shortName.substring(0, 17) : 'node-dmx sim',
            sourceTimeoutMs: isInt(artRaw.sourceTimeoutMs, 0, 3_600_000) ? artRaw.sourceTimeoutMs : 10_000,
        },
        monitorUniverses: [],
        fixtureTypes: {},
        fixtures: [],
    };

    if (raw.shapes !== undefined) {
        if (!Array.isArray(raw.shapes)) {
            problems.push('shapes must be a list, e.g. [{"kind": "stage", "x": 600, "y": 350, "width": 1200, "height": 700}]');
        } else {
            const ids = new Set<string>();
            raw.shapes.forEach((s, i) => {
                const result = normalizeShape(s, ids);
                if (typeof result === 'string') problems.push(`shapes[${i}]: ${result}`);
                else {
                    ids.add(result.id);
                    config.shapes.push(result);
                }
            });
        }
    } else {
        // Older rig files have a fixed stage size instead of shapes: turn it into a stage shape.
        const width = isInt(stageRaw.width, 200, 20000) ? stageRaw.width : 1200;
        const height = isInt(stageRaw.height, 200, 20000) ? stageRaw.height : 700;
        config.shapes.push({id: 'stage', kind: 'stage', name: 'Stage', x: width / 2, y: height / 2, width, height});
    }

    if (raw.monitorUniverses !== undefined) {
        if (!Array.isArray(raw.monitorUniverses)) {
            problems.push('monitorUniverses must be a list of universe numbers, e.g. [1, 2]');
        } else {
            raw.monitorUniverses.forEach((u, i) => {
                if (isInt(u, 1, MAX_UNIVERSE)) config.monitorUniverses.push(u);
                else problems.push(`monitorUniverses[${i}] must be a universe number 1-${MAX_UNIVERSE}, got ${JSON.stringify(u)}`);
            });
        }
    }

    if (raw.fixtureTypes !== undefined) {
        if (!isObject(raw.fixtureTypes)) {
            problems.push('fixtureTypes must be an object like {"my-par": {"name": "...", "channels": ["red", "green", "blue"]}}');
        } else {
            for (const [key, def] of Object.entries(raw.fixtureTypes)) {
                const typeProblems = validateType(def);
                if (typeProblems.length) problems.push(...typeProblems.map((p) => `fixtureTypes["${key}"]: ${p}`));
                else config.fixtureTypes[key] = def as FixtureTypeDef;
            }
        }
    }

    const fixturesRaw = raw.fixtures === undefined ? [] : raw.fixtures;
    if (!Array.isArray(fixturesRaw)) {
        problems.push('fixtures must be a list');
    } else {
        const types = allTypes(config);
        const ids = new Set<string>();
        const fallback = defaultPosition(config);
        fixturesRaw.forEach((f, i) => {
            const where = `fixtures[${i}]${isObject(f) && typeof f.name === 'string' ? ` ("${f.name}")` : ''}`;
            const result = normalizeFixture(f, types, ids, fallback);
            if (typeof result === 'string') problems.push(`${where}: ${result}`);
            else {
                ids.add(result.id);
                config.fixtures.push(result);
            }
        });
    }

    if (problems.length) throw new ConfigError(problems);
    assignMissingUids(config);
    return config;
}

function validateType(def: unknown): string[] {
    if (!isObject(def)) return ['must be an object'];
    const problems: string[] = [];
    if (typeof def.name !== 'string' || !def.name) problems.push('needs a "name"');
    if (def.shape !== undefined && !SHAPES.includes(def.shape as FixtureShape)) {
        problems.push(`shape must be one of ${SHAPES.join(', ')}`);
    }
    for (const key of ['channels', 'cell'] as const) {
        const list = def[key];
        if (list === undefined) continue;
        if (!Array.isArray(list) || list.some((c) => typeof c !== 'string' || !c)) {
            problems.push(`${key} must be a list of channel names, e.g. ["dimmer", "red", "green", "blue"]`);
        }
    }
    if (def.cells !== undefined && !isInt(def.cells, 1, 512)) problems.push('cells must be 1-512');
    const layout = resolveLayout(def as FixtureTypeDef);
    if (layout.footprint === 0) problems.push('needs at least one channel in "channels" or "cell"');
    if (layout.footprint > 512) problems.push(`uses ${layout.footprint} channels, but a universe only has 512`);
    return problems;
}

/** The first stage shape (or the first shape), as left/top/width/height. Default 1200 x 700 at 0, 0. */
export function mainStageRect(config: Pick<RigConfig, 'shapes'>): {left: number; top: number; width: number; height: number} {
    const s = config.shapes.find((shape) => shape.kind === 'stage') ?? config.shapes.find((shape) => shape.kind !== 'label');
    return s ? {left: s.x - s.width / 2, top: s.y - s.height / 2, width: s.width, height: s.height} : {left: 0, top: 0, width: 1200, height: 700};
}

/** Where a fixture without a position goes: the middle of the stage. */
export function defaultPosition(config: Pick<RigConfig, 'shapes'>): {x: number; y: number} {
    const r = mainStageRect(config);
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
}

/** Validate one shape. Returns the normalized shape or a problem description. */
export function normalizeShape(input: unknown, takenIds: Set<string>): ShapeConfig | string {
    if (!isObject(input)) return 'must be an object';
    const kind = input.kind as ShapeKind;
    if (!SHAPE_KINDS.includes(kind)) return `kind must be one of ${SHAPE_KINDS.join(', ')}, got ${JSON.stringify(input.kind)}`;
    const defaults = SHAPE_DEFAULTS[kind];
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    for (const key of ['width', 'height'] as const) {
        if (input[key] !== undefined && !(typeof input[key] === 'number' && input[key] >= 1 && input[key] <= 20000)) {
            return `${key} must be a number 1-20000, got ${JSON.stringify(input[key])}`;
        }
    }
    if (input.color !== undefined && input.color !== null && typeof input.color !== 'string') return 'color must be a CSS colour like "#3b82f6"';

    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : defaults.name;
    let id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : slugify(name);
    if (takenIds.has(id)) {
        if (typeof input.id === 'string' && input.id.trim()) return `id "${id}" is used twice`;
        let n = 2;
        while (takenIds.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
    }
    const shape: ShapeConfig = {
        id,
        kind,
        name,
        x: Math.round(num(input.x, defaults.width / 2)),
        y: Math.round(num(input.y, defaults.height / 2)),
        width: Math.round(num(input.width, defaults.width)),
        height: Math.round(num(input.height, defaults.height)),
    };
    const rotation = num(input.rotation, 0) % 360;
    if (rotation) shape.rotation = rotation;
    if (typeof input.color === 'string' && input.color.trim()) shape.color = input.color.trim();
    return shape;
}

/** Validate one fixture. Returns the normalized fixture or a problem description. */
export function normalizeFixture(
    input: unknown,
    types: Record<string, FixtureTypeDef>,
    takenIds: Set<string>,
    fallback: {x: number; y: number} = {x: 600, y: 350},
): FixtureConfig | string {
    if (!isObject(input)) return 'must be an object';
    const typeKey = input.type;
    if (typeof typeKey !== 'string' || !types[typeKey]) {
        return `unknown type ${JSON.stringify(typeKey)}. Available: ${Object.keys(types).join(', ')}`;
    }
    const type = types[typeKey]!;
    if (!isInt(input.universe, 1, MAX_UNIVERSE)) return `universe must be 1-${MAX_UNIVERSE}, got ${JSON.stringify(input.universe)}`;
    if (!isInt(input.address, 1, 512)) return `address must be 1-512, got ${JSON.stringify(input.address)}`;
    if (input.cells !== undefined && !isInt(input.cells, 1, 512)) return 'cells must be a whole number 1-512';
    if (input.cells !== undefined && !type.cell?.length) return `type "${typeKey}" has no cells, remove "cells"`;
    if (input.scale !== undefined && !(typeof input.scale === 'number' && input.scale >= SCALE_MIN && input.scale <= SCALE_MAX)) {
        return `scale must be a number from ${SCALE_MIN} to ${SCALE_MAX} (1 is normal size), got ${JSON.stringify(input.scale)}`;
    }
    const footprint = resolveLayout(type, input.cells as number | undefined).footprint;
    if (input.address - 1 + footprint > 512) {
        return `address ${input.address} + ${footprint} channels runs past channel 512 (last valid address is ${513 - footprint})`;
    }
    if (input.uid !== undefined) {
        try {
            uidFromString(String(input.uid));
        } catch {
            return `uid must look like "7a70:00000001", got ${JSON.stringify(input.uid)}`;
        }
    }

    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : type.name;
    let id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : slugify(name);
    if (takenIds.has(id)) {
        if (typeof input.id === 'string' && input.id.trim()) return `id "${id}" is used twice`;
        let n = 2;
        while (takenIds.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
    }

    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const fixture: FixtureConfig = {
        id,
        name,
        type: typeKey,
        universe: input.universe,
        address: input.address,
        x: Math.round(num(input.x, fallback.x)),
        y: Math.round(num(input.y, fallback.y)),
    };
    if (input.rotation !== undefined) fixture.rotation = num(input.rotation, 0);
    if (input.scale !== undefined && input.scale !== 1) fixture.scale = Math.round((input.scale as number) * 100) / 100;
    if (input.cells !== undefined) fixture.cells = input.cells as number;
    if (input.rdm === false) fixture.rdm = false;
    if (input.uid !== undefined) fixture.uid = uidToString(uidFromString(String(input.uid)));
    return fixture;
}

/** Give every fixture without a UID a unique one (persisted on the next save). */
export function assignMissingUids(config: RigConfig): void {
    const used = new Set(config.fixtures.filter((f) => f.uid).map((f) => f.uid!));
    let next = 1;
    for (const fixture of config.fixtures) {
        if (fixture.uid) continue;
        let uid: string;
        do {
            uid = uidToString({manufacturerId: SIM_MANUFACTURER_ID, deviceId: next++});
        } while (used.has(uid));
        used.add(uid);
        fixture.uid = uid;
    }
}

export type PatchIssue = {fixtureId: string; message: string};

/** Find overlapping fixtures and duplicate UIDs. These are warnings, not errors: real rigs have them too. */
export function findPatchIssues(config: RigConfig): PatchIssue[] {
    const issues: PatchIssue[] = [];
    const byUniverse = new Map<number, FixtureConfig[]>();
    for (const f of config.fixtures) {
        const list = byUniverse.get(f.universe) ?? [];
        list.push(f);
        byUniverse.set(f.universe, list);
    }
    for (const list of byUniverse.values()) {
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i]!;
                const b = list[j]!;
                const aEnd = a.address + footprintOf(config, a) - 1;
                const bEnd = b.address + footprintOf(config, b) - 1;
                if (a.address <= bEnd && b.address <= aEnd) {
                    const msg = `overlaps "${b.name}" (U${b.universe} ${b.address}-${bEnd})`;
                    issues.push({fixtureId: a.id, message: msg});
                    issues.push({fixtureId: b.id, message: `overlaps "${a.name}" (U${a.universe} ${a.address}-${aEnd})`});
                }
            }
        }
    }
    const seen = new Map<string, string>();
    for (const f of config.fixtures) {
        if (!f.uid || f.rdm === false) continue;
        const other = seen.get(f.uid);
        if (other) issues.push({fixtureId: f.id, message: `has the same RDM UID as "${other}"`});
        else seen.set(f.uid, f.name);
    }
    return issues;
}

/** Read a rig file. Errors mention the file path and every problem found. */
export function loadConfigFile(path: string): RigConfig {
    const text = readFileSync(path, 'utf8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw new ConfigError([`${path} is not valid JSON: ${(err as Error).message}`]);
    }
    try {
        return normalizeConfig(parsed);
    } catch (err) {
        if (err instanceof ConfigError) throw new ConfigError(err.problems.map((p) => `${path}: ${p}`));
        throw err;
    }
}

/** Load a bundled rig ("examples", "classroom", ...). */
export function loadBundledRig(name: string): RigConfig {
    const path = join(RIGS_DIR, `${name}.json`);
    if (!existsSync(path)) {
        throw new ConfigError([`unknown rig "${name}". Bundled rigs: ${listBundledRigs().join(', ')}`]);
    }
    return loadConfigFile(path);
}

/** Write the rig as pretty JSON. Writes a temp file first so a crash never leaves half a file. */
export function saveConfigFile(path: string, config: RigConfig): void {
    const target = resolve(path);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    renameSync(tmp, target);
}

export const CHANNEL_ROLE_HINT = `Known channel names: ${KNOWN_ROLES.join(', ')}. Other names are allowed and just show their value.`;
