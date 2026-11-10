import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the same build works on GitHub Pages (sub-path) and Vercel (root).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { testTimeout: 60_000 },
} as any);
