import react from '@vitejs/plugin-react';
// vitest's defineConfig = vite's defineConfig + types for the `test` section
import { defineConfig } from 'vitest/config';

/** The 1M-point tests generate and clean a million points, which takes a few seconds. */
const TEST_TIMEOUT_MS = 60_000;

// base './' so the same build works on GitHub Pages (sub-path) and Vercel (root).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { testTimeout: TEST_TIMEOUT_MS },
});
