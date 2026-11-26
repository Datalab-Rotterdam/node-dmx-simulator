import {afterEach, describe, expect, it} from 'vitest';

import {ArtNetDiscovery, ArtNetRdmClient, DMXController, PIDS, RdmCommandClass, uidFromString} from 'node-dmx';
import {ConfigError, findPatchIssues, listBundledRigs, loadBundledRig, normalizeConfig} from '../src/config';
import {BUILT_IN_TYPES, channelRoleAt, decodeFixture, fixtureSize, resolveLayout} from '../src/fixture-types';
import {Simulator} from '../src/simulator';
import {SimulatorHost} from '../src/web/host';
import type {UiState} from '../src/shared/types';
import {startWebUi} from '../src/web/ui';

describe('simulator config', () => {
    it('loads every bundled rig', () => {
        for (const name of listBundledRigs()) {
            const rig = loadBundledRig(name);
            expect(rig.name).toBeTruthy();
            expect(findPatchIssues(rig)).toEqual([]);
        }
    });

    it('fills in ids, defaults and unique UIDs', () => {
        const rig = normalizeConfig({
            fixtures: [
                {name: 'Par', type: 'rgb', universe: 1, address: 1},
                {name: 'Par', type: 'rgb', universe: 1, address: 4},
            ],
        });
        expect(rig.fixtures.map((f) => f.id)).toEqual(['par', 'par-2']);
        expect(new Set(rig.fixtures.map((f) => f.uid)).size).toBe(2);
        expect(rig.sacn.port).toBe(5568);
        expect(rig.artnet.port).toBe(6454);
    });

    it('reports every problem at once with readable messages', () => {
        try {
            normalizeConfig({
                fixtures: [
                    {name: 'A', type: 'nope', universe: 1, address: 1},
                    {name: 'B', type: 'rgbww', universe: 1, address: 510},
                    {name: 'C', type: 'rgb', universe: 0, address: 1},
                ],
            });
            expect.unreachable();
        } catch (err) {
            expect(err).toBeInstanceOf(ConfigError);
            const problems = (err as ConfigError).problems.join('\n');
            expect(problems).toContain('unknown type "nope"');
            expect(problems).toContain('last valid address is 508');
            expect(problems).toContain('universe must be');
        }
    });

    it('accepts custom fixture types', () => {
        const rig = normalizeConfig({
            fixtureTypes: {wash: {name: 'Wash', channels: ['dimmer', 'red', 'green', 'blue', 'macro']}},
            fixtures: [{type: 'wash', universe: 1, address: 1}],
        });
        expect(rig.fixtures[0]!.name).toBe('Wash');
    });

    it('flags overlapping fixtures', () => {
        const rig = normalizeConfig({
            fixtures: [
                {name: 'A', type: 'rgbww', universe: 1, address: 1},
                {name: 'B', type: 'rgb', universe: 1, address: 5},
            ],
        });
        expect(findPatchIssues(rig).map((i) => i.fixtureId)).toEqual(['a', 'b']);
    });
});

describe('fixture types', () => {
    it('decodes 16-bit pairs and cells', () => {
        const head = resolveLayout(BUILT_IN_TYPES['moving-head']!);
        const frame = new Uint8Array(512);
        frame.set([0x80, 0x00, 0xff, 0xff, 255], 9); // address 10
        const decoded = decodeFixture(head, frame, 10);
        expect(decoded.values.pan).toBeCloseTo(0x8000 / 65535);
        expect(decoded.values.tilt).toBe(1);
        expect(decoded.values.dimmer).toBe(1);
        expect('panFine' in decoded.values).toBe(false);

        const bar = resolveLayout(BUILT_IN_TYPES['led-bar']!);
        expect(bar.footprint).toBe(24);
        expect(channelRoleAt(bar, 4)).toEqual({role: 'green', cell: 2});
    });
});

