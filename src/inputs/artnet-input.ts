/**
 * Art-Net 4 input: behaves like one Art-Net node with an output port for
 * every universe the rig uses.
 *
 * - ArtDmx: merged HTP per universe when several senders transmit.
 * - ArtSync: once a sync arrives, frames are held until the next ArtSync
 *   (reverting after 4 s without sync, as Art-Net 4 describes).
 * - ArtPoll: answered with one ArtPollReply per universe, so
 *   `ArtNetDiscovery` finds the simulator.
 * - ArtTodRequest / ArtTodControl / ArtRdm: answered for every RDM-enabled
 *   fixture, so `ArtNetRdmClient` can list, query and readdress them.
 *
 * Replies go back to the sender's source port. Real nodes always reply to
 * 6454, but answering the source port lets you run your controller on the
 * same computer with `localPort: 0` / `listenPort: 0`.
 */
import {createSocket, type RemoteInfo, type Socket} from 'dgram';
import {EventEmitter} from 'events';
import {networkInterfaces} from 'os';

import {
    ARTNET_ID,
    OpCode,
    PIDS,
    RdmCommandClass,
    RDM_START_CODE,
    buildArtPollReply,
    buildArtRdm,
    buildArtTodData,
    decodeRdmRequest,
    directedBroadcastAddress,
    parseArtDmx,
    parseArtRdm,
    parseArtTodControl,
    parseArtTodRequest,
    splitPortAddress,
    splitUniverseAddress,
    uidToString,
    type RdmResponder,
} from 'node-dmx';
import {SourceTracker} from './source-tracker';

const SYNC_REVERT_MS = 4000;
const BIND_INDEX_OFFSET = 211;

const PID_NAMES = new Map<number, string>(Object.entries(PIDS).map(([name, pid]) => [pid as number, name]));
export const pidName = (pid: number): string => PID_NAMES.get(pid) ?? `0x${pid.toString(16).padStart(4, '0')}`;

export type ArtNetInputOptions = {
    port: number;
    bindAddress?: string;
    shortName: string;
    longName: string;
    sourceTimeoutMs: number;
};

/** One RDM-capable fixture the node answers for. */
export type RdmDevice = {universe: number; responder: RdmResponder; name: string};

export type RdmLogEntry = {
    universe: number;
    from: string;
    command: 'GET' | 'SET' | 'DISCOVERY';
    pid: string;
    target: string;
    /** Name of the fixture that answered, if any. */
    answeredBy?: string;
};

export interface ArtNetInputEvents {
    frame: [universe: number, data: Uint8Array | null];
    rdm: [RdmLogEntry];
    log: [level: 'info' | 'warn', message: string];
    listening: [address: string, port: number];
    error: [Error];
}

type SourceFrame = {data: Uint8Array; lastSeen: number};

export class ArtNetInput extends EventEmitter<ArtNetInputEvents> {
    private readonly socket: Socket;
    private universes: number[] = [];
    private devices: RdmDevice[] = [];
    /** Live frames per universe, per sender ("ip:port"). */
    private readonly frames = new Map<number, Map<string, SourceFrame>>();
    /** Frames received in sync mode, waiting for the next ArtSync. */
    private readonly held = new Map<number, Map<string, Uint8Array>>();
    private lastSyncAt = 0;
    private readonly timer: NodeJS.Timeout;

    constructor(
        private readonly options: ArtNetInputOptions,
        private readonly sources: SourceTracker,
    ) {
        super();
        this.socket = createSocket({type: 'udp4', reuseAddr: true});
        this.socket.on('message', (msg, rinfo) => {
            try {
                this.handle(msg, rinfo);
            } catch (err) {
                this.emit('log', 'warn', `Art-Net: ignored a malformed packet from ${rinfo.address} (${(err as Error).message})`);
            }
        });
        this.socket.on('error', (err) => this.emit('error', err));
        this.socket.bind({port: options.port, address: options.bindAddress}, () => {
            this.socket.setBroadcast(true);
            const addr = this.socket.address();
            this.emit('listening', addr.address, addr.port);
        });
        this.timer = setInterval(() => this.sweep(), 500);
        this.timer.unref();
    }

    /** Universes this node advertises in ArtPollReply. */
    public setUniverses(universes: Iterable<number>): void {
        this.universes = [...new Set(universes)].filter((u) => u >= 1 && u <= 32768).sort((a, b) => a - b);
    }

    /** Fixtures the node answers RDM for. */
    public setDevices(devices: RdmDevice[]): void {
        this.devices = devices;
    }

    /** True while senders use ArtSync. */
    public get syncMode(): boolean {
        return this.lastSyncAt > 0 && Date.now() - this.lastSyncAt < SYNC_REVERT_MS;
    }

    public close(): Promise<void> {
        clearInterval(this.timer);
        return new Promise((resolve) => {
            try {
                this.socket.close(() => resolve());
            } catch {
                resolve();
            }
        });
    }

