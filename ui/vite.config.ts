import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The build is embedded into FreeSizeTree.exe and served from https://app.local/,
// so the output is flat with stable file names (see FreeSizeTree.csproj).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: '',
    chunkSizeWarningLimit: 4000,
    rolldownOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
