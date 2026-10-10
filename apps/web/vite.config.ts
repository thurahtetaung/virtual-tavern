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
    // Raised for the echarts chunk alone (about 565 kB, already tree-shaken to the SVG renderer
    // and the charts the stats page draws, and loaded only there). Every other chunk is under
    // 300 kB, so anything new crossing 600 kB still warns.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Back-room code goes to its own folder, which the server serves only to unlocked players.
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some(
            (id) => id.includes('/packages/private-games/') || id.endsWith('/games/private.ts'),
          )
            ? 'backroom-assets/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
        // ECharts (with zrender) is only used by the admin stats page. Its own chunk keeps it
        // cached across releases that don't touch it.
        codeSplitting: {
          groups: [{ name: 'echarts', test: /node_modules[\\/](echarts|zrender)[\\/]/ }],
        },
      },
    },
  },
  test: { name: 'web', environment: 'node' },
});
