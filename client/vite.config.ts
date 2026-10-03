import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config for the frontend.
 *
 * The important part is `server.proxy`. In development the UI runs on :5173 and
 * the API on :3000. Without a proxy those are two different ORIGINS, so the
 * browser would block the calls (and we would need CORS to paper over it).
 *
 * The proxy makes the browser see ONE origin: requests to /api/* are forwarded
 * to the Express server behind the scenes, exactly as if Express also served the
 * UI. That is why every fetch in the app can use a plain relative '/api/items'.
 */
export default defineConfig(({ mode }) => {
  // Vite loads .env files from the client/ folder. We also accept a root-level
  // API_PORT so you can point the UI at a server on a non-default port without
  // editing this file.
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.API_PORT ?? '3000';

  return {
    plugins: [react()],

    server: {
      port: 5173,
      // Fail loudly instead of silently moving to 5174, which would make the
      // URL in the README wrong.
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        // The health endpoint is outside /api, so it needs its own rule.
        '/health': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },

    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});