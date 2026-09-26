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
  },
} as any);
