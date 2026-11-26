import {ApiError, endpoint} from '../../../../lib/server/api';

/** One universe's 512 channel values. */
export const GET = endpoint(({sim, event}) => {
    const universe = Number(event.params.universe);
    if (!Number.isInteger(universe) || universe < 1 || universe > 63999) throw new ApiError(404, 'Universes are numbered 1-63999');
    return {universe, channels: sim.channels(universe)};
});
