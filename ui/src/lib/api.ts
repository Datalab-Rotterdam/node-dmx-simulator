/**
 * Thin client for the simulator's JSON API (the routes in src/routes/api).
 * Errors are shown as a toast and re-thrown.
 */
import type {AddFixturesRequest, AddShapeRequest, FixtureUpdate, ItemIds, ItemUpdates, ReaddressRequest, RigPatch} from './shared';
import {ui} from './ui.svelte';

export class ApiError extends Error {}

async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    // Every edit is sent as JSON, even without a body: the server requires the
    // JSON content type on edits so other websites cannot change the rig.
    const isEdit = method !== 'GET';
    const res = await fetch(path, {
        method,
        headers: isEdit ? {'Content-Type': 'application/json'} : {},
        body: isEdit ? JSON.stringify(body ?? {}) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = (data as {error?: string}).error ?? `Request failed (${res.status})`;
        ui.showToast(message);
        throw new ApiError(message);
    }
    return data as T;
}

export const api = {
    addFixtures: (req: AddFixturesRequest) => request<{added: string[]}>('POST', '/api/fixtures', req),
    updateFixtures: (updates: FixtureUpdate[]) => request('PATCH', '/api/fixtures', {updates}),
    deleteFixtures: (ids: string[]) => request('DELETE', '/api/fixtures', {ids}),
    duplicate: (ids: string[], dx = 30, dy = 30) => request<{added: string[]}>('POST', '/api/fixtures/duplicate', {ids, dx, dy}),
    readdress: (req: ReaddressRequest) => request('POST', '/api/fixtures/readdress', req),
    arrange: (ids?: string[]) => request('POST', '/api/arrange', {ids}),
    updateRig: (patch: RigPatch) => request('PATCH', '/api/rig', patch),
    addShape: (req: AddShapeRequest) => request<{added: string}>('POST', '/api/shapes', req),
    /** Change fixtures and shapes together (one undo step). */
    updateItems: (updates: ItemUpdates) => request('PATCH', '/api/items', updates),
    deleteItems: (ids: ItemIds) => request('DELETE', '/api/items', ids),
    duplicateItems: (ids: ItemIds, dx = 30, dy = 30) => request<Required<ItemIds>>('POST', '/api/items/duplicate', {...ids, dx, dy}),
    loadRig: (rig: string) => request('POST', '/api/rig/load', {rig}),
    undo: () => request('POST', '/api/undo'),
    redo: () => request('POST', '/api/redo'),
};
