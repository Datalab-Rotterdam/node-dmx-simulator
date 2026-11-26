import {endpoint, ids} from '../../../../lib/server/api';

/** Copy fixtures onto the next free addresses. Body: `{ids, dx?, dy?}`. Answers `{added: ids}`. */
export const POST = endpoint(
    ({sim, body}) => ({added: sim.duplicateFixtures(ids(body), {dx: Number(body.dx ?? 30), dy: Number(body.dy ?? 30)})}),
    201,
);