describe('Simulator over the network', () => {
    let sim: Simulator | undefined;
    const closers: Array<() => void> = [];

    afterEach(async () => {
        closers.splice(0).forEach((close) => close());
        await sim?.stop();
        sim = undefined;
    });

    const start = async () => {
        const rig = normalizeConfig({
            sacn: {port: 25568},
            artnet: {port: 26454},
            fixtures: [
                {id: 'par', name: 'Par', type: 'rgbww', universe: 1, address: 1},
                {id: 'bar', name: 'Bar', type: 'led-bar', universe: 2, address: 10},
            ],
        });
        sim = new Simulator(rig);
        await sim.start();
        return sim;
    };

    it('receives Art-Net and sACN and decodes fixtures', async () => {
        const s = await start();

        const artnet = new DMXController({protocol: 'artnet', unicastDestination: '127.0.0.1', port: 26454});
        closers.push(() => artnet.close());
        artnet.setChannel(1, 1, 255);
        artnet.setChannel(1, 4, 128);
        await artnet.flush();
        await s.waitFor(1, (f) => f[0] === 255);
        expect(s.getFixtureValues('par')!.values.red).toBe(1);
        expect(s.getFixtureValues('par')!.values.warmWhite).toBeCloseTo(128 / 255);

        const sacn = new DMXController({protocol: 'sacn', unicastDestination: '127.0.0.1', port: 25568});
        closers.push(() => sacn.close());
        sacn.addUniverse(2).setChannel(11, 200);
        await sacn.flush();
        await s.waitFor(2, (f) => f[10] === 200);
        expect(s.getFixtureValues('bar')!.cells[0]!.green).toBeCloseTo(200 / 255);
        expect(s.getSources().map((src) => src.protocol).sort()).toEqual(['artnet', 'sacn']);
    });

    it('is discoverable and answers RDM, applying address changes to the rig', async () => {
        const s = await start();

        const discovery = new ArtNetDiscovery({listenPort: 0, broadcastAddress: '127.0.0.1'});
        closers.push(() => discovery.close());
        const nodes = await discovery.pollOnce({}, {port: 26454, timeoutMs: 300});
        expect(nodes.map((n) => n.shortName)).toEqual(['node-dmx sim', 'node-dmx sim']);

        const client = new ArtNetRdmClient({host: '127.0.0.1', port: 26454, localPort: 0, timeoutMs: 500});
        closers.push(() => client.close());
        const uids = await client.getTod(1, 300);
        const parUid = uidFromString(s.getConfig().fixtures[0]!.uid!);
        expect(uids).toEqual([parUid]);

        const sourceUid = {manufacturerId: 0x7a70, deviceId: 0xfffffff0};
        const label = await client.rdmTransaction(1, {
            destinationUid: parUid, sourceUid, portId: 1, subDevice: 0,
            commandClass: RdmCommandClass.GET_COMMAND, pid: PIDS.DEVICE_LABEL,
        });
        expect(label?.parameterData?.toString('ascii')).toBe('Par');

        await client.rdmTransaction(1, {
            destinationUid: parUid, sourceUid, portId: 1, subDevice: 0,
            commandClass: RdmCommandClass.SET_COMMAND, pid: PIDS.DMX_START_ADDRESS, parameterData: Buffer.from([0, 100]),
        });
        expect(s.getConfig().fixtures[0]!.address).toBe(100);
    });

    it('auto-addresses added fixtures and rolls over to the next universe', async () => {
        const s = await start();
        const added = s.addFixtures({type: 'pixel-strip', cells: 100, universe: 3, count: 2});
        expect(added.map((f) => [f.universe, f.address])).toEqual([[3, 1], [4, 1]]);
        expect(s.universes).toEqual([1, 2, 3, 4]);
        const next = s.addFixtures({type: 'rgb', universe: 1});
        expect(next[0]!.address).toBe(6);
    });
});

