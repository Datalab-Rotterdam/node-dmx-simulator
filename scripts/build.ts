/**
 * Builds the npm package:
 *   - ui/build: the web UI (SvelteKit, adapter-node)
 *   - dist/cli.js: the simulator in one file, with `node-dmx` and Node's own
 *     modules left as imports. Rigs and the UI are found next to it via
 *     src/paths.ts (dist/../rigs, dist/../ui/build).
 */
import {chmodSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {build} from 'vite';

import {ROOT_DIR} from '../src/paths';
import {ensureUiBuilt} from '../src/web/ui';

if (!ensureUiBuilt()) process.exit(1);

const outDir = join(ROOT_DIR, 'dist');
rmSync(outDir, {recursive: true, force: true});

await build({
    configFile: false,
    root: ROOT_DIR,
    logLevel: 'warn',
    build: {
        ssr: join(ROOT_DIR, 'src', 'index.ts'),
        outDir,
        target: 'node20',
        minify: false,
        sourcemap: false,
        rollupOptions: {output: {entryFileNames: 'cli.js', format: 'es'}},
    },
});

// Make it runnable as a command (`npx node-dmx-simulator`).
const cli = join(outDir, 'cli.js');
const code = readFileSync(cli, 'utf8').replace(/^#!.*\n/, '');
writeFileSync(cli, `#!/usr/bin/env node\n${code}`);
chmodSync(cli, 0o755);
console.log(`Built ${cli}`);
