import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        legacy: resolve(__dirname, 'notebooklm2pptx.html'),
        react: resolve(__dirname, 'react.html'),
        index: resolve(__dirname, 'index.html'),
      },
    },
  },
});

