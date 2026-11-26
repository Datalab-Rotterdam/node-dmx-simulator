/**
 * Live connection to the simulator: the rig, DMX frames, sources and log,
 * pushed by the server over Server-Sent Events (/api/events).
 */
import type {LogEntry, ServerEvents, ShapeConfig, SourceSnapshot, StatusSnapshot, UiFixture, UiState} from './shared';

const EMPTY_FRAME = new Uint8Array(512);
const MAX_LOG = 300;

class Live {
    /** The rig as the server last sent it. Mutated locally while dragging for instant feedback. */
    state = $state<UiState | null>(null);
    /** Latest 512-channel frame per universe. Replaced (not mutated) on every update. */
    frames = $state.raw<Map<number, Uint8Array>>(new Map());
    sources = $state.raw<SourceSnapshot[]>([]);
    status = $state.raw<StatusSnapshot | null>(null);
    log = $state.raw<LogEntry[]>([]);
    /** Fixtures in RDM identify mode. */
    identify = $state.raw<Set<string>>(new Set());
    connected = $state(false);
    /** Warnings/errors logged since the Log tab was last opened. */
    unseenWarnings = $state(0);
    logOpen = false;

    private source: EventSource | null = null;

    connect(): void {
        if (this.source) return;
        const es = new EventSource('/api/events');
        this.source = es;
        const on = <E extends keyof ServerEvents>(event: E, handle: (data: ServerEvents[E]) => void) =>
            es.addEventListener(event, (e) => handle(JSON.parse((e as MessageEvent).data)));

        es.addEventListener('open', () => (this.connected = true));
        es.addEventListener('error', () => (this.connected = false));
        on('state', (state) => {
            this.state = state;
            this.identify = new Set(state.fixtures.filter((f) => f.identify).map((f) => f.id));
        });
        on('dmx', (frames) => {
            const next = new Map(this.frames);
            for (const [u, b64] of Object.entries(frames)) next.set(Number(u), decodeFrame(b64));
            this.frames = next;
        });
        on('sources', ({sources, status}) => {
            this.sources = sources;
            this.status = status;
        });
        on('history', (entries) => (this.log = entries));
        on('log', (entry) => {
            this.log = [...this.log.slice(-(MAX_LOG - 1)), entry];
            if (entry.level !== 'info' && !this.logOpen) this.unseenWarnings++;
        });
        on('identify', ({id, on: active}) => {
            const next = new Set(this.identify);
            if (active) next.add(id);
            else next.delete(id);
            this.identify = next;
        });
    }

    frame(universe: number): Uint8Array {
        return this.frames.get(universe) ?? EMPTY_FRAME;
    }

    fixture(id: string): UiFixture | undefined {
        return this.state?.fixtures.find((f) => f.id === id);
    }

    get fixtures(): UiFixture[] {
        return this.state?.fixtures ?? [];
    }

    /** Stage, trusses, roofs... in the order they were added. */
    get shapes(): ShapeConfig[] {
        return this.state?.shapes ?? [];
    }

    shape(id: string): ShapeConfig | undefined {
        return this.state?.shapes.find((s) => s.id === id);
    }

    get readonly(): boolean {
        return this.state?.readonly ?? true;
    }

    /** Universes with fixtures, monitored universes, and any universe data arrived on. */
    get knownUniverses(): number[] {
        return [...new Set([...(this.state?.universes ?? []), ...this.frames.keys()])].sort((a, b) => a - b);
    }

    get hasActiveSources(): boolean {
        return this.sources.some((s) => s.status === 'active');
    }
}

function decodeFrame(b64: string): Uint8Array {
    const bin = atob(b64);
    const frame = new Uint8Array(512);
    for (let i = 0; i < bin.length && i < 512; i++) frame[i] = bin.charCodeAt(i);
    return frame;
}

export const live = new Live();
