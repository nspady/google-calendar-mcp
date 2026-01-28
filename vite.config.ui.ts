import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'build/ui',
    emptyOutDir: true,
    rollupOptions: {
      input: process.env.UI_INPUT || 'src/ui/day-view/day-view.html',
    },
  },
});
