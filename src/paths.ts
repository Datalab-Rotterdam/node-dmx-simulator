/**
 * Where the simulator's own files live: the package root, with `rigs/` and
 * the web UI in `ui/` (its sources in a checkout, only `ui/build` when
 * installed from npm).
 *
 * In a checkout this file is src/paths.ts; in the npm package everything is
 * bundled into dist/cli.js. Both sit one folder below the root.
 */
import {existsSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RIGS_DIR = join(ROOT_DIR, 'rigs');
export const UI_DIR = join(ROOT_DIR, 'ui');

/** True in a checkout (web UI sources present), false when installed from npm. */
export const HAS_UI_SOURCES = existsSync(join(UI_DIR, 'src'));
