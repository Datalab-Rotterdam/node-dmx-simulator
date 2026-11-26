/**
 * Edits on fixtures and shapes together, as one undo step (e.g. moving or
 * deleting a selection that contains both).
 */
import {endpoint, items} from '../../../lib/server/api';
import type {ItemIds, ItemUpdates} from '../../../lib/shared';

/** Body: `{fixtures?: [{id, ...changes}], shapes?: [{id, ...changes}]}`. */
export const PATCH = endpoint(({sim, body}) => sim.updateItems(items<ItemUpdates>(body)));

/** Body: `{fixtures?: ids, shapes?: ids}`. */
export const DELETE = endpoint(({sim, body}) => sim.removeItems(items<ItemIds>(body)));
