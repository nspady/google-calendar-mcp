import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'path';

export default defineConfig({
  plugins: [viteSingleFile()],
  root: 'src/ui/day-view',
  build: {
    outDir: resolve(__dirname, 'build/ui'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, process.env.UI_INPUT || 'src/ui/day-view/day-view.html'),
    },
  },
});
