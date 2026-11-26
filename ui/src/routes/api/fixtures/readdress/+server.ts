import {endpoint, ids} from '../../../../lib/server/api';

/** Patch fixtures one after another from a start address. Body: `{ids, universe, address}`. */
export const POST = endpoint(({sim, body}) => ({
    fixtures: sim.readdress({ids: ids(body), universe: Number(body.universe), address: Number(body.address)}),
}));
