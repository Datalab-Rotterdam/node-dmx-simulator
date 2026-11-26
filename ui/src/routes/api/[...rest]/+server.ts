import {apiError} from '../../../lib/server/api';
import type {RequestHandler} from './$types';

/** Unknown API routes answer JSON instead of the app's HTML page. */
export const fallback: RequestHandler = ({request, url}) => apiError(404, `No API route ${request.method} ${url.pathname}`);