    private handle(msg: Buffer, rinfo: RemoteInfo): void {
        if (msg.length < 12 || msg.toString('ascii', 0, 8) !== ARTNET_ID) return;
        const opcode = msg.readUInt16LE(8);

        switch (opcode) {
            case OpCode.OpDmx:
                return this.onDmx(msg, rinfo);
            case OpCode.OpSync:
                return this.onSync();
            case OpCode.OpPoll:
                return this.onPoll(rinfo);
            case OpCode.OpTodRequest: {
                const req = parseArtTodRequest(msg);
                if (!req) return;
                const wanted = this.universes.filter((u) => {
                    const a = splitUniverseAddress(u);
                    return (req.net & 0x7f) === a.net && (req.addCount === 0 || req.addresses.includes(a.subUni));
                });
                for (const u of wanted) this.sendTod(u, rinfo);
                return;
            }
            case OpCode.OpTodControl: {
                const ctl = parseArtTodControl(msg);
                if (!ctl) return;
                const universe = ((ctl.net & 0x7f) << 8 | ctl.address) + 1;
                if (this.universes.includes(universe)) this.sendTod(universe, rinfo);
                return;
            }
            case OpCode.OpRdm:
                return this.onRdm(msg, rinfo);
            default:
                return;
        }
    }

    private onDmx(msg: Buffer, rinfo: RemoteInfo): void {
        const dmx = parseArtDmx(msg);
        if (!dmx) return;
        const sender = `${rinfo.address}:${rinfo.port}`;
        this.sources.seen('artnet', sender, {
            name: 'Art-Net',
            address: sender,
            universe: dmx.universe,
            sequence: dmx.sequence,
        });

        const data = new Uint8Array(512);
        data.set(dmx.data.subarray(0, 512));

        if (this.syncMode) {
            let held = this.held.get(dmx.universe);
            if (!held) this.held.set(dmx.universe, (held = new Map()));
            held.set(sender, data);
            return;
        }
        this.store(dmx.universe, sender, data);
    }

    private onSync(): void {
        if (!this.syncMode) this.emit('log', 'info', 'Art-Net: ArtSync received, frames now update together on each sync');
        this.lastSyncAt = Date.now();
        for (const [universe, held] of this.held) {
            for (const [sender, data] of held) this.store(universe, sender, data, false);
            this.emitMerged(universe);
        }
        this.held.clear();
    }

    private store(universe: number, sender: string, data: Uint8Array, emit = true): void {
        let senders = this.frames.get(universe);
        if (!senders) this.frames.set(universe, (senders = new Map()));
        if (!senders.has(sender) && senders.size >= 1) {
            this.emit('log', 'warn', `Art-Net: ${senders.size + 1} senders on universe ${universe}, merging HTP (highest value wins)`);
        }
        senders.set(sender, {data, lastSeen: Date.now()});
        if (emit) this.emitMerged(universe);
    }

    private emitMerged(universe: number): void {
        const senders = this.frames.get(universe);
        if (!senders || senders.size === 0) {
            this.emit('frame', universe, null);
            return;
        }
        if (senders.size === 1) {
            this.emit('frame', universe, senders.values().next().value!.data);
            return;
        }
        const out = new Uint8Array(512);
        for (const {data} of senders.values()) {
            for (let i = 0; i < 512; i++) if (data[i]! > out[i]!) out[i] = data[i]!;
        }
        this.emit('frame', universe, out);
    }

    private sweep(): void {
        if (this.lastSyncAt > 0 && !this.syncMode) {
            this.lastSyncAt = 0;
            this.emit('log', 'warn', `Art-Net: no ArtSync for ${SYNC_REVERT_MS / 1000}s, back to updating on every ArtDmx`);
            for (const [universe, held] of this.held) {
                for (const [sender, data] of held) this.store(universe, sender, data, false);
                this.emitMerged(universe);
            }
            this.held.clear();
        }
        const timeout = this.options.sourceTimeoutMs;
        if (timeout <= 0) return;
        const now = Date.now();
        for (const [universe, senders] of this.frames) {
            let changed = false;
            for (const [sender, frame] of senders) {
                if (now - frame.lastSeen < timeout) continue;
                senders.delete(sender);
                this.sources.lost('artnet', sender, universe, 'timeout');
                changed = true;
            }
            if (changed) this.emitMerged(universe);
        }
    }

