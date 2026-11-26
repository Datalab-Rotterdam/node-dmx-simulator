/**
 * Helpers for the API routes in src/routes/api. Server-only.
 *
 * The routes run inside the simulator's process, which registers a
 * SimulatorBridge on globalThis before starting this app (see
 * src/web/host.ts). Errors are answered as `{error: "..."}`.
 */
import {json, type RequestEvent, type RequestHandler} from '@sveltejs/kit';

import {BRIDGE_KEY, type SimulatorBridge} from '../shared';

export class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
    }
}

/** The running simulator. */
export function simulator(): SimulatorBridge {
    const bridge = (globalThis as Record<symbol, SimulatorBridge | undefined>)[BRIDGE_KEY];
    if (!bridge) {
        throw new ApiError(503, 'No simulator is running in this process. Start the UI with "npm run simulator" (or "npm run simulator -- --dev").');
    }
    return bridge;
}

export const apiError = (status: number, message: string) => json({error: message}, {status});

type Context = {
    sim: SimulatorBridge;
    /** The parsed JSON body ({} when empty). */
    body: Record<string, any>;
    event: RequestEvent;
};

/**
 * Wrap an API route: finds the simulator, parses the JSON body, turns the
 * result into a JSON response (`{ok: true}` when the handler returns nothing)
 * and errors into `{error}`. Simulator errors are the client's fault (400).
 */
export function endpoint(handler: (ctx: Context) => unknown, status = 200): RequestHandler {
    return async (event) => {
        try {
            const sim = simulator();
            const body = event.request.method === 'GET' ? {} : await readBody(event.request);
            const result = await handler({sim, body, event});
            return json(result ?? {ok: true}, {status});
        } catch (err) {
            return apiError(err instanceof ApiError ? err.status : 400, (err as Error).message);
        }
    };
}

async function readBody(request: Request): Promise<Record<string, any>> {
    const text = await request.text();
    if (!text) return {};
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        throw new ApiError(400, 'Request body is not valid JSON');
    }
    return body && typeof body === 'object' ? (body as Record<string, any>) : {};
}

/** The `ids` field as a list of fixture ids. */
export function ids(body: Record<string, any>): string[] {
    if (!Array.isArray(body.ids) || body.ids.some((x: unknown) => typeof x !== 'string')) {
        throw new ApiError(400, '"ids" must be a list of fixture ids');
    }
    return body.ids;
}

/** `{fixtures?, shapes?}` lists from a body (missing lists become empty). */
export function items<T extends {fixtures?: unknown[]; shapes?: unknown[]}>(body: Record<string, any>): T {
    for (const key of ['fixtures', 'shapes']) {
        if (body[key] !== undefined && !Array.isArray(body[key])) throw new ApiError(400, `"${key}" must be a list`);
    }
    return {fixtures: body.fixtures ?? [], shapes: body.shapes ?? []} as T;
}
