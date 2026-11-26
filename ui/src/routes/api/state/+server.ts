import {endpoint} from '../../../lib/server/api';

/** The rig as the UI shows it, plus sources, input status and the log. */
export const GET = endpoint(({sim}) => sim.state());
