import {endpoint} from '../../../lib/server/api';

export const POST = endpoint(({sim}) => ({ok: sim.undo()}));
