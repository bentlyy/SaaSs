import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

// El server de citas corre en :3021; el browser habla con /api y Vite lo
// reenvía. El frontend compilado lo sirve Express (src/app.ts -> web/dist).
export default defineConfig({
  root: dir,
  plugins: [react(), tailwindcss()],
  server: {
    port: 5212,
    proxy: {
      '/api': {
        target: 'http://localhost:3021',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
