/**
 * Live updates as Server-Sent Events: first the full state, then rig changes,
 * DMX frames (30 per second at most), sources, log lines and RDM identify.
 * See ServerEvents in src/shared/types.ts.
 */
import {apiError, simulator} from '../../../lib/server/api';
import type {RequestHandler} from './$types';

export const GET: RequestHandler = () => {
    let sim;
    try {
        sim = simulator();
    } catch (err) {
        return apiError(503, (err as Error).message);
    }
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const write = (text: string) => {
                try {
                    controller.enqueue(encoder.encode(text));
                } catch {
                    unsubscribe(); // the browser went away
                }
            };
            unsubscribe = sim.subscribe(
                (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                () => write(': ping\n\n'),
            );
        },
        cancel() {
            unsubscribe();
        },
    });
    return new Response(stream, {
        headers: {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'},
    });
};