describe('Simulator editing', () => {
    const make = () =>
        new Simulator(
            normalizeConfig({
                fixtures: [
                    {id: 'a', name: 'A', type: 'rgb', universe: 1, address: 1, x: 100, y: 100},
                    {id: 'b', name: 'B', type: 'rgb', universe: 1, address: 4, x: 200, y: 100},
                    {id: 'c', name: 'C', type: 'rgb', universe: 1, address: 7, x: 300, y: 100},
                ],
            }),
        );
    const ids = (s: Simulator) => s.getConfig().fixtures.map((f) => f.id);

    it('changes several fixtures at once, or none if one change is invalid', () => {
        const s = make();
        s.updateFixtures([{id: 'a', x: 150}, {id: 'b', universe: 2}]);
        expect(s.getConfig().fixtures.map((f) => [f.x, f.universe])).toEqual([[150, 1], [200, 2], [300, 1]]);

        expect(() => s.updateFixtures([{id: 'a', x: 10}, {id: 'c', address: 600}])).toThrow();
        expect(s.getConfig().fixtures[0]!.x).toBe(150);
    });

    it('removes, duplicates and readdresses selections', () => {
        const s = make();
        const copies = s.duplicateFixtures(['a', 'b']);
        expect(copies).toHaveLength(2);
        expect(copies.map((f) => f.address)).toEqual([10, 13]);
        expect(new Set(s.getConfig().fixtures.map((f) => f.uid)).size).toBe(5);

        s.readdress({ids: ['c', 'a'], universe: 1, address: 510});
        const byId = Object.fromEntries(s.getConfig().fixtures.map((f) => [f.id, f]));
        expect([byId.c!.universe, byId.c!.address]).toEqual([1, 510]);
        expect([byId.a!.universe, byId.a!.address]).toEqual([2, 1]); // didn't fit, rolled over

        s.removeFixtures(['a', 'b']);
        expect(ids(s)).not.toContain('a');
        expect(ids(s)).not.toContain('b');
    });

    it('undoes and redoes edits with readable labels', () => {
        const s = make();
        expect(s.history.canUndo).toBe(false);

        s.removeFixtures(['a', 'b']);
        expect(s.history).toMatchObject({canUndo: true, undoLabel: 'Delete 2 fixtures'});
        expect(s.undo()).toBe(true);
        expect(ids(s)).toEqual(['a', 'b', 'c']);
        expect(s.history).toMatchObject({canRedo: true, redoLabel: 'Delete 2 fixtures'});

        expect(s.redo()).toBe(true);
        expect(ids(s)).toEqual(['c']);

        s.updateRig({name: 'Renamed'});
        expect(s.history.canRedo).toBe(false); // a new edit clears redo
        expect(s.undo()).toBe(true);
        expect(s.getConfig().name).not.toBe('Renamed');
    });
});

describe('Simulator fixture size', () => {
    it('scales fixtures, validates the scale and drops it again at 100%', () => {
        expect(() => normalizeConfig({fixtures: [{type: 'rgb', universe: 1, address: 1, scale: 20}]})).toThrow(/scale must be a number from 0.25 to 8/);
        const sim = new Simulator(normalizeConfig({fixtures: [{id: 'a', name: 'A', type: 'rgb', universe: 1, address: 1}]}));
        sim.updateFixtures([{id: 'a', scale: 2}]);
        expect(sim.getConfig().fixtures[0]!.scale).toBe(2);
        expect(sim.history.undoLabel).toBe('Resize "A"');
        expect(fixtureSize(BUILT_IN_TYPES.rgb!, 1, 2)).toEqual({w: 120, h: 120});
        sim.updateFixtures([{id: 'a', scale: null}]);
        expect('scale' in sim.getConfig().fixtures[0]!).toBe(false);
    });
});

