/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': backend,
      '/healthz': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Back-room code goes to its own folder, which the server serves only to unlocked players.
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some(
            (id) => id.includes('/packages/private-games/') || id.endsWith('/games/private.ts'),
          )
            ? 'backroom-assets/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  test: { name: 'web', environment: 'node' },
});
