import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from a GitHub Pages project subpath.
  base: './',
  plugins: [react()],
});
