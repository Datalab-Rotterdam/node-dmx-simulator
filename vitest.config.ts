import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // The web UI is its own SvelteKit app (ui/); the tests serve its build.
        exclude: ['**/node_modules/**', 'ui/**', 'dist/**'],
        coverage: {
            provider: 'v8',
            include: ['src/**'],
        },
    },
});