describe('Simulator shapes', () => {
    it('turns an old fixed stage size into a stage shape', () => {
        const rig = normalizeConfig({stage: {width: 800, height: 400}});
        expect(rig.shapes).toEqual([{id: 'stage', kind: 'stage', name: 'Stage', x: 400, y: 200, width: 800, height: 400}]);
        expect('stage' in rig).toBe(false);
    });

    it('validates shapes with readable messages', () => {
        expect(() => normalizeConfig({shapes: [{kind: 'castle'}, {kind: 'truss', width: -5}]})).toThrow(
            /shapes\[0\]: kind must be one of stage, truss, roof, area, label[\s\S]*shapes\[1\]: width must be a number/,
        );
        const rig = normalizeConfig({shapes: [{kind: 'truss'}, {kind: 'truss'}]});
        expect(rig.shapes.map((s) => [s.id, s.width, s.height])).toEqual([['truss', 600, 24], ['truss-2', 600, 24]]);
    });

    it('adds, moves together with fixtures, and deletes shapes in single undo steps', () => {
        const sim = new Simulator(normalizeConfig({fixtures: [{id: 'a', name: 'A', type: 'rgb', universe: 1, address: 1, x: 100, y: 100}]}));
        const truss = sim.addShape({kind: 'truss', x: -500, y: -200});
        expect(truss).toMatchObject({kind: 'truss', name: 'Truss', x: -500, y: -200});

        sim.updateItems({fixtures: [{id: 'a', x: 150, y: 120}], shapes: [{id: truss.id, x: -450, y: -180}]});
        expect(sim.history.undoLabel).toBe('Move 2 items');
        expect(sim.getConfig().fixtures[0]).toMatchObject({x: 150, y: 120});

        sim.removeItems({fixtures: ['a'], shapes: [truss.id]});
        expect(sim.getConfig().fixtures).toHaveLength(0);
        expect(sim.getConfig().shapes.map((s) => s.id)).toEqual(['stage']);

        sim.undo();
        expect(sim.getConfig().shapes.map((s) => s.id)).toEqual(['stage', truss.id]);
        sim.undo();
        expect(sim.getConfig().shapes.find((s) => s.id === truss.id)).toMatchObject({x: -500, y: -200});
    });

    it('duplicates shapes and fixtures together', () => {
        const sim = new Simulator(normalizeConfig({fixtures: [{id: 'a', name: 'A', type: 'rgb', universe: 1, address: 1}]}));
        const copies = sim.duplicateItems({fixtures: ['a'], shapes: ['stage']});
        expect(copies.fixtures).toHaveLength(1);
        expect(copies.shapes).toEqual(['stage-2']);
        expect(sim.history.undoLabel).toBe('Duplicate 2 items');
    });
});

describe('Simulator web API', () => {
    const make = () =>
        new Simulator(
            normalizeConfig({
                fixtures: [
                    {id: 'a', name: 'A', type: 'rgb', universe: 1, address: 1},
                    {id: 'b', name: 'B', type: 'rgb', universe: 1, address: 4},
                ],
            }),
        );

    it('streams the state first, then rig changes', () => {
        const sim = make();
        const host = new SimulatorHost(sim);
        const events: string[] = [];
        const unsubscribe = host.subscribe((event) => events.push(event), () => {});
        expect(events).toEqual(['state', 'dmx', 'sources', 'history']);

        host.removeFixtures(['a']);
        expect(events.at(-1)).toBe('state');
        unsubscribe();
        host.removeFixtures(['b']);
        expect(events.filter((e) => e === 'state')).toHaveLength(2);
        host.close();
    });

    // Serves the real SvelteKit app (built first if needed: the first run can take a while).
    it('edits the rig over HTTP, but only with JSON requests', async () => {
        const sim = make();
        const host = new SimulatorHost(sim).register();
        const web = await startWebUi({port: 0, host: '127.0.0.1'});
        const send = (method: string, path: string, body?: unknown, type = 'application/json') =>
            fetch(web.url + path, {method, headers: {'Content-Type': type}, body: JSON.stringify(body ?? {})});
        try {
            // Form-style requests (what another website could send) are refused.
            expect((await send('DELETE', '/api/fixtures/a', undefined, 'text/plain')).status).toBe(403);

            expect((await send('DELETE', '/api/fixtures', {ids: ['a', 'b']})).status).toBe(200);
            expect(sim.getConfig().fixtures).toHaveLength(0);

            expect((await send('POST', '/api/undo')).status).toBe(200);
            const state = (await (await fetch(web.url + '/api/state')).json()) as UiState;
            expect(state.fixtures.map((f) => f.id)).toEqual(['a', 'b']);
            expect(state.history).toMatchObject({canUndo: false, canRedo: true});

            const dup = (await (await send('POST', '/api/fixtures/duplicate', {ids: ['a']})).json()) as {added: string[]};
            expect(dup.added).toHaveLength(1);

            const missing = await send('DELETE', '/api/fixtures', {ids: ['nope']});
            expect(missing.status).toBe(400);
            expect(((await missing.json()) as {error: string}).error).toMatch(/fixture/);
            expect((await fetch(web.url + '/api/nope')).status).toBe(404);
            expect(await (await fetch(web.url + '/')).text()).toContain('<title>');
        } finally {
            await web.close();
            host.close();
        }
    }, 180_000);
});
