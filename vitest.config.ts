import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vitest runs unit tests only; the e2e/ folder holds Playwright specs which must
// not be collected here (they use Playwright's own runner).
const exclude = ['node_modules', 'dist', '.next', 'e2e/**'];

// Two projects: UI code (components, .tsx tests) runs under jsdom; server code
// (lib, API routes, proxy, MCP…) runs under plain `node`, which matches its real
// runtime (native fetch/Request/Response, no DOM globals).
const jsdomTests = ['src/components/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.tsx'];

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        globals: true,
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    environment: 'node',
                    include: ['src/**/*.{test,spec}.ts'],
                    exclude: [...exclude, ...jsdomTests],
                },
            },
            {
                extends: true,
                test: {
                    name: 'jsdom',
                    environment: 'jsdom',
                    setupFiles: './vitest.setup.ts',
                    include: jsdomTests,
                    exclude,
                },
            },
        ],
    },
});
