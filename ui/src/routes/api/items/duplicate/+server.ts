import {endpoint, items} from '../../../../lib/server/api';
import type {ItemIds} from '../../../../lib/shared';

/** Copy fixtures and shapes. Body: `{fixtures?: ids, shapes?: ids, dx?, dy?}`. Answers the new ids. */
export const POST = endpoint(
    ({sim, body}) => sim.duplicateItems(items<ItemIds>(body), {dx: Number(body.dx ?? 30), dy: Number(body.dy ?? 30)}),
    201,
);
