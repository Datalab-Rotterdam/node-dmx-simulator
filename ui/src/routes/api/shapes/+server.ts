import {ApiError, endpoint} from '../../../lib/server/api';
import type {AddShapeRequest} from '../../../lib/shared';

/** Add a shape. Body: `{kind: "stage" | "truss" | "roof" | "area" | "label", x?, y?, width?, height?, name?, color?}`. Answers `{added: id}`. */
export const POST = endpoint(({sim, body}) => ({added: sim.addShape(body as AddShapeRequest)}), 201);

/** Change shapes. Body: `{updates: [{id, ...changes}]}`. */
export const PATCH = endpoint(({sim, body}) => sim.updateItems({shapes: list(body.updates, 'updates')}));

/** Delete shapes. Body: `{ids}`. */
export const DELETE = endpoint(({sim, body}) => sim.removeItems({shapes: list(body.ids, 'ids')}));

function list<T>(value: unknown, name: string): T[] {
    if (!Array.isArray(value)) throw new ApiError(400, `"${name}" must be a list`);
    return value as T[];
}
