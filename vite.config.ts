import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// `base: './'` keeps asset URLs relative so the same build loads from the dev
// server, `vite preview`, and the Electron `app://` protocol.
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // aviationweather.gov does not send CORS headers; proxy it in dev.
      '/proxy/awc': {
        target: 'https://aviationweather.gov',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/proxy\/awc/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // The long flight tests are left out of `npm test` to keep it under ~5 min on CI (4 vCPU):
    // the full-flight check rides (tests/aircraft/<id>/verify/fullFlight.test.ts, 1-3 min each) and
    // the published-performance flights (tests/aircraft/<id>/performance.test.ts: takeoff, climb
    // profiles, cruise and stall sweeps, 30-75 s each). `npm run test:long` runs both
    // (AMG_LONG_TESTS=1); CI runs them in the long-tests job. See docs/modules/qa.md.
    exclude: process.env.AMG_LONG_TESTS
      ? ['**/node_modules/**']
      : ['**/node_modules/**', 'tests/aircraft/*/verify/fullFlight.test.ts', 'tests/aircraft/*/performance.test.ts'],
  },
} as any);
