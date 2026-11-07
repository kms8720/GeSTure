import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: { '/socket.io': { target: 'http://127.0.0.1:3002', ws: true } }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
