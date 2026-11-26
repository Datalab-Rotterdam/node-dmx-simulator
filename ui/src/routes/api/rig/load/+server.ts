import {endpoint} from '../../../../lib/server/api';

/** Replace the rig with a bundled one (undoable). Body: `{rig: "classroom"}`. */
export const POST = endpoint(({sim, body}) => sim.loadBundledRig(String(body.rig)));
