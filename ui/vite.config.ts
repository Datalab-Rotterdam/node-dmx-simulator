import adapter from '@sveltejs/adapter-node';
import {sveltekit} from '@sveltejs/kit/vite';
import {defineConfig} from 'vite';

// The simulator runs this app inside its own process: `npm run simulator`
// mounts build/handler.js, `npm run simulator -- --dev` starts Vite in
// middleware-free dev mode. Either way the API routes in src/routes/api reach
// the running simulator through src/lib/server/simulator.ts.
export default defineConfig({
    plugins: [sveltekit({adapter: adapter()})],
    server: {
        // The UI imports shared code from ../shared and ../fixture-types.ts.
        fs: {allow: ['..']},
    },
});
