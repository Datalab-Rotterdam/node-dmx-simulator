import {endpoint} from '../../../lib/server/api';

/** Rename the rig or change the extra universes. Body: `{name?, monitorUniverses?}`. */
export const PATCH = endpoint(({sim, body}) => sim.updateRig(body));
