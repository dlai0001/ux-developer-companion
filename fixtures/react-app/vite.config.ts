import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error -- plain .mjs shared with the Angular fixture and the standalone API server
import { handleItems } from '../shared/items-api.mjs';

/** Mounts the shared fixture API in-process so `npm run dev`/`preview` are self-contained. */
function itemsApi(): Plugin {
  const mount = (server: { middlewares: { use: (path: string, fn: unknown) => void } }): void => {
    server.middlewares.use('/api/items', handleItems as never);
  };
  return {
    name: 'items-api',
    configureServer: mount as never,
    configurePreviewServer: mount as never,
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), itemsApi()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: { outDir: 'dist' },
  // `vite build --mode development` alone does NOT set process.env.NODE_ENV, so React still
  // ships its PRODUCTION runtime — the devtools hook then reports canEditFunctionProps=false
  // and the adapter (correctly) calls the page a production build. Define it explicitly so
  // dist-dev behaves like a real dev server.
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production') },
}));
