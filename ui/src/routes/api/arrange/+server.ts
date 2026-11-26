import {endpoint} from '../../../lib/server/api';

/** Lay fixtures out in rows, one per universe. Body: `{ids?}` (default: all). */
export const POST = endpoint(({sim, body}) => sim.arrange(Array.isArray(body.ids) ? body.ids : undefined));
