import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/web', emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: {
      '/graphql': 'http://localhost:4000',
      '/files': 'http://localhost:4000',
    },
  },
});
