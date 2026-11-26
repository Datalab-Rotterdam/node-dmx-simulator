/**
 * Keeps a list of who is sending to the simulator, so you can see at a
 * glance whether your program's packets arrive, how fast, and on which
 * universes.
 */

import type {SourceSnapshot} from '../shared/types';

export type {SourceSnapshot};
export type Protocol = SourceSnapshot['protocol'];

type SourceRecord = Omit<SourceSnapshot, 'universes' | 'packetsPerSecond' | 'lastSeenMs'> & {
    universes: Set<number>;
    lastSeen: number;
    /** Timestamps of recent packets, for the rate. */
    recent: number[];
};

const RATE_WINDOW_MS = 2000;
const FORGET_LOST_AFTER_MS = 60_000;

export type SeenInfo = {
    name?: string;
    address?: string;
    universe: number;
    priority?: number;
    sequence?: number;
    syncUniverse?: number;
    preview?: boolean;
};

export class SourceTracker {
    private readonly sources = new Map<string, SourceRecord>();

    /** Called when a source drops for the first time or comes back. */
    public onChange?: (source: SourceSnapshot, change: 'new' | 'lost' | 'back') => void;

    public seen(protocol: Protocol, id: string, info: SeenInfo): void {
        const key = `${protocol}:${id}`;
        const now = Date.now();
        let rec = this.sources.get(key);
        let change: 'new' | 'back' | undefined;
        if (!rec) {
            rec = {
                key,
                protocol,
                id,
                name: info.name || (protocol === 'artnet' ? 'Art-Net' : 'sACN source'),
                universes: new Set(),
                totalPackets: 0,
                lastSeen: now,
                recent: [],
                status: 'active',
            };
            this.sources.set(key, rec);
            change = 'new';
        } else if (rec.status === 'lost') {
            rec.status = 'active';
            rec.lostReason = undefined;
            change = 'back';
        }
        if (info.name) rec.name = info.name;
        if (info.address) rec.address = info.address;
        rec.priority = info.priority;
        rec.syncUniverse = info.syncUniverse;
        rec.preview = info.preview;
        rec.universes.add(info.universe);
        rec.totalPackets++;
        rec.lastSeen = now;
        rec.recent.push(now);
        if (rec.recent.length > 512) rec.recent.splice(0, rec.recent.length - 512);
        if (change) this.onChange?.(this.snapshot(rec, now), change);
    }

    public lost(protocol: Protocol, id: string, universe: number, reason: string): void {
        const rec = this.sources.get(`${protocol}:${id}`);
        if (!rec) return;
        // Keep the last universe so a lost source still shows where it was sending.
        if (rec.universes.size > 1) rec.universes.delete(universe);
        else if (rec.status !== 'lost') {
            rec.status = 'lost';
            rec.lostReason = reason;
            this.onChange?.(this.snapshot(rec, Date.now()), 'lost');
        }
    }

    public announce(protocol: Protocol, id: string, name: string, universes: number[]): void {
        const key = `${protocol}:${id}`;
        const rec = this.sources.get(key);
        if (rec) {
            rec.announced = universes;
            if (name) rec.name = name;
        }
    }

    public list(): SourceSnapshot[] {
        const now = Date.now();
        const out: SourceSnapshot[] = [];
        for (const [key, rec] of this.sources) {
            if (rec.status === 'lost' && now - rec.lastSeen > FORGET_LOST_AFTER_MS) {
                this.sources.delete(key);
                continue;
            }
            out.push(this.snapshot(rec, now));
        }
        return out.sort((a, b) => a.protocol.localeCompare(b.protocol) || a.name.localeCompare(b.name));
    }

    private snapshot(rec: SourceRecord, now: number): SourceSnapshot {
        while (rec.recent.length && now - rec.recent[0]! > RATE_WINDOW_MS) rec.recent.shift();
        const {recent: _recent, lastSeen, universes, ...rest} = rec;
        return {
            ...rest,
            universes: [...universes].sort((a, b) => a - b),
            packetsPerSecond: Math.round((rec.recent.length / (RATE_WINDOW_MS / 1000)) * 10) / 10,
            lastSeenMs: now - lastSeen,
        };
    }
}
