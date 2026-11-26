/**
 * Turns decoded channel values (0..1 by channel name) into what a fixture
 * looks like on screen.
 */

export type Rgb = {r: number; g: number; b: number};
export type Look = Rgb & {level: number};

const COLOR_ROLES = ['red', 'green', 'blue', 'white', 'warmWhite', 'coolWhite', 'amber', 'uv', 'lime', 'cyan', 'magenta', 'yellow'];

/** How much red/green/blue each colour channel adds at full. */
const EMITTERS: Record<string, Rgb> = {
    red: {r: 1, g: 0, b: 0},
    green: {r: 0, g: 1, b: 0},
    blue: {r: 0, g: 0, b: 1},
    white: {r: 1, g: 1, b: 1},
    warmWhite: {r: 1, g: 0.78, b: 0.5},
    coolWhite: {r: 0.8, g: 0.9, b: 1},
    amber: {r: 1, g: 0.6, b: 0},
    uv: {r: 0.45, g: 0, b: 0.9},
    lime: {r: 0.6, g: 1, b: 0},
};

/**
 * Colour and brightness of a fixture (or one cell). `now` (ms) drives the
 * strobe; leave it out to ignore strobing.
 */
export function lookOf(v: Record<string, number>, now?: number): Look {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const [role, e] of Object.entries(EMITTERS)) {
        const value = v[role];
        if (value === undefined) continue;
        r += value * e.r;
        g += value * e.g;
        b += value * e.b;
    }
    if ('cyan' in v || 'magenta' in v || 'yellow' in v) {
        // CMY fixtures: white light through subtractive filters.
        r += 1 - (v.cyan ?? 0);
        g += 1 - (v.magenta ?? 0);
        b += 1 - (v.yellow ?? 0);
    }
    if (!COLOR_ROLES.some((role) => role in v)) {
        // Dimmer-only fixture: warm tungsten white.
        r = 1;
        g = 0.82;
        b = 0.58;
    }
    let level = v.dimmer ?? 1;
    const strobe = v.strobe ?? 0;
    if (strobe > 0.04 && now !== undefined) {
        const hz = 1 + strobe * 24;
        if (Math.floor((now / 1000) * hz * 2) % 2 === 1) level = 0;
    }
    r = Math.min(1, r) * level;
    g = Math.min(1, g) * level;
    b = Math.min(1, b) * level;
    return {r, g, b, level: Math.max(r, g, b)};
}

export const rgba = (c: Rgb, alpha = 1): string =>
    `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;

/** The colour at full brightness (for glows and beams). */
export const hue = (c: Look): Rgb => {
    const m = Math.max(c.r, c.g, c.b) || 1;
    return {r: c.r / m, g: c.g / m, b: c.b / m};
};

/** A distinct colour per fixture index (patch bars, universe grid). */
export const fixtureHue = (i: number): string => `hsl(${(i * 137.5) % 360} 70% 60%)`;