    private onPoll(rinfo: RemoteInfo): void {
        const ip = this.options.bindAddress && this.options.bindAddress !== '0.0.0.0'
            ? this.options.bindAddress
            : localAddressFacing(rinfo.address);
        const list = this.universes.length ? this.universes : [1];
        list.forEach((universe, i) => {
            const packet = buildArtPollReply({
                ip,
                port: this.options.port,
                universe,
                shortName: this.options.shortName,
                longName: `${this.options.longName} (U${universe}, Port-Address ${universe - 1})`.substring(0, 63),
                nodeReport: `#0001 [${String(i + 1).padStart(4, '0')}] node-dmx simulator OK`,
            });
            // Art-Net 4: BindIndex tells a controller these replies belong to one device.
            packet.writeUInt8(Math.min(i + 1, 255), BIND_INDEX_OFFSET);
            this.send(packet, rinfo);
        });
    }

    private sendTod(universe: number, rinfo: RemoteInfo): void {
        const uids = this.devices.filter((d) => d.universe === universe).map((d) => d.responder.uid);
        // ArtTodData carries at most 200 UIDs per packet.
        for (let i = 0; i < Math.max(uids.length, 1); i += 200) {
            const chunk = uids.slice(i, i + 200);
            const packet = buildArtTodData({universe, uids: chunk, blockCount: i / 200});
            packet.writeUInt16BE(uids.length, 24); // UidTotal: all UIDs, not just this block
            this.send(packet, rinfo);
        }
    }

    private onRdm(msg: Buffer, rinfo: RemoteInfo): void {
        const parsed = parseArtRdm(msg);
        if (!parsed) return;
        const portAddress = ((parsed.net & 0x7f) << 8) | parsed.address;
        splitPortAddress(portAddress);
        const universe = portAddress + 1;

        let request;
        try {
            request = decodeRdmRequest(parsed.rdmPacket);
        } catch {
            return;
        }
        // Responses (odd command classes) are other nodes' replies, possibly our own echoed back.
        if (request.commandClass % 2 === 1) return;

        const entry: RdmLogEntry = {
            universe,
            from: rinfo.address,
            command: request.commandClass === RdmCommandClass.SET_COMMAND
                ? 'SET'
                : request.commandClass === RdmCommandClass.GET_COMMAND ? 'GET' : 'DISCOVERY',
            pid: pidName(request.pid),
            target: uidToString(request.destinationUid),
        };

        for (const device of this.devices) {
            if (device.universe !== universe) continue;
            const reply = device.responder.respond(parsed.rdmPacket);
            if (!reply || reply[0] !== RDM_START_CODE) continue;
            entry.answeredBy = device.name;
            this.send(buildArtRdm({universe, rdmPacket: reply.subarray(1)}), rinfo);
        }
        this.emit('rdm', entry);
    }

    private send(packet: Buffer, rinfo: RemoteInfo): void {
        const fail = (err: Error | null) => {
            if (err) this.emit('log', 'warn', `Art-Net: could not reply to ${rinfo.address}:${rinfo.port} (${err.message})`);
        };
        // A program on this computer that also bound our port (the library's
        // default for ArtNetDiscovery / ArtNetRdmClient) shares the port with
        // us, and the OS hands a unicast reply to only one of the two sockets,
        // often ours. A broadcast reaches every socket on the port, so reply
        // that way instead. We ignore our own echoed replies.
        if (rinfo.port === this.socket.address().port && isLocalAddress(rinfo.address)) {
            const targets = localBroadcastAddresses();
            if (targets.length) {
                for (const target of targets) this.socket.send(packet, rinfo.port, target, fail);
                return;
            }
        }
        this.socket.send(packet, rinfo.port, rinfo.address, fail);
    }
}

function isLocalAddress(address: string): boolean {
    if (address.startsWith('127.')) return true;
    return Object.values(networkInterfaces()).some((list) => list?.some((a) => a.family === 'IPv4' && a.address === address));
}

/** Directed broadcast address of every non-loopback IPv4 interface. */
function localBroadcastAddresses(): string[] {
    const out = new Set<string>();
    for (const list of Object.values(networkInterfaces())) {
        for (const addr of list ?? []) {
            if (addr.family !== 'IPv4' || addr.internal) continue;
            const broadcast = directedBroadcastAddress(addr.address);
            if (broadcast) out.add(broadcast);
        }
    }
    return [...out];
}

/** Pick the local IPv4 address on the same subnet as `remote`, so the reply advertises a reachable IP. */
export function localAddressFacing(remote: string): string {
    const toInt = (ip: string) => ip.split('.').reduce((acc, part) => ((acc << 8) | (Number(part) & 0xff)) >>> 0, 0);
    const remoteInt = toInt(remote);
    let fallback: string | undefined;
    for (const list of Object.values(networkInterfaces())) {
        for (const addr of list ?? []) {
            if (addr.family !== 'IPv4') continue;
            if (addr.address === remote) return addr.address;
            const mask = toInt(addr.netmask);
            if ((toInt(addr.address) & mask) === (remoteInt & mask)) return addr.address;
            if (!addr.internal && !fallback) fallback = addr.address;
        }
    }
    return fallback ?? '127.0.0.1';
}
