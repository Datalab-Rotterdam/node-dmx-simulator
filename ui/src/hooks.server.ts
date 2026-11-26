/**
 * Guards for the API: no edits in read-only mode, and edits must be JSON.
 *
 * Requiring `Content-Type: application/json` makes browsers send a CORS
 * preflight for cross-site requests, which this app never approves, so other
 * web pages you visit cannot edit your rig.
 */
import type {Handle} from '@sveltejs/kit/hooks';

import {apiError, simulator} from './lib/server/api';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const handle: Handle = async ({event, resolve}) => {
    if (event.url.pathname.startsWith('/api/') && !READS.has(event.request.method)) {
        let readonly = false;
        try {
            readonly = simulator().readonly;
        } catch {
            // No simulator: the route itself answers 503.
        }
        if (readonly) return apiError(403, 'The simulator was started with --readonly; editing is disabled.');
        if (!(event.request.headers.get('content-type') ?? '').startsWith('application/json')) {
            return apiError(415, 'Send edits with Content-Type: application/json');
        }
    }
    return resolve(event);
};
