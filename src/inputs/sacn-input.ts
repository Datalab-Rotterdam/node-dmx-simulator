/**
 * sACN (E1.31) input: listens on the universes the rig uses, merges several
 * sources the way a real receiver does (highest priority wins, HTP between
 * equal priorities) and honours sACN synchronization.
 */
import {EventEmitter} from 'events';

import {Merger, Receiver, type Packet} from 'node-dmx';
import {SourceTracker} from './source-tracker';

/** If no sync packet arrives for this long, show held frames anyway (and warn). */
const SYNC_TIMEOUT_MS = 2500;

export type SacnInputOptions = {
    port: number;
    iface?: string;
};

export interface SacnInputEvents {
    /** New merged frame for a universe. `data` is empty when every source left. */
    frame: [universe: number, data: Uint8Array | null];
    log: [level: 'info' | 'warn', message: string];
    error: [Error];
}

type Pending = {packet: Packet; heldAt: number};

export class SacnInput extends EventEmitter<SacnInputEvents> {
    private readonly receiver: Receiver;
    private readonly merger = new Merger();
    private readonly wanted = new Set<number>();
    private readonly syncUniverses = new Set<number>();
    /** Frames held until their sync packet arrives, keyed by sync universe. */
    private readonly pending = new Map<number, Map<string, Pending>>();
    private readonly lastSyncAt = new Map<number, number>();
    private readonly warnedNoSync = new Set<number>();
    private readonly timer: NodeJS.Timeout;

    constructor(
        options: SacnInputOptions,
        private readonly sources: SourceTracker,
    ) {
        super();
        this.receiver = new Receiver({
            universes: [],
            port: options.port,
            iface: options.iface,
            reuseAddr: true,
            discovery: true,
        });

        this.receiver.on('packet', (packet) => this.onPacket(packet));
        this.receiver.on('sourceLost', (info) => {
            this.sources.lost('sacn', info.cidHex, info.universe, info.reason);
            const merged = this.merger.remove(info.universe, info.cidHex);
            if (merged) this.emit('frame', info.universe, merged.sources.length ? merged.data : null);
        });
        this.receiver.on('syncPacket', (sync) => this.onSync(sync.syncAddress));
        this.receiver.on('universeDiscovery', (d) => {
            this.sources.announce('sacn', d.cid.toString('hex'), d.sourceName, d.universes);
        });
        this.receiver.on('PacketOutOfOrder', (err) => this.emit('log', 'warn', `sACN: ${err.message}`));
        this.receiver.on('PacketCorruption', (err) => this.emit('log', 'warn', `sACN: ignored a malformed packet (${err.message})`));
        this.receiver.on('error', (err) => this.emit('error', err));

        this.timer = setInterval(() => this.flushStaleSync(), 250);
        this.timer.unref();
    }

    /** Make the receiver listen to exactly these universes (plus any sync universes in use). */
    public setUniverses(universes: Iterable<number>): void {
        this.wanted.clear();
        for (const u of universes) this.wanted.add(u);
        this.applyMembership();
    }

    public close(): Promise<void> {
        clearInterval(this.timer);
        this.merger.dispose();
        return new Promise((resolve) => this.receiver.close(() => resolve()));
    }

    private applyMembership(): void {
        const target = new Set([...this.wanted, ...this.syncUniverses]);
        for (const u of this.receiver.universes) if (!target.has(u)) this.receiver.removeUniverse(u);
        for (const u of target) this.receiver.addUniverse(u);
    }

    private onPacket(packet: Packet): void {
        const cidHex = packet.cid.toString('hex');
        this.sources.seen('sacn', cidHex, {
            name: packet.sourceName,
            address: packet.sourceAddress,
            universe: packet.universe,
            priority: packet.priority,
            sequence: packet.sequence,
            syncUniverse: packet.syncUniverse || undefined,
            preview: packet.isPreview,
        });

        // Only data for universes the rig uses is shown; sync universes are joined just for their sync packets.
        if (!this.wanted.has(packet.universe)) return;

        const sync = packet.syncUniverse;
        // E1.31 §6.2.4.1: hold frames until the sync packet. If sync was lost,
        // free-run unless the source set Force_Synchronization.
        const syncLost = this.warnedNoSync.has(sync);
        if (sync && (!syncLost || packet.forceSynchronization)) {
            if (!this.syncUniverses.has(sync)) {
                this.syncUniverses.add(sync);
                this.applyMembership();
                this.emit('log', 'info', `sACN: "${packet.sourceName}" uses sync universe ${sync}; frames are held until its sync packet`);
            }
            let held = this.pending.get(sync);
            if (!held) this.pending.set(sync, (held = new Map()));
            const key = `${cidHex}:${packet.universe}`;
            // Keep the first hold time so a stream without sync packets is detected.
            held.set(key, {packet, heldAt: held.get(key)?.heldAt ?? Date.now()});
            return;
        }
        this.apply(packet);
    }

    private onSync(syncUniverse: number): void {
        this.lastSyncAt.set(syncUniverse, Date.now());
        this.warnedNoSync.delete(syncUniverse);
        const held = this.pending.get(syncUniverse);
        if (!held) return;
        this.pending.delete(syncUniverse);
        for (const {packet} of held.values()) this.apply(packet);
    }

    private flushStaleSync(): void {
        const now = Date.now();
        for (const [sync, held] of this.pending) {
            const oldest = Math.min(...[...held.values()].map((p) => p.heldAt));
            if (now - oldest < SYNC_TIMEOUT_MS) continue;
            const forced = [...held.values()].some((p) => p.packet.forceSynchronization);
            if (!this.warnedNoSync.has(sync)) {
                this.warnedNoSync.add(sync);
                this.emit('log', 'warn', forced
                    ? `sACN: no sync packet on universe ${sync} for ${SYNC_TIMEOUT_MS / 1000}s. The source set Force_Synchronization, so its frames stay on hold.`
                    : `sACN: no sync packet on universe ${sync} for ${SYNC_TIMEOUT_MS / 1000}s. Showing frames unsynchronized until sync packets arrive.`);
            }
            if (forced) continue;
            this.pending.delete(sync);
            for (const {packet} of held.values()) this.apply(packet);
        }
    }

    private apply(packet: Packet): void {
        const merged = this.merger.update(packet);
        this.emit('frame', packet.universe, merged.data);
    }
}
