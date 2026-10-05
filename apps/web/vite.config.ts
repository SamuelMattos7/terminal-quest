import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// T0.1: serve web on :5173, proxy API/WS to the Fastify server on :3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
