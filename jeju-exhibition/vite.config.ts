import './server/environment.js';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: Object.fromEntries([
      '/socket.io', '/health', '/network-info', '/operator', '/hand-state', '/pose-classes',
      '/recognition-state', '/recognition/', '/participants/', '/word-correction', '/vocabulary-match'
    ].map((prefix) => [prefix, { target: `http://127.0.0.1:${process.env.PORT ?? 3002}`, ws: true }]))
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
