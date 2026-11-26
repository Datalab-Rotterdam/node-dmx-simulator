import {ApiError, endpoint, ids} from '../../../lib/server/api';
import type {AddFixturesRequest} from '../../../lib/shared';

/** Add fixtures. Body: AddFixturesRequest. Answers `{added: ids}`. */
export const POST = endpoint(({sim, body}) => ({added: sim.addFixtures(body as AddFixturesRequest)}), 201);

/** Change several fixtures at once (all or nothing). Body: `{updates: [{id, ...changes}]}`. */
export const PATCH = endpoint(({sim, body}) => {
    if (!Array.isArray(body.updates)) throw new ApiError(400, '"updates" must be a list of {id, ...changes}');
    return {fixtures: sim.updateFixtures(body.updates)};
});

/** Delete fixtures. Body: `{ids}`. */
export const DELETE = endpoint(({sim, body}) => sim.removeFixtures(ids(body)));
