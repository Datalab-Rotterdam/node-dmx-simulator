import {endpoint} from '../../../../lib/server/api';

/** Change one fixture. Body: the fields to change. */
export const PATCH = endpoint(({sim, body, event}) => ({fixture: sim.updateFixtures([{...body, id: event.params.id!}])[0]}));

/** Delete one fixture. */
export const DELETE = endpoint(({sim, event}) => sim.removeFixtures([event.params.id!]));
